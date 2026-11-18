# NetStream Live

A high-performance, Twitch-style live streaming platform built for a university Computer Networks project. Demonstrates foundational and advanced networking protocols—**TCP**, **UDP**, **WebSocket**, **WebRTC (ICE, STUN/TURN, DTLS-SRTP, RTP/RTCP)**, and **HTTP/HLS**—paired with empirical network impairment and performance measurement tooling.

---

## Feature Checklist by Tier

- [x] **Tier 1: Foundation & Data Layer**
  - Modular monorepo with pnpm workspaces and strict TypeScript.
  - PostgreSQL 16 database with Drizzle ORM migrations and schema relationships.
  - Redis 7 for high-throughput pub/sub, atomic connection tickets, presence, and rate limits.
  - Fastify REST API with `@fastify/helmet` CSP, `@fastify/cors`, and Argon2id password hashing.
  - One-time ticket authentication handshake over WebSocket (`POST /api/ws-ticket` -> `/ws?ticket=...`).

- [x] **Tier 2: Real-Time Media (WebRTC SFU)**
  - Mediasoup C++ Selective Forwarding Unit (SFU) with multi-worker CPU core pooling.
  - Sub-second glass-to-glass latency (150–250ms) over encrypted DTLS-SRTP.
  - Broadcaster WebRTC simulcast with 3 spatial resolution encodings (1080p high, 720p medium, 360p low).
  - Dynamic viewer layer switching (`media.setLayers`) with PLI/FIR keyframe resynchronization.
  - NAT traversal with ICE-Lite, STUN candidate discovery, and ephemeral HMAC-authenticated TURN relay via Coturn.

- [x] **Tier 3: Live Interactivity & Moderation**
  - Ultra-low latency chat powered by Redis Pub/Sub (bypassing PostgreSQL on the hot path).
  - Asynchronous write-behind persistence flushing chat batches to PostgreSQL.
  - Channel moderation matrix: bans, timeouts, message deletions, and slow-mode limits.
  - Real-time concurrent viewer counting and presence tracking.
  - Live broadcast notifications push for online followers.

- [x] **Tier 4: Resilience, Fallback & Archival**
  - Disconnect grace period (30s) allowing broadcasters to reconnect without dropping viewers.
  - Background HLS live pipeline: PlainTransport RTP streaming to FFmpeg with 2-second segments.
  - Automated VOD recording with full HLS event playlist generation, duration probing, and owner deletion.
  - VOD retention cleanup worker.

- [x] **Tier 5: Socket Programming Labs & Measurement**
  - Raw Python TCP lab: stream-safe chunk framing, SHA-256 integrity verification, path traversal guards.
  - Custom binary UDP lab: struct-packed 24-byte headers, sequence tracking, drop simulation, jitter calculation.
  - Automated Playwright multi-viewer load bot collecting live WebRTC getStats metrics.
  - Linux `tc netem` impairment scripts (loss, delay, jitter, rate limiting) and Matplotlib visualization charts.

---

## Architecture at a Glance

NetStream Live utilizes a **Selective Forwarding Unit (SFU)** rather than an MCU. Broadcasters stream their camera and microphone once; the SFU selectively routes RTP packets directly to connected viewers without server-side re-encoding.

```
Broadcaster (Webcam) ──WebRTC (UDP/SRTP)──> [ Mediasoup SFU ] ──WebRTC (UDP/SRTP)──> Viewers
         │                                         │
         ├─── WebSocket (Control/Chat/Signaling) ──┴──> [ Fastify + Redis ]
         └─── PlainTransport (RTP loopback) ──────────> [ FFmpeg ] ──> HLS / VOD (/hls, /vod)
```

For complete architectural diagrams and sequence flows, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Quick Start (Development)

### Prerequisites
* **Node.js**: v20+
* **pnpm**: v9+
* **Docker & Docker Compose** (for PostgreSQL, Redis, and Coturn)
* **Python**: 3.10+ (for Python socket labs)
* **FFmpeg** (optional, required for HLS fallback and VOD generation)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/netstream-live.git
cd netstream-live
pnpm install
```

### 2. Environment Configuration
```bash
cp .env.example .env
```

### 3. Start Infrastructure Containers
```bash
docker compose -f infra/docker-compose.yml up -d
```
* PostgreSQL: `localhost:5432` (or configured port)
* Redis: `localhost:6379`
* Coturn (STUN/TURN): `localhost:3478`

### 4. Run Database Migrations & Seeds
```bash
pnpm --filter @netstream/server db:migrate
pnpm --filter @netstream/server db:seed
```

### 5. Launch Development Servers
```bash
pnpm dev
```
* **Web App (Vite)**: [http://localhost:5173](http://localhost:5173)
* **API & WebSocket Server**: [http://localhost:3000](http://localhost:3000)
* **Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

---

## Quick Start (Production Docker Stack)

Run the complete multi-container stack (Caddy, Fastify Server, Mediasoup, Coturn, Postgres, Redis):
```bash
docker compose -f infra/docker-compose.prod.yml up -d --build
```
Access the application directly at `http://localhost`.

---

## Repository Structure

```
netstream-live/
├── apps/
│   ├── server/             # Node.js 20 Fastify + Mediasoup SFU modular monolith
│   └── web/                # React + Vite + Tailwind CSS live streaming client
├── packages/
│   └── shared/             # Shared TypeScript schemas, DTOs, and protocol definitions
├── lab/
│   ├── tcp/                # Python raw TCP socket server & client lab
│   ├── udp/                # Python binary UDP packet & jitter tracking lab
│   ├── experiments/        # Playwright viewer load bots & Linux netem scripts
│   └── analysis/           # Matplotlib automated chart generation
├── infra/
│   ├── docker-compose.yml  # Local dev infrastructure (Postgres, Redis, Coturn)
│   ├── docker-compose.prod.yml # Production multi-container deployment
│   ├── coturn.conf         # Coturn STUN/TURN configuration
│   └── Caddyfile           # Reverse proxy configuration
└── docs/                   # Authoritative architecture, protocol, and lab docs
```

---

## Available Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Run all workspace dev servers concurrently |
| `pnpm build` | Typecheck and build all workspace packages |
| `pnpm test` | Run Vitest unit & integration test suites |
| `pnpm typecheck` | Validate TypeScript types across all projects |
| `pnpm lint` | Run ESLint checks across workspace |
| `pnpm test:e2e` | Run Playwright Chromium end-to-end tests |

---

## Documentation Index

* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — System architecture, Mermaid diagrams, and ports table.
* [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — Comprehensive WebSocket protocol and REST API specification.
* [`docs/WEBRTC_NOTES.md`](docs/WEBRTC_NOTES.md) — ICE, STUN/TURN, DTLS-SRTP, RTP/RTCP, NACK, PLI, and TWCC guide.
* [`docs/LAB.md`](docs/LAB.md) — Instructions for TCP/UDP labs and empirical experiments E2–E8.
* [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — 7-minute live presentation walkthrough and fallback plans.
* [`docs/VIVA_QA.md`](docs/VIVA_QA.md) — 30+ networking viva examination questions with code references.
* [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — Honest architectural and scaling limitations.

---

## Troubleshooting

* **Mediasoup Worker Compilation on Windows**:
  * Mediasoup automatically downloads prebuilt C++ binaries during `pnpm install`. If native compilation triggers, ensure Visual Studio C++ Build Tools (MSVC) or Python 3.10+ is installed.
* **Camera / Microphone Access in Browser**:
  * Chrome requires HTTPS or `localhost` for `getUserMedia()`. For remote LAN testing, use the automated Playwright bot with fake media flags: `pnpm exec tsx lab/experiments/viewers.ts --auto-publish`.
* **Port Conflicts**:
  * If port `3000`, `5173`, or `6379` is already bound, check running containers with `docker ps` or terminate lingering Node processes.
* **HLS Playback Missing**:
  * Verify `ffmpeg -version` is accessible on system `PATH`. If omitted, HLS disables gracefully while WebRTC continues operating.
