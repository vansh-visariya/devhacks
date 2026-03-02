# ASTRA — Async Scalable Training & Research Architecture

> A production-ready distributed **Federated Learning** platform with real-time networking, a dual-panel web dashboard (Admin + Client), robust aggregation, trust scoring, differential privacy, and model management.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Dashboard](#dashboard)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deployment](#deployment)

---

## Overview

ASTRA is a **Federated Learning (FL)** platform designed for distributed model training across multiple clients without centralizing sensitive data. It implements a **hybrid asynchronous windowed aggregation** strategy — clients submit model updates independently, and the server aggregates them when a configurable window of updates is reached or a time limit expires.

### Key Capabilities

- **Asynchronous Training** — Clients train at their own pace; no synchronized rounds required
- **Group-Based Training** — Multiple training groups can run simultaneously with separate models
- **Robust Aggregation** — Multiple strategies (FedAvg, Trimmed Mean, Krum, Median) to resist poisoning attacks
- **Trust & Reputation** — Byzantine-tolerant trust scoring with automatic quarantine of malicious clients
- **Differential Privacy** — Optional DP noise injection with configurable epsilon budgets
- **HuggingFace Integration** — Load any HF model and fine-tune with LoRA/PEFT across the federation
- **Real-Time Dashboard** — Admin and Client dashboards with live metrics, group management, and join request workflow

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        ASTRA Platform                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐     ┌─────────────────┐     ┌───────────┐  │
│  │   Admin     │     │   API Server    │     │  Client   │  │
│  │  Dashboard  │────▶│   (FastAPI)     │◀────│   App     │  │
│  │  :3000      │     │   :8000         │     │  (Python) │  │
│  └─────────────┘     └────────┬────────┘     └───────────┘  │
│                               │                              │
│  ┌─────────────┐     ┌───────┴────────┐     ┌───────────┐  │
│  │   Client    │     │  Core Engine   │     │  Model    │  │
│  │  Dashboard  │     │  - Aggregator  │     │  Registry │  │
│  │  :3000      │     │  - Privacy     │     │  - HF     │  │
│  └─────────────┘     │  - Trust       │     │  - Custom │  │
│                      │  - Compression │     │  - PEFT   │  │
│                      └────────────────┘     └───────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Auth System (JWT) │ Notifications │ Join Requests   │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow
1. **Admin** creates a training group with a model (HuggingFace or custom)
2. **Clients** browse available groups and request to join
3. **Admin** approves join requests from the dashboard
4. **Client** activates their membership → registers as an FL participant
5. **Training** starts automatically — clients train locally and submit updates
6. **Server** aggregates updates using the chosen strategy (FedAvg, Krum, etc.)
7. **Dashboard** shows real-time metrics, accuracy, loss, and client status

---

## Features

### Core Engine (`core_engine/`)

| Feature | File | Description |
|---------|------|-------------|
| Async Server | `server.py` | Asynchronous FL server with staleness-weighted aggregation |
| Aggregation | `aggregator.py` | Factory for aggregation strategies |
| Robust Aggregation | `robust_aggregation.py` | FedAvg, Trimmed Mean, Krum, Median — Byzantine-resilient |
| Trust Manager | `trust_manager.py` | Client reputation scoring, anomaly detection, quarantine |
| Differential Privacy | `privacy.py` | DP-SGD with per-client epsilon budgets and gradient clipping |
| Gradient Compression | `compression.py` | Top-k sparsification, quantization, random sketching |
| Heterogeneous Models | `heterogeneous_aggregation.py` | Aggregate updates from different model architectures |
| HuggingFace Models | `hf_models.py` | Load and fine-tune any HF transformer model |
| PEFT/LoRA | `hf_models.py` | Parameter-efficient fine-tuning across the federation |
| Model Zoo | `model_zoo.py` | Built-in CNN, MLP, ResNet architectures |
| Data Splitting | `data_splitter.py` | IID, Dirichlet, pathological splits for non-IID simulation |
| Personalization | `personalization.py` | Per-client model personalization layers |
| Inference | `inference.py` | Model inference and evaluation pipeline |
| Attack Demos | `attack_demos.py` | Byzantine, label-flip, and free-rider attack simulations |

### API Layer (`api/`)

| Feature | File | Description |
|---------|------|-------------|
| Authentication | `auth.py` | JWT-based auth with role verification (admin/client/observer) |
| User Management | `auth_system.py` | SQLite-backed user DB, signup, login, API keys, join requests |
| Platform Integration | `integration.py` | Orchestrates auth, notifications, trust, recommendations |
| Extended Endpoints | `extended_endpoints.py` | Group joining, notifications, trust scores, model recommendations |
| Notifications | `notifications.py` | In-app notification system with read/unread tracking |
| Model Recommender | `model_recommender.py` | AI-powered model recommendations via Gemini API |

### Networking (`networking/`)

| Feature | File | Description |
|---------|------|-------------|
| Server API | `server_api.py` | FastAPI server with REST + WebSocket, group management, experiment tracking |
| Client App | `client_app/client_app.py` | Python client with auto-reconnection, local training, model sync |

### Dashboard (`dashboard/`)

The dashboard is a **Next.js** application with two distinct interfaces:

#### Admin Dashboard (`/dashboard`)
- **Overview** — System metrics, active groups, aggregation stats
- **Groups** — Create/manage training groups, set models, configure window sizes
- **Group Detail** — Live participants, pending join requests (approve/reject), training logs
- **Logs** — Event timeline with filtering by type

#### Client Dashboard (`/client`)
- **Overview** — Personal stats, joined groups, quick actions
- **Groups** — Browse available groups, request to join, check approval status
- **Training** — Local training interface with progress tracking
- **Notifications** — Join approvals, training events, system alerts
- **Trust Score** — View personal trust/reputation metrics
- **Recommendations** — AI-powered model suggestions

---

## Project Structure

```
ASTRA/
├── api/                          # API layer
│   ├── auth.py                   # JWT auth middleware & dependencies
│   ├── auth_system.py            # User DB, join requests, API keys
│   ├── extended_endpoints.py     # Join flow, notifications, trust, inference
│   ├── integration.py            # Platform integration orchestrator
│   ├── model_recommender.py      # Gemini-powered model recommendations
│   └── notifications.py          # Notification service
│
├── core_engine/                  # FL core
│   ├── server.py                 # Async FL server
│   ├── client.py                 # Local client training logic
│   ├── aggregator.py             # Aggregation strategy factory
│   ├── robust_aggregation.py     # Byzantine-resilient aggregators
│   ├── trust_manager.py          # Trust scoring & quarantine
│   ├── privacy.py                # Differential privacy
│   ├── compression.py            # Gradient compression
│   ├── heterogeneous_aggregation.py  # Cross-architecture aggregation
│   ├── hf_models.py              # HuggingFace model integration
│   ├── model_zoo.py              # Built-in model architectures
│   ├── data_splitter.py          # Data distribution strategies
│   ├── personalization.py        # Per-client personalization
│   ├── inference.py              # Model inference pipeline
│   └── tests/                    # Unit tests
│
├── networking/
│   └── server_api.py             # FastAPI server (REST + WebSocket + groups)
│
├── client_app/
│   └── client_app.py             # Python FL client application
│
├── dashboard/                    # Next.js web dashboard
│   ├── app/
│   │   ├── login/                # Authentication page
│   │   ├── dashboard/            # Admin interface
│   │   │   ├── page.tsx          # Admin overview
│   │   │   ├── groups/           # Group management
│   │   │   ├── create/           # Create new group
│   │   │   └── logs/             # Event logs
│   │   └── client/               # Client interface
│   │       ├── page.tsx          # Client overview
│   │       ├── groups/           # Browse & join groups
│   │       ├── training/         # Training interface
│   │       ├── notifications/    # Notifications
│   │       ├── trust/            # Trust score
│   │       └── recommendations/  # Model recommendations
│   └── components/
│       └── AuthContext.tsx        # JWT auth context provider
│
├── model_registry/
│   └── registry.py               # Model registration & management
│
├── config.yaml                   # Default training configuration
├── docker-compose.yml            # Multi-service deployment
├── Dockerfile.server             # Server container
├── Dockerfile.client             # Client container
├── requirements.txt              # Python dependencies
└── Makefile                      # Build shortcuts
```

---

## Quick Start

### Prerequisites

- **Python 3.10+** with pip
- **Node.js 18+** with npm
- (Optional) Docker & Docker Compose

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/vansh-visariya/ASTRA.git
cd ASTRA

# 2. Create a virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
.venv\Scripts\activate     # Windows

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Start the API Server
python networking/server_api.py
# Server runs at http://localhost:8000

# 5. Start the Dashboard (new terminal)
cd dashboard
npm install
npm run dev
# Dashboard runs at http://localhost:3000

# 6. (Optional) Run a Python client
python client_app/client_app.py --server http://localhost:8000 --client-id client_1
```

### Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Default Credentials

After starting the server, register users via the dashboard login page:
- Sign up with role **admin** to access the admin dashboard
- Sign up with role **client** to access the client dashboard

---

## Dashboard

### Group Join Workflow

```
Client                          Server                          Admin
  │                               │                               │
  │  1. Browse Groups             │                               │
  │──────────────────────────────▶│                               │
  │        Group List             │                               │
  │◀──────────────────────────────│                               │
  │                               │                               │
  │  2. Request to Join           │                               │
  │──────────────────────────────▶│  3. Notify Admin              │
  │        "Pending"              │──────────────────────────────▶│
  │◀──────────────────────────────│                               │
  │                               │                               │
  │                               │  4. Approve Request           │
  │  5. Status → "Approved"       │◀──────────────────────────────│
  │◀──────────────────────────────│                               │
  │                               │                               │
  │  6. Click "Join Group"        │                               │
  │──────────────────────────────▶│                               │
  │        "Joined" ✓             │  7. Client in Participants    │
  │◀──────────────────────────────│──────────────────────────────▶│
  │                               │                               │
  │  8. Training Starts           │                               │
  │◀─────────────────────────────▶│                               │
```

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/signup` | Register a new user |
| `POST` | `/api/auth/login` | Login and get JWT token |

### Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/groups` | List all training groups |
| `POST` | `/api/groups` | Create a new group (admin) |
| `GET` | `/api/groups/{group_id}` | Get group details |
| `POST` | `/api/groups/{group_id}/start` | Start training (admin) |
| `POST` | `/api/groups/{group_id}/pause` | Pause training (admin) |
| `POST` | `/api/groups/{group_id}/resume` | Resume training (admin) |
| `POST` | `/api/groups/{group_id}/stop` | Stop training (admin) |

### Join Requests

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/join/join-request` | Request to join a group (client) |
| `GET` | `/api/join/join-requests` | List pending requests (admin) |
| `POST` | `/api/join/join-requests/approve` | Approve a request (admin) |
| `POST` | `/api/join/join-requests/reject` | Reject a request (admin) |
| `GET` | `/api/join/my-requests/{group_id}` | Check own request status (client) |
| `POST` | `/api/join/activate/{group_id}` | Activate membership after approval (client) |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/notifications` | Get user notifications |
| `GET` | `/api/notifications/unread-count` | Get unread count |
| `POST` | `/api/notifications/{id}/read` | Mark as read |

### Models

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/models` | List registered models |
| `POST` | `/api/models/register` | Register a new model |
| `POST` | `/api/models/register/hf` | Register a HuggingFace model |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/server/status` | Server status |
| `GET` | `/api/system/metrics` | System-wide metrics |
| `GET` | `/api/clients` | List all clients |
| `GET` | `/api/clients/connected` | List connected clients |
| `GET` | `/health` | Health check |
| `WS` | `/ws` | WebSocket for live updates |

---

## Configuration

### Environment Variables

```bash
ENV=dev                         # "dev" or "prod"
SECRET_KEY=your-secure-key      # JWT signing secret (REQUIRED in prod)
SERVER_PORT=8000                # API server port
NEXT_PUBLIC_API_URL=http://localhost:8000  # Dashboard → API URL
GEMINI_API_KEY=your-key         # (Optional) For model recommendations
```

### Training Configuration (`config.yaml`)

```yaml
seed: 42
dataset:
  name: MNIST
  split: dirichlet
  dirichlet_alpha: 0.3

model:
  type: cnn
  cnn:
    name: simple_cnn

client:
  num_clients: 10
  local_epochs: 2
  batch_size: 32
  lr: 0.01

server:
  optimizer: sgd
  server_lr: 0.5
  momentum: 0.9
  aggregator_window: 5         # Updates before aggregation

robust:
  method: fedavg                # fedavg | trimmed_mean | krum | median
  trim_ratio: 0.1

privacy:
  dp_enabled: false
  epsilon: 1.0
  delta: 1e-5
  max_grad_norm: 1.0
```

### Aggregation Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `fedavg` | Federated Averaging | General use, trusted clients |
| `trimmed_mean` | Trims extreme values | Moderate Byzantine resilience |
| `krum` | Selects most representative update | Strong Byzantine defense |
| `median` | Coordinate-wise median | Robust to outliers |

---

## Testing

```bash
# Unit tests
pytest core_engine/tests/ -v

# Integration test (simulates 3 local clients)
python tests/integration_local.py
```

---

## Deployment

### Services

| Service | Port | Description |
|---------|------|-------------|
| API Server | 8000 | FastAPI REST + WebSocket + FL Engine |
| Dashboard | 3000 | Next.js Admin + Client UI |

### Production Checklist

- [ ] Set `ENV=prod` and a strong `SECRET_KEY`
- [ ] Configure CORS origins for your domain
- [ ] Set up HTTPS termination (nginx/traefik)
- [ ] Use a persistent database (migrate from SQLite)
- [ ] Set up monitoring and logging
- [ ] Configure rate limiting

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Python, FastAPI, Uvicorn |
| Frontend | Next.js 14, React, TypeScript, Tailwind CSS |
| ML | PyTorch, HuggingFace Transformers, PEFT |
| Database | SQLite (users, experiments, notifications) |
| Auth | JWT (PyJWT), bcrypt |
| Real-time | WebSocket, Socket.IO |
| Deployment | Docker, Docker Compose |

---

## License

This project is for research and educational purposes.
