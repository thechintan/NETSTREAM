# Architectural & System Limitations

This document provides an honest, production-focused assessment of the current architectural and operational limitations of NetStream Live.

---

### 1. Single-Node Selective Forwarding Unit (SFU)
* **No Inter-SFU Cascading**: Mediasoup routers run in worker threads on a single host machine (`apps/server/src/media/worker-pool.ts`). There is no multi-region SFU cascading (e.g., relaying RTP between edge relays and core origin servers as Twitch or YouTube Live do).
* **Concurrent Viewer Ceiling**: Bounded by server egress network bandwidth and CPU thread count. A 1080p stream at 3.5 Mbps saturates a 1 Gbps network uplink at approximately 250–280 concurrent WebRTC viewers per server instance. Beyond this threshold, viewers must fall back to CDN-cached HLS.

---

### 2. State & Process Topology
* **In-Memory Signaling & Media State**: `RoomManager` (`apps/server/src/media/room-manager.ts`) holds Mediasoup `Router`, `Transport`, `Producer`, and `Consumer` objects in Node.js process heap memory.
* **Server Restart & Failover**: If the Node.js server process terminates abruptly, active WebRTC peer connections immediately disconnect. While database streams are marked `OFFLINE` on reboot (`recoverCrashedStreamsOnBoot`), sessions cannot seamlessly migrate across server restarts without reconnection.

---

### 3. Simulcast vs Server-Side Transcoding
* **Selective Forwarding Only**: Mediasoup is an SFU, not an MCU (Multipoint Control Unit). It forwards incoming RTP packets without decoding or re-encoding video.
* **Broadcaster-Dependent Layers**: Multi-quality streams (1080p, 720p, 360p) rely completely on client-side WebRTC simulcast (`apps/web/src/features/studio/usePublisher.ts`). If a broadcaster’s upload bandwidth drops or their browser lacks hardware encoder capacity, lower-resolution layers cannot be synthesized by the server.

---

### 4. Chat Persistence & Redis Flush Durability
* **Asynchronous Write-Behind**: Chat messages are immediately pushed to Redis pub/sub and an in-memory queue (`apps/server/src/chat/persistence.ts`). Batches are written to PostgreSQL every 1 second or 100 messages.
* **Durability Window**: An ungraceful system crash or abrupt termination of both Redis and Node.js within that 1-second interval could result in loss of unflushed chat history.

---

### 5. ICE & NAT Traversal Topology
* **ICE-Lite SFU**: Mediasoup operates in ICE-Lite mode (`apps/server/src/media/transport.ts`). The server responds to STUN binding requests but never initiates checks. Broadcasters and viewers behind strict symmetric NATs or corporate firewalls require a dedicated TURN relay (`TURN_HOST` / Coturn) over UDP/TCP port 3478 or TLS port 5349.
* **NAT Loopback & LAN Broadcast**: In local network testing, broadcasters and viewers on the same LAN require `PUBLIC_IP` or `ANNOUNCED_IP` configured with the host's actual local IPv4 address (e.g. `192.168.x.x`), as NAT loopback may fail on typical consumer routers.

---

### 6. HLS Latency Tradeoff
* **HLS Segment Latency**: While WebRTC achieves sub-300ms latency, the fallback HLS live stream (`apps/server/src/recording/hls-pipeline.ts`) runs with 2-second segments and a 6-segment playlist window, producing 6–12 seconds of end-to-end latency.
* **Host Dependency**: HLS packaging depends on an external `ffmpeg` binary installed on the host `PATH`. If missing, HLS degrades gracefully with warnings while WebRTC continues operating.
