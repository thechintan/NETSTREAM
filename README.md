# NetStream Live

A Twitch-style live streaming platform for a university Computer Networks project. Demonstrates networking protocols (TCP, UDP, WebSocket, WebRTC, HTTP/HLS) and network measurement.

## Quick start

### Prerequisites
- Node.js 20+
- pnpm 9+
- Docker & Docker Compose
- **Media SFU / mediasoup OS prerequisites**:
  - Python 3.10+
  - GNU Make
  - C++ compiler (Visual Studio MSVC / Clang / GCC)
  - On Windows: prebuilt binaries are automatically fetched; if building native worker from source, use MSVC or WSL2 (Ubuntu with build-essential).

### 1. Install dependencies
```bash
pnpm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

### 3. Start infrastructure (PostgreSQL & Redis)
```bash
docker compose -f infra/docker-compose.yml up -d
```

### 4. Run development servers
```bash
pnpm dev
```
- Web Application: [http://localhost:5173](http://localhost:5173)
- API Server: [http://localhost:3000](http://localhost:3000)
- Health Check: [http://localhost:3000/api/health](http://localhost:3000/api/health)

### Verification Commands
```bash
# Typecheck across packages
pnpm typecheck

# Lint codebase
pnpm lint

# Run unit tests
pnpm test
```
