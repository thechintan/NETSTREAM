# NetStream Live

A Twitch-style live streaming platform for a university Computer Networks project. Demonstrates networking protocols (TCP, UDP, WebSocket, WebRTC, HTTP/HLS) and network measurement.

## Quick start

### Prerequisites
- Node.js 20+
- pnpm 9+
- Docker & Docker Compose

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
