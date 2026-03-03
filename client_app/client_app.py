"""
Federated Learning Client Application.

CLI client that:
- Connects to server via REST + WebSocket
- Auto-registers
- Downloads global model
- Trains locally
- Sends updates
- Auto-reconnects if disconnected
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import argparse
import asyncio
import base64
import json
import logging
import time
import uuid
from typing import Any, Dict, Optional

import numpy as np
import requests
import torch
import torch.nn as nn
import websockets
from websockets.exceptions import ConnectionClosed

from core_engine.client import FLClient as LocalClient
from core_engine.data_splitter import DataSplitter
from core_engine.model_zoo import create_model
from core_engine.utils.seed import set_seed


class HFVisionClassifier(nn.Module):
    """Wrap HF vision models to produce class logits for supervised training."""

    def __init__(self, base_model: nn.Module, num_classes: int = 10):
        super().__init__()
        self.base_model = base_model
        hidden_size = getattr(getattr(base_model, 'config', None), 'hidden_size', None)
        if hidden_size is None and hasattr(base_model, 'vision_model'):
            hidden_size = getattr(getattr(base_model.vision_model, 'config', None), 'hidden_size', None)
        if hidden_size is None:
            raise ValueError("Unable to infer hidden size for HuggingFace model")
        self.classifier = nn.Linear(hidden_size, num_classes)

    def _pool_outputs(self, outputs: Any) -> torch.Tensor:
        if hasattr(outputs, 'pooler_output') and outputs.pooler_output is not None:
            return outputs.pooler_output
        if hasattr(outputs, 'pooled_output') and outputs.pooled_output is not None:
            return outputs.pooled_output
        if hasattr(outputs, 'last_hidden_state') and outputs.last_hidden_state is not None:
            return outputs.last_hidden_state.mean(dim=1)
        if isinstance(outputs, (tuple, list)) and len(outputs) > 0:
            return outputs[0].mean(dim=1)
        raise ValueError("Unexpected HF output format for classifier pooling")

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        outputs = self.base_model(x)
        pooled = self._pool_outputs(outputs)
        return self.classifier(pooled)


class FederatedClient:
    """
    Distributed Federated Learning Client.

    Connects to central server, trains locally on its own schedule, and pushes updates.
    Training is client-initiated: the client autonomously decides when to train
    rather than waiting for admin commands.
    """

    def __init__(
        self,
        server_url: str,
        client_id: str,
        config: Dict[str, Any]
    ):
        self.server_url = server_url.rstrip('/')
        self.client_id = client_id or f"client_{uuid.uuid4().hex[:8]}"
        self.config = config

        self.ws: Optional[websockets.WebSocketClientProtocol] = None
        self.is_connected = False
        self.is_training = False
        self.token: Optional[str] = None

        self.local_client: Optional[LocalClient] = None
        self.current_global_version = 0
        self.group_model_id: Optional[str] = None
        self.group_model_info: Optional[Dict[str, Any]] = None

        self.logger = logging.getLogger(__name__)
        self._setup_logging()

    def _setup_logging(self):
        """Setup client logging."""
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
    
    async def connect(self) -> bool:
        """Connect to server via WebSocket."""
        try:
            ws_url = self.server_url.replace('http', 'ws') + '/ws'
            if self.token:
                separator = '&' if '?' in ws_url else '?'
                ws_url = f"{ws_url}{separator}token={self.token}"
            self.ws = await websockets.connect(
                ws_url,
                ping_interval=10,
                ping_timeout=5
            )
            
            # Build data metadata
            data_metadata = {
                'modality': getattr(self, 'data_modality', 'vision'),
                'samples': getattr(self, 'data_samples', None),
            }
            
            # Register with server
            await self.ws.send(json.dumps({
                'type': 'register',
                'client_id': self.client_id,
                'group_id': getattr(self, 'group_id', 'group_a'),
                'join_token': getattr(self, 'join_token', None),
                'data_metadata': data_metadata,
                'capabilities': {
                    'has_gpu': torch.cuda.is_available(),
                    'device': 'cuda' if torch.cuda.is_available() else 'cpu'
                }
            }))
            
            response = await self.ws.recv()
            data = json.loads(response)
            
            if data.get('status') == 'registered':
                self.is_connected = True
                self.logger.info(f"Connected to server as {self.client_id} in group {data.get('group_id')}")
                return True
            
            self.logger.error(f"Registration failed: {data.get('reason', 'unknown')}")
            return False
        
        except Exception as e:
            self.logger.error(f"Connection failed: {e}")
            return False
    
    async def disconnect(self):
        """Disconnect from server."""
        if self.ws:
            await self.ws.close()
        self.is_connected = False
    
    async def listen(self):
        """Listen for server commands."""
        try:
            async for message in self.ws:
                data = json.loads(message)
                await self._handle_message(data)
        except ConnectionClosed:
            self.logger.warning("Connection closed by server")
            self.is_connected = False
    
    async def _handle_message(self, message: Dict[str, Any]):
        """Handle incoming WebSocket messages."""
        msg_type = message.get('type')
        
        # Handle update acknowledgment
        if message.get('status') == 'accepted':
            window_status = message.get('window_status', {})
            self.logger.info(
                "Update accepted by server: %s/%s updates in window, triggered=%s",
                window_status.get('current_updates', 0),
                window_status.get('window_size', 0),
                message.get('triggered', False)
            )
            return
        
        if message.get('status') == 'rejected':
            self.logger.warning("Update rejected: %s", message.get('reason', 'unknown'))
            return

        if msg_type == 'model_update':
            # Server sent new aggregated model - update and train again
            await self._download_model(message)
        
        elif msg_type == 'train_command':
            # Server requesting local training
            train_config = message.get('config', {})
            if train_config:
                self.config.setdefault('client', {})
                self.config['client'].update(train_config)
                if self.local_client:
                    self.local_client.config['client'].update(train_config)
                    self.local_client._init_optimizer()
                    self.local_client._init_data_loader()
                self.logger.info(
                    "Updated training config: epochs=%s, batch_size=%s, lr=%s",
                    train_config.get('local_epochs'),
                    train_config.get('batch_size'),
                    train_config.get('lr')
                )
            self.logger.info("Received aggregated model, training next round...")
            await self._run_training()

        elif msg_type == 'training_started':
            # Server notifies training is open
            if message.get('config'):
                self.config.update({'client': {**self.config.get('client', {}), **message['config']}})
            self.logger.info("Training opened by server")

        elif msg_type == 'training_paused':
            self.logger.info("Training paused by server")

        elif msg_type == 'training_stopped':
            self.logger.info("Training stopped by server")

        elif msg_type == 'config_update':
            self.config.update(message.get('config', {}))
            self.logger.info("Config updated")

        elif msg_type == 'ping':
            await self.ws.send(json.dumps({'type': 'pong'}))
    
    async def _download_model(self, message: Dict[str, Any]):
        """Download and apply global model update."""
        self.logger.info(f"Downloading global model version {message.get('version')}")
        # In full implementation, would download actual model weights
        self.current_global_version = message.get('version', 0)
    
    async def _run_training(self):
        """Run local training and send update to server."""
        if not self.local_client:
            self._initialize_local_client()
        
        self.is_training = True
        self.logger.info("Starting local training...")
        
        # Train locally
        update = self.local_client.local_train()
        meta = update.get('meta', {})
        epoch_metrics = meta.get('epoch_metrics', [])
        if epoch_metrics:
            for entry in epoch_metrics:
                self.logger.info(
                    "Epoch %s/%s: loss=%.4f, acc=%.4f",
                    entry.get('epoch'),
                    len(epoch_metrics),
                    entry.get('loss', 0.0),
                    entry.get('accuracy', 0.0)
                )
        train_loss = meta.get('train_loss', 0.0)
        train_acc = meta.get('train_accuracy', 0.0)
        self.logger.info(
            "Training round complete: loss=%.4f, acc=%.4f, steps=%s",
            train_loss,
            train_acc,
            meta.get('local_steps', 0)
        )
        self.logger.info(f"Meta dict for sending: train_loss={train_loss}, train_accuracy={train_acc}")

        async def _send_metrics_once() -> bool:
            if not self.ws:
                return False
            self.logger.info(
                "Sending metrics message: client_id=%s, group_id=%s, meta_keys=%s",
                self.client_id,
                getattr(self, 'group_id', None),
                list(meta.keys())
            )
            try:
                await self.ws.send(json.dumps({
                    'type': 'metrics',
                    'client_id': self.client_id,
                    'group_id': getattr(self, 'group_id', None),
                    'meta': meta
                }))
                # Wait for metrics acknowledgment with short timeout
                response = await asyncio.wait_for(self.ws.recv(), timeout=2.0)
                ack = json.loads(response)
                if ack.get('status') == 'accepted':
                    self.logger.info("Metrics acknowledged by server")
                    return True
            except asyncio.TimeoutError:
                self.logger.debug("No metrics acknowledgment within timeout")
            except Exception as e:
                self.logger.debug("Metrics message send failed: %s", e)
            return False

        async def _ensure_metrics_delivered() -> bool:
            # Best effort on current connection
            if await _send_metrics_once():
                return True
            # If WS dropped during long HF training, reconnect and retry once.
            try:
                await self.disconnect()
            except Exception:
                pass
            if not await self.connect():
                return False
            return await _send_metrics_once()

        metrics_delivered = await _ensure_metrics_delivered()
        
        # Encode update for transmission
        encoded_full = base64.b64encode(update['local_updates']).decode('utf-8')
        # HF model deltas can be extremely large. If we try to send them over WebSocket,
        # the server will typically close the connection and nothing gets persisted.
        # In that case, send a meta-only update (empty local_updates) so the dashboard
        # still reflects loss/accuracy.
        max_update_chars = int(self.config.get('communication', {}).get('max_ws_update_chars', 8_000_000))
        encoded = encoded_full
        if len(encoded_full) > max_update_chars:
            self.logger.warning(
                "Update payload too large for WebSocket (%s chars > %s). Sending meta-only update (empty local_updates).",
                len(encoded_full),
                max_update_chars
            )
            encoded = ""
        
        # Send update to server
        self.logger.info("Sending update message: client_id=%s, meta=%s", self.client_id, update.get('meta', {}))
        try:
            await self.ws.send(json.dumps({
                'type': 'update',
                'update': {
                    'client_id': self.client_id,
                    'client_version': self.current_global_version,
                    'local_updates': encoded,
                    'update_type': 'delta',
                    'local_dataset_size': update['local_dataset_size'],
                    'meta': update['meta']
                }
            }))
        except Exception as e:
            self.logger.warning("Failed to send update (connection may have closed): %s", e)
            # Attempt to reconnect and retry
            try:
                await self.disconnect()
                if not await self.connect():
                    self.logger.error("Failed to reconnect after update send failure")
                    raise RuntimeError("Failed to reconnect to server") from e
                # If metrics weren't delivered previously, retry them on the fresh connection.
                if not metrics_delivered:
                    metrics_delivered = await _send_metrics_once()
                # Retry update send
                await self.ws.send(json.dumps({
                    'type': 'update',
                    'update': {
                        'client_id': self.client_id,
                        'client_version': self.current_global_version,
                        'local_updates': encoded,
                        'update_type': 'delta',
                        'local_dataset_size': update['local_dataset_size'],
                        'meta': update['meta']
                    }
                }))
                self.logger.info("Update sent successfully after reconnect")
            except Exception as retry_e:
                self.logger.error("Failed to send update even after reconnect: %s", retry_e)
                raise
        
        self.is_training = False
        self.logger.info("Update sent to server")

    async def _sync_group_config(self):
        """Sync training config and model info from server before training."""
        try:
            import aiohttp
            group_id = getattr(self, 'group_id', 'group_a')
            url = f"{self.server_url}/api/groups/{group_id}"
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        self.logger.warning("Failed to fetch group config: %s", resp.status)
                        return
                    data = await resp.json()

                group = data.get('group', {})
                cfg = group.get('config', {})

                self.config.setdefault('client', {})
                self.config['client'].update({
                    'local_epochs': cfg.get('local_epochs', self.config['client'].get('local_epochs', 2)),
                    'batch_size': cfg.get('batch_size', self.config['client'].get('batch_size', 32)),
                    'lr': cfg.get('lr', self.config['client'].get('lr', 0.01))
                })

                if self.local_client:
                    self.local_client._init_optimizer()
                    self.local_client._init_data_loader()

                model_id = group.get('model_id')
                if model_id:
                    model_changed = model_id != self.group_model_id
                    self.group_model_id = model_id

                    model_url = f"{self.server_url}/api/models/{model_id}"
                    async with session.get(model_url) as model_resp:
                        if model_resp.status == 200:
                            model_data = await model_resp.json()
                            self.group_model_info = model_data.get('model')
                            self._apply_model_info(self.group_model_info)
                        else:
                            self.logger.warning("Failed to fetch model info for %s: %s", model_id, model_resp.status)

                    if model_changed:
                        self.local_client = None

                self.logger.info(
                    "Synced group config: epochs=%s, batch_size=%s, lr=%s, model_id=%s",
                    self.config['client'].get('local_epochs'),
                    self.config['client'].get('batch_size'),
                    self.config['client'].get('lr'),
                    self.group_model_id
                )

        except Exception as e:
            self.logger.warning("Failed to sync group config: %s", e)

    def _apply_model_info(self, model_info: Optional[Dict[str, Any]]):
        """Apply model info to local config for model initialization."""
        if not model_info:
            return

        model_config = model_info.get('config') or {}
        for key, value in model_config.items():
            if isinstance(value, dict) and isinstance(self.config.get(key), dict):
                self.config[key].update(value)
            else:
                self.config[key] = value

        architecture = (model_info.get('architecture') or '').lower()
        model_type = (model_info.get('model_type') or '').lower()
        source = (model_info.get('source') or '').lower()
        if architecture:
            self.config.setdefault('model', {})
            if architecture in ('cnn', 'mlp'):
                self.config['model']['type'] = architecture
            else:
                self.config['model']['type'] = 'cnn'

        if source == 'huggingface' and model_type in ('vision', 'multimodal'):
            self.config.setdefault('dataset', {})
            self.config['dataset'].setdefault('image_size', 224)
            self.config['dataset'].setdefault('channels', 3)
            self.config['dataset'].setdefault('num_classes', 10)  # Ensure num_classes is set
            self.config['dataset'].setdefault(
                'normalize_mean',
                (0.48145466, 0.4578275, 0.40821073)
            )
            self.config['dataset'].setdefault(
                'normalize_std',
                (0.26862954, 0.26130258, 0.27577711)
            )
    
    def _initialize_local_client(self):
        """Initialize local FL client."""
        # Setup data
        data_splitter = DataSplitter(self.config)
        train_data = data_splitter.get_client_data(
            hash(self.client_id) % self.config.get('client', {}).get('num_clients', 10)
        )
        
        # Create model
        def model_factory():
            model_info = self.group_model_info or {}
            source = model_info.get('source')
            if source == 'huggingface':
                from core_engine.hf_models import load_hf_peft_model
                model_name = model_info.get('model_path') or model_info.get('architecture')
                model_cfg = model_info.get('config') or {}
                model, _ = load_hf_peft_model(model_name, model_cfg, device='cpu')
                model_type = (model_info.get('model_type') or '').lower()
                if model_type in ('vision', 'multimodal'):
                    num_classes = self.config.get('dataset', {}).get('num_classes', 10)
                    return HFVisionClassifier(model, num_classes=num_classes)
                return model

            return create_model(self.config)
        
        # Create client
        self.local_client = LocalClient(
            client_id=self.client_id,
            train_data=train_data,
            model_factory=model_factory,
            config=self.config
        )
        
        self.logger.info(f"Local client initialized with {len(train_data)} samples")
    
    async def run(self):
        """Main client loop."""
        # Connect to server
        connected = await self.connect()
        if not connected:
            self.logger.error("Failed to connect to server")
            return

        await self._sync_group_config()

        # Train once immediately, push update to server
        await self._run_training()

        # Then listen: server will send model_update after aggregation,
        # which triggers the next training round automatically
        await self.listen()




class RESTClient:
    """REST API client for simpler operations."""
    
    def __init__(self, server_url: str, token: Optional[str] = None):
        self.server_url = server_url.rstrip('/')
        self.token = token
        self.session = requests.Session()
        if token:
            self.session.headers.update({'Authorization': f'Bearer {token}'})
    
    def register_client(self, client_id: str) -> Dict:
        """Register client via REST."""
        response = self.session.post(
            f"{self.server_url}/api/clients/register",
            json={'client_id': client_id}
        )
        return response.json()
    
    def get_config(self) -> Dict:
        """Get training configuration from server."""
        response = self.session.get(f"{self.server_url}/api/config")
        return response.json()
    
    def get_model(self) -> bytes:
        """Download global model."""
        response = self.session.get(f"{self.server_url}/api/model/latest")
        return response.content
    
    def upload_update(self, client_id: str, update: Dict) -> Dict:
        """Upload client update via REST."""
        response = self.session.post(
            f"{self.server_url}/api/clients/{client_id}/update",
            json=update
        )
        return response.json()
    
    def get_status(self) -> Dict:
        """Get server status."""
        response = self.session.get(f"{self.server_url}/api/server/status")
        return response.json()


def main():
    parser = argparse.ArgumentParser(description='Federated Learning Client')
    
    # Server options
    parser.add_argument('--server', type=str, default='http://localhost:8000',
                        help='Server URL')
    parser.add_argument('--client-id', type=str, default=None,
                        help='Client ID (auto-generated if not provided)')
    
    # Group authentication
    parser.add_argument('--group-id', type=str, default='group_a',
                        help='Group ID to join')
    parser.add_argument('--join-token', type=str, default=None,
                        help='Join token for group authentication')
    
    # Data metadata
    parser.add_argument('--data-modality', type=str, default='vision',
                        choices=['vision', 'text', 'multimodal'],
                        help='Data modality (vision/text/multimodal)')
    parser.add_argument('--data-samples', type=int, default=None,
                        help='Number of data samples')
    
    # Authentication
    parser.add_argument('--token', type=str, default=None,
                        help='Authentication token')
    parser.add_argument('--username', type=str, default=None,
                        help='Username for auto-login (gets JWT token automatically)')
    parser.add_argument('--password', type=str, default=None,
                        help='Password for auto-login')
    
    # Training config
    parser.add_argument('--config', type=str, default='config.yaml',
                        help='Config file path')

    # Mode
    parser.add_argument('--mode', choices=['websocket', 'rest'], default='websocket',
                        help='Connection mode')
    
    args = parser.parse_args()
    
    # Auto-login if username/password provided
    token = args.token
    if not token and args.username and args.password:
        import requests as req
        try:
            login_resp = req.post(
                f"{args.server.rstrip('/')}/api/auth/login",
                json={"username": args.username, "password": args.password}
            )
            if login_resp.status_code == 200:
                login_data = login_resp.json()
                token = login_data.get("token")
                print(f"[AUTH] Logged in as {args.username} (token obtained)")
            else:
                print(f"[AUTH] Login failed: {login_resp.json().get('detail', 'unknown error')}")
                sys.exit(1)
        except Exception as e:
            print(f"[AUTH] Login request failed: {e}")
            sys.exit(1)
    
    if not token:
        print("[WARN] No authentication token. Use --username/--password or --token.")
        print("       WebSocket connection will likely fail (HTTP 403).")
    
    # Load config
    import yaml
    with open(args.config, 'r') as f:
        config = yaml.safe_load(f)
    
    # Override with command line
    set_seed(config.get('seed', 42))
    
    # Create client
    if args.mode == 'websocket':
        client = FederatedClient(
            server_url=args.server,
            client_id=args.client_id,
            config=config
        )
        # Set additional attributes
        client.group_id = args.group_id
        client.join_token = args.join_token
        client.data_modality = args.data_modality
        client.data_samples = args.data_samples
        client.token = token
        
        # Run client
        asyncio.run(client.run())
    
    else:
        import uuid
        client_id = args.client_id or f"client_{uuid.uuid4().hex[:8]}"
        client = RESTClient(args.server, args.token)
        
        # Register with server
        try:
            result = client.register_client(client_id)
            print(f"Registered: {result}")
        except Exception as e:
            print(f"Registration failed (server may not have endpoint): {e}")
        
        # Keep client alive and poll
        while True:
            try:
                status = client.get_status()
                print(f"Server status: {status}")
                time.sleep(5)
            except KeyboardInterrupt:
                print("\nClient stopped")
                break
            except Exception as e:
                print(f"Error: {e}")
                time.sleep(5)


if __name__ == '__main__':
    main()
