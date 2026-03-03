"""
FastAPI Server for Distributed Federated Learning.

Provides:
- REST API for training control
- WebSocket for live updates
- Client registration and management
- Group-based training with hybrid async windowing
- Experiment tracking with SQLite
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import asyncio
import json
import logging
import os
import sqlite3
import time
import uuid
import threading
import requests
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.auth_system import get_auth_manager
from api.database import get_db, init_db
from core_engine.aggregator import create_aggregator
from core_engine.data_splitter import DataSplitter
from core_engine.server import AsyncServer
from core_engine.utils.seed import set_seed
from model_registry.registry import get_registry


# ============================================================================
# Hybrid Async Window Configuration
# ============================================================================

@dataclass
class AsyncWindowConfig:
    """Configuration for hybrid async windowing."""
    window_size: int = 3  # Aggregate when N updates received
    time_limit: float = 20.0  # OR after T seconds elapsed
    enabled: bool = True


# ============================================================================
# Training Group Management
# ============================================================================

@dataclass
class TrainingGroup:
    """Represents a federated learning training group."""
    group_id: str
    model_id: str
    config: Dict[str, Any]
    window_config: AsyncWindowConfig = field(default_factory=AsyncWindowConfig)
    
    # Security - join token (secret)
    join_token: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    
    # Model state
    model_version: int = 0
    model: Any = None
    
    # Update buffer for hybrid windowing
    pending_updates: List[Dict] = field(default_factory=list)
    last_aggregation_time: float = field(default_factory=time.time)
    
    # Client tracking
    clients: Dict[str, Dict] = field(default_factory=dict)
    
    # Aggregator
    aggregator: Any = None
    
    # Status
    status: str = 'CREATED'  # CREATED, WAITING, READY, TRAINING, PAUSED, COMPLETED, FAILED
    is_training: bool = False
    is_locked: bool = False  # Lock config when training starts
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    # Training bounds
    max_rounds: Optional[int] = None
    completed_rounds: int = 0
    
    # Metrics
    metrics_history: List[Dict] = field(default_factory=list)
    
    def add_client(self, client_id: str, client_info: Dict = None) -> None:
        if client_id not in self.clients:
            self.clients[client_id] = {
                'status': 'active',
                'joined_at': datetime.now().isoformat(),
                'last_update': None,
                'trust_score': 1.0,
                'updates_count': 0,
                'local_accuracy': 0.0,
                'local_loss': 0.0,
                'gradient_norm': 0.0,
                **(client_info or {})
            }
    
    def remove_client(self, client_id: str) -> None:
        if client_id in self.clients:
            self.clients[client_id]['status'] = 'disconnected'
    
    def add_update(self, client_id: str, update: Dict) -> bool:
        """Add client update to buffer. Returns True if aggregation triggered."""
        logger = logging.getLogger(__name__)
        logger.info(f"[ADD-UPDATE] Client {client_id} in group {self.group_id}. Group clients: {list(self.clients.keys())}")
        if client_id not in self.clients:
            logger.warning(f"⚠️  Client {client_id} NOT in group {self.group_id} clients. Available: {list(self.clients.keys())}")
        if client_id in self.clients:
            self.clients[client_id]['last_update'] = time.time()
            self.clients[client_id]['updates_count'] += 1
            train_acc = update.get('meta', {}).get('train_accuracy', 0)
            train_loss = update.get('meta', {}).get('train_loss', 0)
            self.clients[client_id]['local_accuracy'] = train_acc
            self.clients[client_id]['local_loss'] = train_loss
            self.clients[client_id]['gradient_norm'] = update.get('meta', {}).get('gradient_norm', 0)
            logger.info(f"✓ METRICS STORED: Client {client_id} in group {self.group_id} | acc={train_acc:.4f}, loss={train_loss:.4f}")
        
        self.pending_updates.append({
            'client_id': client_id,
            'update': update,
            'timestamp': time.time()
        })
        
        # Check hybrid triggers
        size_triggered = len(self.pending_updates) >= self.window_config.window_size
        time_triggered = (time.time() - self.last_aggregation_time) >= self.window_config.time_limit
        
        return size_triggered or time_triggered
    
    def get_window_status(self) -> Dict:
        """Get current window status for UI."""
        elapsed = time.time() - self.last_aggregation_time
        return {
            'pending_updates': len(self.pending_updates),
            'window_size': self.window_config.window_size,
            'time_elapsed': round(elapsed, 1),
            'time_limit': self.window_config.time_limit,
            'time_remaining': max(0, self.window_config.time_limit - elapsed),
            'size_triggered': len(self.pending_updates) >= self.window_config.window_size,
            'time_triggered': elapsed >= self.window_config.time_limit,
            'trigger_reason': 'size' if len(self.pending_updates) >= self.window_config.window_size else ('time' if elapsed >= self.window_config.time_limit else 'waiting')
        }
    
    def clear_updates(self) -> None:
        """Clear buffer after aggregation."""
        self.pending_updates.clear()
        self.last_aggregation_time = time.time()
    
    def get_active_clients(self) -> List[str]:
        return [cid for cid, info in self.clients.items() if info.get('status') == 'active']
    
    def to_dict(self, include_secret: bool = False) -> Dict:
        return {
            'group_id': self.group_id,
            'model_id': self.model_id,
            'model_version': self.model_version,
            'status': self.status,
            'is_training': self.is_training,
            'is_locked': self.is_locked,
            'created_at': self.created_at,
            'completed_rounds': self.completed_rounds,
            'max_rounds': self.max_rounds,
            'join_token': self.join_token if include_secret else '***HIDDEN***',
            'config': {
                'local_epochs': self.config.get('local_epochs', 2),
                'batch_size': self.config.get('batch_size', 32),
                'lr': self.config.get('lr', 0.01),
                'aggregator': self.config.get('aggregator', 'fedavg'),
                'dp_enabled': self.config.get('dp_enabled', False),
            },
            'window_config': {
                'window_size': self.window_config.window_size,
                'time_limit': self.window_config.time_limit,
                'enabled': self.window_config.enabled
            },
            'window_status': self.get_window_status(),
            'client_count': len(self.clients),
            'active_clients': self.get_active_clients(),
            'pending_updates': len(self.pending_updates),
            'metrics_history': self.metrics_history[-10:]  # Last 10 entries
        }


class GroupManager:
    """Manages multiple training groups with hybrid async windowing."""
    
    def __init__(self, config: Dict[str, Any], connection_manager=None):
        self.config = config
        self.groups: Dict[str, TrainingGroup] = {}
        self.client_to_group: Dict[str, str] = {}
        self.lock = threading.RLock()
        self.logger = logging.getLogger(__name__)
        self.connection_manager = connection_manager
        self.training_tasks: Dict[str, asyncio.Task] = {}
        
        # Event logs
        self.event_logs: List[Dict] = []
        
        self._load_groups_from_db()
    
    async def broadcast_to_group(self, group_id: str, message: Dict):
        """Broadcast message to all clients in a group."""
        if not self.connection_manager:
            return
        group = self.groups.get(group_id)
        if not group:
            return
        for client_id in group.clients:
            await self.connection_manager.send_to(client_id, message)
    
    def _load_groups_from_db(self):
        """Load persisted groups from database on startup."""
        try:
            db = get_db()
            db_groups = db.get_all_groups()
            
            if db_groups:
                for g in db_groups:
                    gid = g['group_id']
                    if gid in self.groups:
                        continue
                    
                    config = json.loads(g.get('config_json', '{}')) if isinstance(g.get('config_json'), str) else (g.get('config_json') or {})
                    config.setdefault('auto_continue', False)
                    
                    aggregator = create_aggregator(config)
                    
                    group = TrainingGroup(
                        group_id=gid,
                        model_id=g.get('model_id', 'simple_cnn_mnist'),
                        config=config,
                        join_token=g.get('join_token', ''),
                        window_config=AsyncWindowConfig(
                            window_size=g.get('window_size', 3),
                            time_limit=g.get('time_limit', 20.0)
                        ),
                        aggregator=aggregator,
                        max_rounds=config.get('max_rounds')
                    )
                    group.status = g.get('status', 'IDLE')
                    
                    self.groups[gid] = group
                    self.logger.info(f"Restored group from DB: {gid} (status={group.status})")
                
                self.logger.info(f"Loaded {len(db_groups)} groups from database")
            else:
                # No persisted groups - create default
                self.create_group(
                    group_id='default',
                    model_id='simple_cnn_mnist',
                    config={},
                    window_size=3,
                    time_limit=20.0
                )
                self.logger.info("Created default group (no groups in DB)")
        except Exception as e:
            self.logger.warning(f"Could not load groups from DB: {e}")
            if not self.groups:
                aggregator = create_aggregator({})
                group = TrainingGroup(
                    group_id='default',
                    model_id='simple_cnn_mnist',
                    config={},
                    join_token=uuid.uuid4().hex[:16],
                    window_config=AsyncWindowConfig(window_size=3, time_limit=20.0),
                    aggregator=aggregator
                )
                self.groups['default'] = group
    
    def log_event(self, event_type: str, message: str, group_id: str = None, details: Dict = None):
        """Add an event to the log."""
        with self.lock:
            self.event_logs.append({
                'timestamp': time.time(),
                'type': event_type,
                'message': message,
                'group_id': group_id,
                'details': details or {}
            })
            # Keep last 500 events
            if len(self.event_logs) > 500:
                self.event_logs = self.event_logs[-500:]
    
    def get_logs(self, limit: int = 100, event_type: str = None, group_id: str = None) -> List[Dict]:
        """Get recent logs."""
        with self.lock:
            logs = list(self.event_logs)
            if event_type:
                logs = [l for l in logs if l['type'] == event_type]
            if group_id:
                logs = [l for l in logs if l.get('group_id') == group_id]
            return logs[-limit:][::-1]  # Most recent first

    def _decode_local_updates(self, local_updates: Any) -> np.ndarray:
        """Decode base64/bytes/list updates into a float32 numpy array."""
        if local_updates is None:
            return np.array([], dtype=np.float32)
        if isinstance(local_updates, bytes):
            return np.frombuffer(local_updates, dtype=np.float32)
        if isinstance(local_updates, str):
            try:
                import base64
                decoded = base64.b64decode(local_updates)
                return np.frombuffer(decoded, dtype=np.float32)
            except Exception:
                return np.array([], dtype=np.float32)
        if isinstance(local_updates, np.ndarray):
            return local_updates.astype(np.float32)
        return np.array(local_updates, dtype=np.float32)

    def normalize_update(self, update: Dict) -> Dict:
        """Ensure updates have fields expected by aggregators."""
        logger = logging.getLogger(__name__)
        logger.debug(f"NORMALIZE: Input meta={update.get('meta', {}).get('train_accuracy', 0)}")
        if 'delta' not in update:
            update['delta'] = self._decode_local_updates(update.get('local_updates'))
        # Validate: reject NaN/Inf updates that would poison the global model
        delta = update.get('delta')
        if delta is not None and hasattr(delta, '__len__') and len(delta) > 0:
            if np.any(np.isnan(delta)) or np.any(np.isinf(delta)):
                logger.warning("Rejecting update with NaN/Inf values")
                update['delta'] = np.zeros_like(delta)
        update.setdefault('dataset_size', update.get('local_dataset_size', 1))
        update.setdefault('staleness_weight', 1.0)
        update.setdefault('trust', 1.0)
        logger.debug(f"NORMALIZE: Output meta={update.get('meta', {}).get('train_accuracy', 0)}")
        return update

    def _start_training_watchdog(self, group_id: str) -> None:
        """Ensure a background task is running to enforce time-based aggregation."""
        task = self.training_tasks.get(group_id)
        if task and not task.done():
            return
        self.training_tasks[group_id] = asyncio.create_task(self._training_watchdog(group_id))

    def _stop_training_watchdog(self, group_id: str) -> None:
        task = self.training_tasks.pop(group_id, None)
        if task and not task.done():
            task.cancel()

    async def _training_watchdog(self, group_id: str) -> None:
        """Trigger aggregation on timeouts so training keeps progressing."""
        try:
            while True:
                await asyncio.sleep(1.0)
                with self.lock:
                    group = self.groups.get(group_id)
                    if not group or not group.is_training:
                        break
                    if not group.window_config.enabled:
                        continue
                    pending = len(group.pending_updates)
                    elapsed = time.time() - group.last_aggregation_time
                    time_limit = group.window_config.time_limit

                if pending == 0 or elapsed < time_limit:
                    continue

                agg_result = self.aggregate_group(group_id)
                if not agg_result:
                    continue

                await self.broadcast_to_group(group_id, {
                    'type': 'model_update',
                    'version': agg_result['version'],
                    'group_id': group_id,
                    'accuracy': agg_result.get('accuracy', 0),
                    'loss': agg_result.get('loss', 0)
                })

                if group and group.is_training and group.config.get('auto_continue', False):
                    await self.trigger_clients_training(group_id)
        except asyncio.CancelledError:
            return
    
    def create_group(
        self,
        group_id: str,
        model_id: str,
        config: Dict[str, Any],
        window_size: int = 3,
        time_limit: float = 20.0
    ) -> TrainingGroup:
        """Create a new training group."""
        with self.lock:
            if group_id in self.groups:
                return self.groups[group_id]
            
            config = config or {}
            config.setdefault('auto_continue', False)

            # Generate or use provided join token
            join_token = config.get('join_token')
            if not join_token or join_token == "GENERATE_NEW":
                join_token = uuid.uuid4().hex[:16]
            
            # Create aggregator for this group
            aggregator = create_aggregator(config)
            
            group = TrainingGroup(
                group_id=group_id,
                model_id=model_id,
                config=config,
                join_token=join_token,
                window_config=AsyncWindowConfig(
                    window_size=window_size,
                    time_limit=time_limit
                ),
                aggregator=aggregator,
                max_rounds=config.get('max_rounds')
            )
            
            self.groups[group_id] = group
            self.logger.info(f"Created group: {group_id}")
            
            # Persist to database
            try:
                db = get_db()
                db.create_group(
                    group_id=group_id,
                    model_id=model_id,
                    config=config,
                    join_token=join_token,
                    window_size=window_size,
                    time_limit=int(time_limit)
                )
            except Exception as e:
                self.logger.warning(f"Could not persist group {group_id} to DB: {e}")
            
            return group
    
    def delete_group(self, group_id: str) -> bool:
        with self.lock:
            if group_id not in self.groups:
                return False
            
            for client_id, g_id in list(self.client_to_group.items()):
                if g_id == group_id:
                    del self.client_to_group[client_id]
            
            del self.groups[group_id]
            
            # Remove from database
            try:
                db = get_db()
                db.delete_group(group_id)
            except Exception as e:
                self.logger.warning(f"Could not delete group {group_id} from DB: {e}")
            
            return True
    
    def register_client(self, client_id: str, group_id: str, client_info: Dict = None) -> bool:
        """Register client to a group."""
        with self.lock:
            if group_id not in self.groups:
                return False
            
            # Check if already in another group
            if client_id in self.client_to_group:
                current = self.client_to_group[client_id]
                if current != group_id:
                    self.log_event('client_rejected', f'Client {client_id} tried to migrate from {current} to {group_id}', group_id)
                    return False  # No migration allowed
            
            group = self.groups[group_id]
            
            # Auto-start training when first client joins
            if len(group.clients) == 0 and not group.is_training:
                group.is_locked = True
                group.is_training = True
                group.status = 'TRAINING'
                group.completed_rounds = 0
                self._start_training_watchdog(group_id)
                self.log_event('training_started', f'Training auto-started for group {group_id} (first client joined)', group_id)
            
            group.add_client(client_id, client_info)
            self.client_to_group[client_id] = group_id
            
            self.log_event('client_joined', f'Client {client_id} joined group {group_id}', group_id, {'client_id': client_id})
            
            return True
    
    def get_client_group(self, client_id: str) -> Optional[TrainingGroup]:
        group_id = self.client_to_group.get(client_id)
        return self.groups.get(group_id) if group_id else None
    
    def add_client_update(self, client_id: str, update: Dict) -> Optional[Dict]:
        """Add update and check if aggregation triggered (hybrid windowing)."""
        with self.lock:
            group = self.get_client_group(client_id)
            if not group:
                return None

            normalized = self.normalize_update(update)
            triggered = group.add_update(client_id, normalized)
            
            result = {
                'group_id': group.group_id,
                'triggered': triggered,
                'window_status': group.get_window_status()
            }
            
            if triggered:
                result['aggregate'] = True
            
            return result
    
    def aggregate_group(self, group_id: str) -> Optional[Dict]:
        """Aggregate updates in a group's buffer."""
        with self.lock:
            if group_id not in self.groups:
                return None
            
            group = self.groups[group_id]
            
            if len(group.pending_updates) == 0:
                return None
            
            # Get all updates
            updates = [self.normalize_update(u['update']) for u in group.pending_updates]
            client_ids = [u['client_id'] for u in group.pending_updates]
            
            # Calculate global metrics from client updates
            accuracies = [u.get('meta', {}).get('train_accuracy', 0) for u in updates]
            losses = [u.get('meta', {}).get('train_loss', 0) for u in updates]
            
            global_accuracy = sum(accuracies) / len(accuracies) if accuracies else 0
            global_loss = sum(losses) / len(losses) if losses else 0
            
            # Aggregate model weights
            if group.aggregator:
                aggregated = group.aggregator.aggregate(updates)
            else:
                aggregated = np.mean([u.get('delta', np.array([])) for u in updates], axis=0)
            
            # Update version
            group.model_version += 1
            group.completed_rounds += 1
            
            # Store metrics
            group.metrics_history.append({
                'version': group.model_version,
                'timestamp': time.time(),
                'accuracy': global_accuracy,
                'loss': global_loss,
                'clients': len(updates)
            })
            
            group.clear_updates()
            
            self.log_event('aggregation', f'Aggregated {len(updates)} updates -> v{group.model_version}', group_id, {
                'version': group.model_version,
                'clients': len(updates),
                'accuracy': global_accuracy,
                'loss': global_loss
            })
            
            # Save global model weights to disk
            self.save_model_weights(
                group_id=group_id,
                model_version=group.model_version,
                aggregated_weights=aggregated,
                accuracy=global_accuracy,
                loss=global_loss,
                num_clients=len(updates)
            )
            
            self.logger.info(
                f"Aggregated group {group_id}: {len(updates)} clients, v{group.model_version}, acc={global_accuracy:.4f}, loss={global_loss:.4f}"
            )

            # Broadcast to all connected WebSocket clients (including dashboard)
            if self.connection_manager:
                import asyncio
                try:
                    asyncio.create_task(self.connection_manager.broadcast({
                        'type': 'aggregation_complete',
                        'group_id': group_id,
                        'version': group.model_version,
                        'accuracy': global_accuracy,
                        'loss': global_loss,
                        'contributing_clients': len(updates),
                        'completed_rounds': group.completed_rounds,
                        'timestamp': time.time()
                    }))
                except RuntimeError:
                    pass  # No event loop running (e.g., during tests)

            if group.max_rounds is not None and group.completed_rounds >= group.max_rounds:
                group.is_training = False
                group.status = 'COMPLETED'
                self._stop_training_watchdog(group_id)
                self.log_event('training_completed', f'Training completed for group {group_id}', group_id, {
                    'version': group.model_version,
                    'rounds': group.completed_rounds
                })
            
            return {
                'group_id': group_id,
                'version': group.model_version,
                'accuracy': global_accuracy,
                'loss': global_loss,
                'contributing_clients': client_ids,
                'update_count': len(updates),
                'aggregated_model': aggregated
            }
    
    def save_model_weights(self, group_id: str, model_version: int,
                           aggregated_weights, accuracy: float, loss: float,
                           num_clients: int):
        """Save global model weights to disk and record in DB."""
        try:
            import torch
            save_dir = os.path.join('models', 'global', group_id)
            os.makedirs(save_dir, exist_ok=True)
            
            file_path = os.path.join(save_dir, f'model_v{model_version}.pt')
            torch.save({
                'version': model_version,
                'weights': aggregated_weights,
                'accuracy': accuracy,
                'loss': loss,
                'num_clients': num_clients,
                'timestamp': datetime.now().isoformat(),
                'group_id': group_id
            }, file_path)
            
            # Also save as latest
            latest_path = os.path.join(save_dir, 'model_latest.pt')
            torch.save({
                'version': model_version,
                'weights': aggregated_weights,
                'accuracy': accuracy,
                'loss': loss,
                'num_clients': num_clients,
                'timestamp': datetime.now().isoformat(),
                'group_id': group_id
            }, latest_path)
            
            # Record in database
            db = get_db()
            db.save_model_record(
                group_id=group_id,
                model_type='global',
                file_path=file_path,
                version=model_version,
                accuracy=accuracy,
                loss=loss,
                num_clients=num_clients
            )
            
            self.logger.info(f"Saved global model v{model_version} for group {group_id} → {file_path}")
        except Exception as e:
            self.logger.warning(f"Could not save model for group {group_id}: {e}")
    
    def get_all_groups(self, include_secret: bool = False) -> List[Dict]:
        with self.lock:
            return [g.to_dict(include_secret) for g in self.groups.values()]
    
    def start_group_training(self, group_id: str) -> bool:
        """Start training for a group."""
        with self.lock:
            if group_id not in self.groups:
                return False
            group = self.groups[group_id]
            if group.is_locked:
                return False
            
            group.is_locked = True
            group.is_training = True
            group.status = 'TRAINING'
            group.completed_rounds = 0

            self._start_training_watchdog(group_id)
            
            self.log_event('training_started', f'Training started for group {group_id}', group_id)
            self.logger.info(f"Started training for group {group_id}")
            return True
    
    async def notify_training_started(self, group_id: str):
        """Notify all clients that training is open - they should begin autonomous training."""
        group = self.groups.get(group_id)
        if not group:
            return

        self.log_event('training_started_notify', f'Training opened for group {group_id}, clients may begin', group_id, {
            'client_count': len(group.clients)
        })

        await self.broadcast_to_group(group_id, {
            'type': 'training_started',
            'group_id': group_id,
            'config': {
                'local_epochs': group.config.get('local_epochs', 2),
                'batch_size': group.config.get('batch_size', 32),
                'lr': group.config.get('lr', 0.01),
            }
        })

    async def trigger_clients_training(self, group_id: str):
        """Explicitly trigger a new local training round for all clients in a group."""
        group = self.groups.get(group_id)
        if not group:
            return

        await self.broadcast_to_group(group_id, {
            'type': 'train_command',
            'group_id': group_id,
            'config': {
                'local_epochs': group.config.get('local_epochs', 2),
                'batch_size': group.config.get('batch_size', 32),
                'lr': group.config.get('lr', 0.01),
            }
        })

    async def notify_training_paused(self, group_id: str):
        """Notify all clients that training is paused."""
        await self.broadcast_to_group(group_id, {
            'type': 'training_paused',
            'group_id': group_id,
        })

    async def notify_training_stopped(self, group_id: str):
        """Notify all clients that training is stopped."""
        await self.broadcast_to_group(group_id, {
            'type': 'training_stopped',
            'group_id': group_id,
        })
    
    def process_client_update(self, client_id: str, update: Dict) -> Dict:
        """Process client update and check if aggregation needed."""
        group = self.get_client_group(client_id)
        if not group:
            return {'triggered': False, 'group_id': None}
        
        normalized = self.normalize_update(update)
        triggered = group.add_update(client_id, normalized)
        
        result = {
            'triggered': triggered,
            'group_id': group.group_id,
            'window_status': group.get_window_status()
        }
        
        if triggered:
            result['aggregate'] = True
        
        return result
    
    def pause_group_training(self, group_id: str) -> bool:
        """Pause training for a group."""
        with self.lock:
            if group_id not in self.groups:
                return False
            group = self.groups[group_id]
            group.is_training = False
            group.status = 'PAUSED'
            self._stop_training_watchdog(group_id)
            return True
    
    def resume_group_training(self, group_id: str) -> bool:
        """Resume training for a group."""
        with self.lock:
            if group_id not in self.groups:
                return False
            group = self.groups[group_id]
            group.is_training = True
            group.status = 'TRAINING'
            self._start_training_watchdog(group_id)
            return True
    
    def stop_group_training(self, group_id: str) -> bool:
        """Stop training for a group."""
        with self.lock:
            if group_id not in self.groups:
                return False
            group = self.groups[group_id]
            group.is_training = False
            group.status = 'COMPLETED'
            self._stop_training_watchdog(group_id)
            return True
    
    def get_all_client_status(self) -> List[Dict]:
        clients = []
        for group_id, group in self.groups.items():
            for client_id, info in group.clients.items():
                clients.append({
                    'client_id': client_id,
                    'group_id': group_id,
                    **info
                })
        return clients


# ============================================================================
# Data Models
# ============================================================================

class ClientRegister(BaseModel):
    client_id: str
    capabilities: Dict[str, Any] = {}

class ClientUpdate(BaseModel):
    client_id: str
    client_version: int
    local_updates: str  # Base64 encoded
    update_type: str = "delta"
    local_dataset_size: int
    meta: Dict[str, Any] = {}

class ExperimentConfig(BaseModel):
    experiment_id: str
    config: Dict[str, Any]

class ControlCommand(BaseModel):
    command: str  # start, pause, resume, stop
    params: Dict[str, Any] = {}


# ============================================================================
# Connection Manager
# ============================================================================

class ConnectionManager:
    """Manages WebSocket connections for live updates."""
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.client_sockets: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
    
    async def broadcast(self, message: Dict[str, Any]):
        """Broadcast message to all connected clients."""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass
    
    async def send_to(self, client_id: str, message: Dict[str, Any]):
        """Send message to specific client."""
        if client_id in self.client_sockets:
            try:
                await self.client_sockets[client_id].send_json(message)
            except Exception:
                pass
    
    def register_client(self, client_id: str, websocket: WebSocket):
        self.client_sockets[client_id] = websocket
    
    def unregister_client(self, client_id: str):
        if client_id in self.client_sockets:
            del self.client_sockets[client_id]


# ============================================================================
# Database Manager
# ============================================================================

# ExperimentDB removed — all database access is now via AstraDB (api/database.py)


# ============================================================================
# FL Server Application
# ============================================================================

class FLServer:
    """Federated Learning Server with API."""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.connection_manager = ConnectionManager()
        self.db = get_db()
        self.group_manager = GroupManager(config, self.connection_manager)
        
        self.server: Optional[AsyncServer] = None
        self.model_registry = get_registry()
        
        self.experiment_id: Optional[str] = None
        self.is_running = False
        self.is_paused = False
        
        self.logger = logging.getLogger(__name__)
        
        self._setup_server()
    
    def _setup_server(self):
        """Initialize the FL server."""
        from core_engine.model_zoo import create_model
        
        # Create model
        model = create_model(self.config)
        
        # Create aggregator
        aggregator = create_aggregator(self.config)
        
        # Create data splitter (for validation)
        data_splitter = DataSplitter(self.config)
        _, val_loader = data_splitter.create_data_loaders()
        
        # Create async server
        self.server = AsyncServer(
            model=model,
            aggregator=aggregator,
            config=self.config,
            val_loader=val_loader
        )
        
        self.logger.info("FL Server initialized")
    
    async def handle_client_register(self, client_id: str, capabilities: Dict) -> Dict:
        """Handle client registration."""
        self.connection_manager.register_client(client_id, None)
        self.db.register_fl_client(client_id, self.experiment_id or 'default')
        
        self.logger.info(f"Client registered: {client_id}")
        
        return {
            'status': 'registered',
            'client_id': client_id,
            'config': self.config
        }
    
    async def handle_client_update(self, update: ClientUpdate) -> Dict:
        """Handle incoming client update."""
        if not self.server or not self.is_running or self.is_paused:
            return {'status': 'rejected', 'reason': 'server_not_ready'}
        
        # Decode update (simplified - would normally use base64)
        import base64
        try:
            delta_bytes = base64.b64decode(update.local_updates)
            delta = np.frombuffer(delta_bytes, dtype=np.float32)
        except Exception:
            delta = np.array([])
        
        client_update = {
            'client_id': update.client_id,
            'client_version': update.client_version,
            'local_updates': delta.tobytes(),
            'update_type': update.update_type,
            'local_dataset_size': update.local_dataset_size,
            'timestamp': time.time(),
            'meta': update.meta
        }
        
        # Process update
        self.server.handle_update(client_update)
        
        # Broadcast update to dashboard
        await self.connection_manager.broadcast({
            'type': 'client_update',
            'client_id': update.client_id,
            'step': self.server.global_version
        })
        
        return {'status': 'accepted', 'global_version': self.server.global_version}
    
    async def get_global_model(self) -> Dict:
        """Get global model state (simplified)."""
        if not self.server:
            return {}
        
        return {
            'global_version': self.server.global_version,
            'model_type': 'simple_cnn'
        }
    
    def start_experiment(self, experiment_id: str, config: Dict) -> None:
        """Start a new experiment."""
        self.experiment_id = experiment_id
        self.config = config
        
        set_seed(config.get('seed', 42))
        
        self.db.create_experiment(experiment_id, config)
        self.db.update_experiment_status(experiment_id, 'running')
        
        self.is_running = True
        self.is_paused = False
        
        self._setup_server()
        
        self.logger.info(f"Experiment started: {experiment_id}")
    
    def pause_experiment(self) -> None:
        self.is_paused = True
        self.logger.info("Experiment paused")
    
    def resume_experiment(self) -> None:
        self.is_paused = False
        self.logger.info("Experiment resumed")
    
    def stop_experiment(self) -> None:
        self.is_running = False
        if self.experiment_id:
            self.db.update_experiment_status(self.experiment_id, 'completed')
        self.logger.info("Experiment stopped")


# ============================================================================
# FastAPI App with Socket.IO
# ============================================================================

fl_server: Optional[FLServer] = None
socketio_app: Optional[AsyncServer] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global fl_server, socketio_app
    
    config = {
        'seed': 42,
        'dataset': {'name': 'MNIST', 'split': 'dirichlet', 'dirichlet_alpha': 0.3},
        'model': {'type': 'cnn', 'cnn': {'name': 'simple_cnn'}},
        'client': {'num_clients': 10, 'local_epochs': 2, 'batch_size': 32, 'lr': 0.01},
        'server': {'optimizer': 'sgd', 'server_lr': 0.5, 'momentum': 0.9, 'async_lambda': 0.2, 'aggregator_window': 5},
        'robust': {'method': 'fedavg', 'trim_ratio': 0.1},
        'privacy': {'dp_enabled': False},
        'training': {'total_steps': 1000, 'eval_interval_steps': 10},
        'heterogeneous': {'mapping_method': 'average', 'allow_partial_updates': True, 'min_param_overlap': 0.5},
    }
    
    fl_server = FLServer(config)
    
    # Setup Socket.IO
    from aiohttp import web
    socketio_app = web.Application()
    
    # Note: time-based aggregation is handled by per-group _training_watchdog
    
    yield
    
    if fl_server:
        fl_server.stop_experiment()


# Extended API registration
_extended_api_registered = False

def _register_extended_endpoints(app, config):
    """Register extended API endpoints."""
    global _extended_api_registered
    if _extended_api_registered:
        return
    
    try:
        from api.extended_endpoints import setup_extended_api
        platform = setup_extended_api(app, config)
        print("[INFO] Extended API endpoints registered")
        _extended_api_registered = True
    except Exception as e:
        print(f"[WARN] Could not register extended endpoints: {e}")


app = FastAPI(title="Federated Learning API", lifespan=lifespan)

# Register extended API endpoints at module level (auth, join requests, notifications, etc.)
# These endpoints don't depend on fl_server — they use their own FLPlatformIntegration.
_register_extended_endpoints(app, {})

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add Socket.IO support
from fastapi_socketio import SocketManager

socket_manager = SocketManager(app, cors_allowed_origins="*")


@socket_manager.on('connect')
async def connect(sid, environ):
    print(f"Client connected: {sid}")


@socket_manager.on('disconnect')
async def disconnect(sid):
    print(f"Client disconnected: {sid}")


@socket_manager.on('register')
async def register(sid, data):
    """Handle client registration via Socket.IO"""
    client_id = data.get('client_id')
    capabilities = data.get('capabilities', {})
    
    if fl_server:
        result = await fl_server.handle_client_register(client_id, capabilities)
        await socket_manager.emit('registered', result, room=sid)


@socket_manager.on('update')
async def handle_update(sid, data):
    """Handle client update via Socket.IO"""
    if not fl_server:
        return
    
    try:
        update = ClientUpdate(**data)
        result = await fl_server.handle_client_update(update)
        await socket_manager.emit('update_ack', result, room=sid)
    except Exception as e:
        await socket_manager.emit('error', {'message': str(e)}, room=sid)


# ============================================================================
# REST Endpoints
# ============================================================================

@app.get("/")
async def root():
    return {"message": "Federated Learning API", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy", "server_ready": fl_server is not None}


@app.post("/api/experiments/start")
async def start_experiment(config: ExperimentConfig):
    """Start a new federated learning experiment."""
    if not fl_server:
        raise HTTPException(status_code=503, detail="Server not ready")
    fl_server.start_experiment(config.experiment_id, config.config)
    return {"status": "started", "experiment_id": config.experiment_id}


@app.post("/api/experiments/{experiment_id}/control")
async def control_experiment(experiment_id: str, command: ControlCommand):
    """Control experiment (pause, resume, stop)."""
    if not fl_server:
        raise HTTPException(status_code=503, detail="Server not ready")
    if command.command == "pause":
        fl_server.pause_experiment()
    elif command.command == "resume":
        fl_server.resume_experiment()
    elif command.command == "stop":
        fl_server.stop_experiment()
    
    return {"status": "ok", "command": command.command}


@app.get("/api/experiments/{experiment_id}/metrics")
async def get_experiment_metrics(experiment_id: str):
    """Get experiment metrics history."""
    metrics = fl_server.db.get_experiment_metrics(experiment_id)
    return {"experiment_id": experiment_id, "metrics": metrics}




@app.get("/api/system/metrics")
async def get_system_metrics():
    """Get system-wide metrics for dashboard."""
    if not fl_server:
        raise HTTPException(status_code=503, detail="Server not ready")
    groups = fl_server.group_manager.get_all_groups()
    clients = fl_server.group_manager.get_all_client_status()
    
    active_groups = [g for g in groups if g.get('status') == 'TRAINING']
    dp_enabled = sum(1 for g in groups if g.get('config', {}).get('dp_enabled', False))

    latest_metric = None
    latest_group_id = None
    for group in groups:
        history = group.get('metrics_history') or []
        if not history:
            continue
        candidate = history[-1]
        if not latest_metric or candidate.get('timestamp', 0) > latest_metric.get('timestamp', 0):
            latest_metric = candidate
            latest_group_id = group.get('group_id')
    
    return {
        "total_groups": len(groups),
        "active_groups": len(active_groups),
        "total_participants": len(clients),
        "active_participants": len([c for c in clients if c.get('status') == 'active']),
        "dp_enabled_groups": dp_enabled,
        "total_aggregations": sum(g.get('model_version', 0) for g in groups),
        "latest_group_id": latest_group_id,
        "latest_accuracy": (latest_metric or {}).get('accuracy', 0),
        "latest_loss": (latest_metric or {}).get('loss', 0),
        "latest_version": (latest_metric or {}).get('version', 0),
        "latest_timestamp": (latest_metric or {}).get('timestamp', 0)
    }


@app.post("/api/models/register")
async def register_model(model_id: str, model_type: str, model_source: str, config: Dict):
    """Register a new model."""
    if model_source == "huggingface":
        model_info = fl_server.model_registry.register_hf_model(
            config['model_name'],
            use_peft=config.get('use_peft', False),
            peft_config=config.get('peft_config')
        )
    elif model_source == "custom":
        model_info = fl_server.model_registry.register_custom_architecture(
            model_id,
            config['architecture'],
            model_type,
            config
        )
    
    return {"status": "registered", "model": model_info.to_dict()}


@app.get("/api/clients/connected")
async def list_connected_clients():
    """List currently connected client IDs."""
    clients = list(fl_server.connection_manager.client_sockets.keys())
    return {"clients": clients, "count": len(clients)}


@app.post("/api/clients/register")
async def register_client(client: ClientRegister):
    """Register a client via REST."""
    client_id = client.client_id
    capabilities = client.capabilities
    
    # Register in database
    fl_server.db.register_fl_client(client_id, fl_server.experiment_id or 'default')
    
    # Add to connected clients
    fl_server.connection_manager.register_client(client_id, None)
    
    return {"status": "registered", "client_id": client_id}


@app.post("/api/join/activate/{group_id}")
async def join_group_as_client(group_id: str, request: Request):
    """Join an FL group as a participant after admin approval.
    
    Bridges the auth system (join request approval) with the FL system (group registration).
    The client must have an approved join request for this group.
    """
    if not fl_server:
        raise HTTPException(status_code=503, detail="Server not ready")
    
    # Verify JWT token
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No authorization token")
    
    token = auth_header.replace("Bearer ", "")
    
    # Verify token via extended platform integration
    try:
        from api.integration import get_platform_integration
        platform = get_platform_integration()
        payload = platform.verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token verification failed")
    
    user_id = payload.get("user_id")
    username = payload.get("sub", f"user_{user_id}")
    
    # Verify join request is approved
    try:
        status = platform.get_user_join_status(user_id, group_id)
        if not status or status.get("status") != "approved":
            raise HTTPException(
                status_code=403, 
                detail="Join request not approved. Please request to join first and wait for admin approval."
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Could not verify join status")
    
    # Check group exists in FL server
    group = fl_server.group_manager.groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail=f"Group '{group_id}' not found")
    
    # Generate a client ID from the username
    client_id = f"{username}_{group_id}"
    
    # Register client in the FL group
    group.add_client(client_id, {"user_id": user_id, "username": username})
    
    # Register in database
    fl_server.db.register_fl_client(client_id, fl_server.experiment_id or 'default')
    
    # Log the join event
    fl_server.group_manager.log_event(
        'client_joined',
        f'Client {username} joined group {group_id}',
        group_id,
        {'client_id': client_id, 'user_id': user_id, 'username': username}
    )
    
    # Auto-start training if this is the first client
    if len(group.clients) == 1 and not group.is_training:
        fl_server.group_manager.start_group_training(group_id)
    
    return {
        "status": "joined",
        "client_id": client_id,
        "group_id": group_id,
        "message": f"Successfully joined group {group_id}"
    }

@app.get("/api/server/status")
async def get_server_status():
    """Get server status."""
    return {
        "running": fl_server.is_running,
        "paused": fl_server.is_paused,
        "experiment_id": fl_server.experiment_id,
        "global_version": fl_server.server.global_version if fl_server.server else 0,
        "connected_clients": len(fl_server.connection_manager.client_sockets)
    }


@app.get("/api/models")
async def list_models():
    """List all available models."""
    models = fl_server.model_registry.list_models()
    return {"models": models, "count": len(models)}


def _fetch_hf_model_metadata(model_name: str) -> Dict[str, Any]:
    """Fetch lightweight metadata from HuggingFace for dataset sizing."""
    try:
        url = f"https://huggingface.co/api/models/{model_name}"
        res = requests.get(url, timeout=5)
        if res.status_code != 200:
            return {}
        return res.json() or {}
    except Exception:
        return {}


@app.post("/api/models/register/hf")
async def register_hf_model(model_name: str, use_peft: bool = False, peft_method: str = "lora"):
    """Register a HuggingFace model."""
    try:
        peft_config = {
            'enabled': use_peft,
            'method': peft_method,
            'lora_rank': 8,
            'lora_alpha': 16,
            'target_modules': ['q_proj', 'v_proj']
        } if use_peft else {'enabled': False}
        
        model_info = fl_server.model_registry.register_hf_model(
            model_name=model_name,
            use_peft=use_peft,
            peft_config=peft_config
        )

        hf_meta = _fetch_hf_model_metadata(model_name)
        hf_config = (hf_meta.get('config') or {})
        vision_config = hf_config.get('vision_config') or {}
        image_size = hf_config.get('image_size') or vision_config.get('image_size')
        if image_size:
            model_info.config.setdefault('dataset', {})
            model_info.config['dataset'].setdefault('image_size', image_size)
            model_info.config['dataset'].setdefault('channels', 3)
            model_info.config['dataset'].setdefault(
                'normalize_mean',
                (0.48145466, 0.4578275, 0.40821073)
            )
            model_info.config['dataset'].setdefault(
                'normalize_std',
                (0.26862954, 0.26130258, 0.27577711)
            )

        return {"status": "registered", "model": model_info.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/models/{model_id}")
async def get_model(model_id: str):
    """Get model details."""
    model_info = fl_server.model_registry.get_model_info(model_id)
    if not model_info:
        raise HTTPException(status_code=404, detail="Model not found")
    return {"model": model_info}


@app.get("/api/models/validate/{model_id}")
async def validate_model(model_id: str):
    """Validate model compatibility."""
    is_valid, message = fl_server.model_registry.validate_model(model_id)
    return {"model_id": model_id, "is_valid": is_valid, "message": message}


@app.get("/api/groups")
async def list_groups():
    """List all training groups with their async window status."""
    # Do NOT expose raw join tokens in the general listing.
    groups = fl_server.group_manager.get_all_groups(include_secret=False)
    return {"groups": groups, "count": len(groups)}


@app.post("/api/groups")
async def create_group(group_data: Dict):
    """Create a new training group."""
    group_id = group_data.get('group_id')
    model_id = group_data.get('model_id', 'simple_cnn_mnist')
    window_size = group_data.get('window_size', 3)
    time_limit = group_data.get('time_limit', 20.0)
    custom_token = group_data.get('join_token')
    
    # Build config with training parameters
    config = {
        'join_token': custom_token if custom_token else "GENERATE_NEW",
        'local_epochs': group_data.get('local_epochs', 2),
        'batch_size': group_data.get('batch_size', 32),
        'lr': group_data.get('lr', 0.01),
        'aggregator': group_data.get('aggregator', 'fedavg'),
        'dp_enabled': group_data.get('dp_enabled', False),
    }
    
    group = fl_server.group_manager.create_group(
        group_id=group_id,
        model_id=model_id,
        config=config,
        window_size=window_size,
        time_limit=time_limit
    )
    
    # For create we still return the real token once, for the admin caller.
    result = group.to_dict(include_secret=True)
    return {"status": "created", "group": result}


@app.get("/api/groups/{group_id}")
async def get_group(group_id: str):
    """Get specific group details (admin view with token)."""
    group = fl_server.group_manager.groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"group": group.to_dict(include_secret=True)}


@app.post("/api/groups/{group_id}/start")
async def start_group_training(group_id: str):
    """Start training for a group - clients train independently."""
    success = fl_server.group_manager.start_group_training(group_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot start training")

    # Notify all clients that training is now open - they train autonomously
    await fl_server.group_manager.notify_training_started(group_id)

    return {"status": "started", "group_id": group_id}




@app.post("/api/groups/{group_id}/pause")
async def pause_group_training(group_id: str):
    """Pause training for a group."""
    success = fl_server.group_manager.pause_group_training(group_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot pause training")
    await fl_server.group_manager.notify_training_paused(group_id)
    return {"status": "paused", "group_id": group_id}


@app.post("/api/groups/{group_id}/resume")
async def resume_group_training(group_id: str):
    """Resume training for a group."""
    success = fl_server.group_manager.resume_group_training(group_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot resume training")
    await fl_server.group_manager.notify_training_started(group_id)
    return {"status": "resumed", "group_id": group_id}


@app.post("/api/groups/{group_id}/stop")
async def stop_group_training(group_id: str):
    """Stop training for a group."""
    success = fl_server.group_manager.stop_group_training(group_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot stop training")
    await fl_server.group_manager.notify_training_stopped(group_id)
    return {"status": "stopped", "group_id": group_id}


@app.get("/api/groups/{group_id}/window-status")
async def get_group_window_status(group_id: str):
    """Get async window status for a group."""
    group = fl_server.group_manager.groups.get(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return {
        "group_id": group_id,
        "status": group.status,
        "is_training": group.is_training,
        "model_version": group.model_version,
        "window_status": group.get_window_status()
    }


@app.get("/api/clients")
async def list_clients():
    """List connected clients."""
    clients = fl_server.group_manager.get_all_client_status()
    logger = logging.getLogger(__name__)
    logger.info(f"[API-CLIENTS] Returning {len(clients)} clients")
    for c in clients:
        logger.info(f"  Client {c.get('client_id')} in group {c.get('group_id')}: acc={c.get('local_accuracy', 0):.4f}, loss={c.get('local_loss', 0):.4f}")
    return {"clients": clients, "count": len(clients)}


@app.get("/api/client/training-status")
async def get_client_training_status(request: Request):
    """Get training status for the authenticated client across all joined groups.
    
    Returns FL client entries matching the user's username, along with
    their group's training state, metrics, and model info.
    """
    if not fl_server:
        raise HTTPException(status_code=503, detail="Server not ready")
    
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No authorization token")
    
    token = auth_header.replace("Bearer ", "")
    
    try:
        from api.integration import get_platform_integration
        platform = get_platform_integration()
        payload = platform.verify_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token verification failed")
    
    username = payload.get("sub", "")
    user_id = payload.get("user_id")
    
    # Find all FL clients belonging to this user (pattern: {username}_{group_id})
    sessions = []
    for group_id, group in fl_server.group_manager.groups.items():
        for client_id, client_info in group.clients.items():
            # Match by username prefix or by user_id in client_info
            is_match = (
                client_id.startswith(f"{username}_") or
                client_info.get("user_id") == user_id or
                client_info.get("username") == username
            )
            if is_match:
                # Get the group's latest metrics
                latest_metrics = {}
                if group.metrics_history:
                    last = group.metrics_history[-1]
                    latest_metrics = {
                        "global_accuracy": last.get("accuracy", 0),
                        "global_loss": last.get("loss", 0),
                        "global_version": last.get("version", 0),
                    }
                
                sessions.append({
                    "client_id": client_id,
                    "group_id": group_id,
                    "model_id": group.model_id,
                    "group_status": group.status,
                    "is_training": group.is_training,
                    "local_accuracy": client_info.get("local_accuracy", 0),
                    "local_loss": client_info.get("local_loss", 0),
                    "trust_score": client_info.get("trust_score", 1.0),
                    "updates_count": client_info.get("updates_count", 0),
                    "last_update": client_info.get("last_update"),
                    "status": client_info.get("status", "idle"),
                    "joined_at": client_info.get("joined_at"),
                    "model_version": group.model_version,
                    "window_status": group.get_window_status(),
                    **latest_metrics,
                })
    
    # Also check which groups user has approved join requests for but hasn't activated yet
    pending_activations = []
    try:
        from api.integration import get_platform_integration
        platform = get_platform_integration()
        # Get all groups and check join status
        for group_id in fl_server.group_manager.groups:
            already_joined = any(s["group_id"] == group_id for s in sessions)
            if not already_joined:
                try:
                    status = platform.get_user_join_status(user_id, group_id)
                    if status and status.get("status") == "approved":
                        pending_activations.append({
                            "group_id": group_id,
                            "model_id": fl_server.group_manager.groups[group_id].model_id,
                            "status": "approved_not_activated",
                        })
                except Exception:
                    pass
    except Exception:
        pass
    
    # Check if any WebSocket client is connected for this user
    connected_ws_clients = []
    for client_id in fl_server.connection_manager.client_sockets:
        if client_id.startswith(f"{username}_"):
            connected_ws_clients.append(client_id)
    
    return {
        "username": username,
        "sessions": sessions,
        "pending_activations": pending_activations,
        "connected_clients": connected_ws_clients,
        "has_active_training": any(s["is_training"] for s in sessions),
    }


@app.get("/api/logs")
async def get_logs(limit: int = 100, event_type: str = None, group_id: str = None):
    """Get server event logs."""
    logs = fl_server.group_manager.get_logs(limit, event_type, group_id)
    return {"logs": logs, "count": len(logs)}


# ============================================================================
# WebSocket Endpoint
# ============================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket for live updates."""
    # Require JWT token on the WebSocket query string for authentication.
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008)
        return

    auth_manager = get_auth_manager()
    payload = auth_manager.verify_token(token)
    if not payload:
        await websocket.close(code=1008)
        return

    await fl_server.connection_manager.connect(websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get('type') == 'register':
                client_id = message.get('client_id')
                group_id = message.get('group_id', 'default')
                join_token = message.get('join_token')
                data_metadata = message.get('data_metadata', {})
                capabilities = message.get('capabilities', {})
                
                # Validate group and token
                group = fl_server.group_manager.groups.get(group_id)
                if not group:
                    await websocket.send_json({
                        'status': 'rejected',
                        'reason': 'group_not_found'
                    })
                else:
                    # Check if client is already registered in the group (activated via dashboard)
                    already_registered = client_id in group.clients
                    
                    # Check if client has approved join request (activated via REST API)
                    has_approved_join = False
                    if not already_registered and not join_token and payload:
                        try:
                            from api.integration import get_platform_integration
                            platform = get_platform_integration()
                            user_id = payload.get("user_id")
                            join_status = platform.get_user_join_status(user_id, group_id)
                            if join_status and join_status.get("status") in ("approved", "joined"):
                                has_approved_join = True
                        except Exception:
                            pass
                    
                    token_valid = (join_token and join_token == group.join_token)
                    
                    if not already_registered and not has_approved_join and not token_valid:
                        await websocket.send_json({
                            'status': 'rejected',
                            'reason': 'invalid_token'
                        })
                    else:
                        # Register client - be more lenient
                        try:
                            logger = logging.getLogger(__name__)
                            logger.info(f"[REGISTER] Registering client {client_id} to group {group_id}")
                            success = fl_server.group_manager.register_client(
                                client_id=client_id,
                                group_id=group_id,
                                client_info={
                                    'has_gpu': capabilities.get('has_gpu', False),
                                    'device': capabilities.get('device', 'cpu'),
                                    'data_metadata': data_metadata,
                                    'connection': 'websocket'
                                }
                            )
                            if success:
                                group = fl_server.group_manager.groups[group_id]
                                logger.info(f"[REGISTER] Client {client_id} registered. Group now has {len(group.clients)} clients: {list(group.clients.keys())}")
                                # Register websocket for sending messages to client
                                fl_server.connection_manager.register_client(client_id, websocket)
                                await websocket.send_json({
                                    'status': 'registered',
                                    'client_id': client_id,
                                    'group_id': group_id,
                                    'model_id': group.model_id
                                })
                            else:
                                await websocket.send_json({
                                    'status': 'rejected',
                                    'reason': 'registration_failed'
                                })
                        except Exception as e:
                            logger = logging.getLogger(__name__)
                            logger.error(f"Registration error: {e}")
                            await websocket.send_json({
                                'status': 'rejected',
                                'reason': f'registration_error: {str(e)}'
                            })
            
            elif message.get('type') == 'update':
                # Check if group is training
                try:
                    logger = logging.getLogger(__name__)
                    client_id = message.get('update', {}).get('client_id')
                    received_meta = message.get('update', {}).get('meta', {})
                    logger.info(f"[UPDATE-RECV] Client {client_id}: acc={received_meta.get('train_accuracy', 0):.4f}, loss={received_meta.get('train_loss', 0):.4f}")
                    group = fl_server.group_manager.get_client_group(client_id)
                    
                    if not group:
                        logger.warning(f"[UPDATE] Client {client_id} not found in any group")
                        await websocket.send_json({'status': 'rejected', 'reason': 'group_not_found'})
                        continue
                    
                    if not group.is_training:
                        logger.warning(f"[UPDATE] Group {group.group_id} not training")
                        await websocket.send_json({'status': 'rejected', 'reason': 'training_not_started'})
                        continue
                    
                    logger.info(f"[UPDATE] Processing update for client {client_id} in group {group.group_id}")
                    update_payload = fl_server.group_manager.normalize_update(message.get('update', {}))
                    update_result = fl_server.group_manager.process_client_update(client_id, update_payload)
                    
                    meta = message.get('update', {}).get('meta', {})
                    acc = meta.get('train_accuracy', 0)
                    loss = meta.get('train_loss', 0)
                    logger = logging.getLogger(__name__)
                    logger.info(f"[UPDATE] Client {client_id} in group {group.group_id}: acc={acc:.4f}, loss={loss:.4f}")
                    fl_server.group_manager.log_event('client_update', f'Client {client_id} sent update', group.group_id, {
                        'client_id': client_id,
                        'accuracy': acc,
                        'loss': loss
                    })
                    
                    if update_result.get('triggered') and update_result.get('aggregate'):
                        agg_result = fl_server.group_manager.aggregate_group(group.group_id)
                        if agg_result:
                            await fl_server.group_manager.broadcast_to_group(group.group_id, {
                                'type': 'model_update',
                                'version': agg_result['version'],
                                'group_id': group.group_id,
                                'accuracy': agg_result.get('accuracy', 0),
                                'loss': agg_result.get('loss', 0)
                            })
                            
                            if group.is_training and group.config.get('auto_continue', False):
                                asyncio.create_task(
                                    fl_server.group_manager.trigger_clients_training(group.group_id)
                                )
                    
                    await websocket.send_json({
                        'status': 'accepted',
                        'group_id': group.group_id,
                        'triggered': update_result.get('triggered', False),
                        'window_status': update_result.get('window_status')
                    })
                except Exception as e:
                    logger = logging.getLogger(__name__)
                    logger.error(f"Update handling error: {e}")
                    await websocket.send_json({'status': 'error', 'reason': 'update_failed'})

            elif message.get('type') == 'metrics':
                try:
                    logger = logging.getLogger(__name__)
                    client_id = message.get('client_id')
                    logger.debug(f"Received metrics from {client_id}")
                    
                    group = fl_server.group_manager.get_client_group(client_id)

                    if not group:
                        logger.warning(f"Group not found for client {client_id}")
                        await websocket.send_json({'status': 'rejected', 'reason': 'group_not_found'})
                        continue

                    metrics = message.get('meta', {})
                    if client_id in group.clients:
                        group.clients[client_id]['last_update'] = time.time()
                        group.clients[client_id]['local_accuracy'] = metrics.get('train_accuracy', 0)
                        group.clients[client_id]['local_loss'] = metrics.get('train_loss', 0)
                        logger.debug(f"Updated client {client_id} metrics: acc={metrics.get('train_accuracy', 0):.4f}, loss={metrics.get('train_loss', 0):.4f}")

                    fl_server.group_manager.log_event('client_metrics', f'Client {client_id} metrics', group.group_id, {
                        'client_id': client_id,
                        'accuracy': metrics.get('train_accuracy', 0),
                        'loss': metrics.get('train_loss', 0)
                    })

                    logger.debug(f"Sending metrics acknowledgment to {client_id}")
                    await websocket.send_json({'status': 'accepted', 'type': 'metrics'})
                    logger.info(f"Metrics from {client_id} processed successfully")
                except Exception as e:
                    logger = logging.getLogger(__name__)
                    logger.error(f"Metrics handling error: {e}", exc_info=True)
                    try:
                        await websocket.send_json({'status': 'error', 'reason': 'metrics_failed'})
                    except Exception as send_err:
                        logger.error(f"Failed to send error response: {send_err}")
    
    except WebSocketDisconnect:
        logger = logging.getLogger(__name__)
        logger.info("WebSocket disconnected normally")
        fl_server.connection_manager.disconnect(websocket)
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.error(f"WebSocket error: {e}", exc_info=True)
        fl_server.connection_manager.disconnect(websocket)


# ============================================================================
# Main
# ============================================================================

def run_server(host: str = "0.0.0.0", port: int = 8000):
    """Run the API server."""
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    run_server()
