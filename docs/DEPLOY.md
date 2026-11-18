# NetStream Live - Deployment & Operations Guide

## 1. Network & Firewall Checklist

For NetStream Live to function across networks or on the public Internet, the following ports must be open in your firewall / cloud security groups (e.g. AWS Security Groups, GCP Firewall Rules, UFW, Windows Defender):

| Port / Range | Protocol | Service | Description | Direction |
| :--- | :--- | :--- | :--- | :--- |
| **80** | TCP | Caddy | HTTP (redirects to HTTPS) | Inbound |
| **443** | TCP | Caddy | HTTPS & WSS (Reverse proxy to web, REST API, WebSocket) | Inbound |
| **3478** | UDP & TCP | coturn | STUN / TURN standard signaling | Inbound |
| **5349** | TCP | coturn | TURN over TLS | Inbound |
| **40000-40100** | UDP & TCP | mediasoup SFU | WebRTC Media RTP/RTCP transport range | Inbound |
| **49152-49252** | UDP | coturn | TURN media relay allocated port range | Inbound |
| **5432 / 5433** | TCP | PostgreSQL | Database (internal container network only; do NOT expose) | Internal |
| **6379** | TCP | Redis | Cache & Pub/Sub (internal container network only; do NOT expose) | Internal |

---

## 2. Docker Desktop Limitations (Windows & macOS)

> [!WARNING]
> **UDP Port Forwarding on Docker Desktop:**
> WebRTC streams high-bitrate video/audio packets using UDP. Docker Desktop on Windows (WSL2) and macOS routes container UDP traffic through a user-space proxy (`vpnkit` / `wsl-proxy`). Under multi-streamer loads, this user-space bridge introduces packet loss, jitter, and high CPU usage.
>
> **Recommendations:**
> - **Production**: Deploy on native Linux (Ubuntu, Debian, AlmaLinux) using Docker with host networking (`network_mode: host`) or direct container port bindings.
> - **Local Development & LAN Testing on Windows/macOS**: Run the database, Redis, and coturn in Docker, and run the server natively via `pnpm dev` on the host OS.

---

## 3. Production Deployment Commands

### Single-Command Start
Build and start all production services (Caddy, Server with FFmpeg, Postgres 16, Redis 7, coturn):
```bash
docker compose -f infra/docker-compose.prod.yml up --build -d
```

### Run Migrations & Seed
Migrations run automatically on container boot via `apps/server/entrypoint.sh`.
To manually seed initial categories and demo accounts:
```bash
docker compose -f infra/docker-compose.prod.yml exec server node dist/db/seed.js
```

### View Service Logs
```bash
docker compose -f infra/docker-compose.prod.yml logs -f
```

### Graceful Shutdown
```bash
docker compose -f infra/docker-compose.prod.yml down
```

---

## 4. LAN Demo Setup

To demonstrate on a local Wi-Fi network (e.g. streaming from a phone camera to a laptop):

1. **Run the LAN setup helper:**
   ```bash
   ./scripts/lan-demo.sh
   # Or on Windows PowerShell:
   .\scripts\lan-demo.ps1
   ```
2. **Start the containers:**
   ```bash
   docker compose -f infra/docker-compose.prod.yml up --build
   ```
3. **Open from any device on Wi-Fi:**
   Navigate to `https://<YOUR_LAN_IP>` (e.g. `https://192.168.1.50`).

### Why HTTPS is Mandatory
Web browsers enforce the W3C **Secure Context** specification. Camera and microphone access (`navigator.mediaDevices.getUserMedia`) is completely disabled by browser security policies on remote network origins unless served over HTTPS. Caddy's internal TLS (`tls internal`) ensures all LAN devices receive a secure context.
