# WebRTC Protocol & Architecture Notes

This document details the networking protocols, RFC standards, and media mechanisms implemented in NetStream Live, with exact source references across the codebase.

---

## 1. NAT Traversal: ICE, STUN & TURN

### ICE (Interactive Connectivity Establishment - RFC 8445)
* **Mediasoup Mode: ICE-Lite**
  * Configured in [`apps/server/src/media/transport.ts`](file:///d:/CN%20Project/apps/server/src/media/transport.ts) via `router.createWebRtcTransport({ listenInfos: [...] })`.
  * In ICE-Lite mode, the server is a passive responder with fixed listening IP addresses (`PUBLIC_IP` / `ANNOUNCED_IP`) and never initiates outbound connectivity checks. Clients act as Full ICE agents and perform STUN checks against the server's candidates.
* **ICE Restart**
  * When a client switches networks (e.g. Wi-Fi to cellular) or connectivity drops, the client requests `media.restartIce` over WebSocket ([`apps/server/src/media/handlers.ts`](file:///d:/CN%20Project/apps/server/src/media/handlers.ts)), invoking `transport.restartIce()` to issue fresh ufrag/pwd candidates without terminating active tracks.

### STUN (Session Traversal Utilities for NAT - RFC 5389)
* **Purpose**: Allows clients behind NAT to discover their public-facing IP address and port mapping (server-reflexive candidate `srflx`).
* **Implementation**: The Coturn container in [`infra/coturn.conf`](file:///d:/CN%20Project/infra/coturn.conf) listens on UDP/TCP port `3478`.

### TURN (Traversal Using Relays around NAT - RFC 8656)
* **Purpose**: Provides media relay candidates (`relay`) when symmetric NATs or enterprise firewalls prevent direct peer-to-host or peer-to-peer UDP.
* **Time-Limited HMAC Authentication**:
  * Implemented in [`apps/server/src/media/ice-config.ts`](file:///d:/CN%20Project/apps/server/src/media/ice-config.ts) and exposed via `GET /api/ice-config`.
  * Generates short-lived credentials (valid for 1 hour):
    * `username = "<expiryTimestamp>:<userId>"`
    * `credential = base64(HMAC-SHA1(username, TURN_SECRET))`
  * Validated against Coturn's `use-auth-secret` and `static-auth-secret` directive.

---

## 2. Media Encryption: DTLS-SRTP

* **DTLS (Datagram Transport Layer Security - RFC 6347 / RFC 8842)**
  * Handles mutual handshake between browser and mediasoup worker on top of the established ICE transport.
  * WebRTC clients produce local DTLS parameters (`role`, `fingerprints`). Mediasoup securely handles the server certificate fingerprint and establishes keying material.
* **SRTP (Secure Real-time Transport Protocol - RFC 3711)**
  * Encrypts outgoing and decrypts incoming RTP audio and video packets using keys derived during the DTLS handshake.
  * Handled natively in C++ inside the `mediasoup-worker` core process.

---

## 3. Real-Time Transport: RTP & RTCP

### RTP (Real-Time Transport Protocol - RFC 3550)
* Transports packetized media frames with:
  * **Payload Type (PT)**: Codec identification (e.g., VP8 = 96, H.264 = 100, Opus = 111).
  * **Sequence Numbers (16-bit)**: Detects packet loss and re-orders received packets.
  * **Timestamps (32-bit)**: Clock synchronization and jitter buffer alignment.
  * **Synchronization Source (SSRC)**: Uniquely identifies each media track and simulcast stream.

### RTCP (RTP Control Protocol - RFC 3550)
* Periodically exchanges transmission quality statistics between sender and receiver:
  * **Sender Reports (SR)**: Transmission timestamps and cumulative byte/packet counts.
  * **Receiver Reports (RR)**: Fraction lost, cumulative packet loss, inter-arrival jitter, and round-trip time (RTT).

### Packet Recovery: NACK (RFC 4585)
* When a gap in RTP sequence numbers is detected by the receiver (e.g. SFU or browser), a **NACK (Negative Acknowledgment)** feedback packet is sent upstream.
* The sender or SFU maintains an RTP packet buffer to retransmit the requested missing packet without introducing TCP head-of-line blocking.

### Fast Frame Resynchronization: PLI & FIR
* **PLI (Picture Loss Indication - RFC 4585)** & **FIR (Full Intra Request - RFC 5104)**:
  * Sent upstream when a new viewer connects, when a quality layer switches, or when packet loss corrupts an existing GOP (Group of Pictures).
  * Forces the broadcaster's video encoder to immediately produce a complete keyframe (IDR frame).
  * Invoked server-side via `consumer.requestKeyFrame()` in [`apps/server/src/media/lifecycle.ts`](file:///d:/CN%20Project/apps/server/src/media/lifecycle.ts) and [`apps/server/src/recording/hls-pipeline.ts`](file:///d:/CN%20Project/apps/server/src/recording/hls-pipeline.ts).

### Congestion Control: TWCC (Transport-Wide Congestion Control)
* Broadcasters and consumers tag each outgoing RTP packet with a transport-wide 16-bit sequence number header extension.
* Receivers send periodic feedback packets reporting the exact arrival timestamp of every packet.
* The sender runs a Bandwidth Estimation (BWE) algorithm (such as Google Congestion Control / GCC) to dynamically adjust encoding bitrates and prevent queue bloat.

---

## 4. Multi-Quality Simulcast

### Broadcaster Configuration
Simulcast encodings are declared in [`apps/web/src/features/studio/usePublisher.ts`](file:///d:/CN%20Project/apps/web/src/features/studio/usePublisher.ts):
```typescript
encodings: [
  { rid: 'r0', maxBitrate: 500_000, scaleResolutionDownBy: 4.0 },  // 360p (Low)
  { rid: 'r1', maxBitrate: 1_500_000, scaleResolutionDownBy: 2.0 }, // 720p (Medium)
  { rid: 'r2', maxBitrate: 3_500_000, scaleResolutionDownBy: 1.0 }  // 1080p (Source / High)
]
```

### SFU Selective Forwarding
* The server ingests all 3 spatial streams via a single `Producer`.
* Each viewer's `Consumer` selectively forwards only **one** stream layer at any given time.
* **Dynamic Layer Switching**:
  * Handled via `media.setLayers` request in [`apps/server/src/media/handlers.ts`](file:///d:/CN%20Project/apps/server/src/media/handlers.ts) calling `consumer.setPreferredLayers({ spatialLayer, temporalLayer })`.
  * The SFU switches streams cleanly at the next keyframe boundary to eliminate video freezing or decoding artifacts.
