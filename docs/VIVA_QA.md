# NetStream Live: Computer Networks Viva & Exam Questions (30+ Q&A)

This document contains 32 technical examination questions and comprehensive answers referenced directly to the repository codebase.

---

### Category 1: Transport Layer (TCP vs UDP)

#### Q1: Why is UDP chosen over TCP for live video transmission in WebRTC?
* **Answer**: TCP enforces in-order, guaranteed delivery using retransmissions. When a packet is lost in TCP, all subsequent packets must wait in the buffer (head-of-line blocking), causing latency to spike into seconds. Live interactive streaming prioritizes timeliness over absolute reliability; dropping an occasional video frame is preferable to buffering. WebRTC runs over UDP and uses NACK feedback to retransmit only if the packet can arrive before its playout deadline.
* **Code Reference**: [`apps/server/src/media/transport.ts`](file:///d:/CN%20Project/apps/server/src/media/transport.ts) configuring UDP WebRtcTransport.

#### Q2: What is Head-of-Line (HoL) Blocking and how does this project demonstrate it?
* **Answer**: HoL blocking occurs when a lost or delayed packet blocks subsequent packets from being processed by the application. In our TCP lab ([`lab/tcp/protocol.py`](file:///d:/CN%20Project/lab/tcp/protocol.py)), packets must arrive strictly in sequence. In contrast, our UDP lab ([`lab/udp/receiver.py`](file:///d:/CN%20Project/lab/udp/receiver.py)) processes datagrams out-of-order and tracks sequence gaps independently.

#### Q3: How does the TCP lab client and server handle stream-based framing?
* **Answer**: TCP is a stream-oriented protocol without message boundaries. Multiple `send()` calls can merge into a single `recv()` (TCP packet coalescing), or a single message can be split across packets. [`lab/tcp/protocol.py`](file:///d:/CN%20Project/lab/tcp/protocol.py) implements `BufferedReader.read_line()` which accumulates chunks into a byte buffer until a newline `\n` delimiter is found, ensuring message framing integrity.

#### Q4: How is data integrity guaranteed during file transfers in the TCP lab?
* **Answer**: The server calculates a SHA-256 hash of the requested file and sends it in the response header (`OK|<size>|<sha256>`). The client streams the raw payload into a local hash accumulator (`hashlib.sha256()`) and verifies that the computed hash matches the server's header before saving ([`lab/tcp/client.py`](file:///d:/CN%20Project/lab/tcp/client.py)).

---

### Category 2: NAT Traversal, ICE, STUN & TURN

#### Q5: What is the difference between Full ICE and ICE-Lite?
* **Answer**: Full ICE agents initiate connectivity checks by sending STUN binding requests to all remote candidate pairs. ICE-Lite is a simplified implementation for servers with public, reachable IP addresses; the server only responds to incoming STUN requests and never initiates checks. Mediasoup operates in ICE-Lite mode.
* **Code Reference**: [`apps/server/src/media/transport.ts`](file:///d:/CN%20Project/apps/server/src/media/transport.ts).

#### Q6: When does a WebRTC client need a TURN server instead of STUN?
* **Answer**: STUN resolves the public server-reflexive (`srflx`) address for Full Cone, Restricted Cone, and Port-Restricted Cone NATs. However, when both peers (or a peer and an SFU behind restricted ports) are behind Symmetric NATs, the external port mapping changes for every distinct destination IP/port. Direct peer-to-peer UDP fails, necessitating a TURN relay server that relays media packets over fixed UDP/TCP ports.
* **Code Reference**: [`infra/coturn.conf`](file:///d:/CN%20Project/infra/coturn.conf).

#### Q7: How are secure, time-limited TURN credentials generated without storing passwords in Coturn?
* **Answer**: NetStream Live implements the TURN REST API ephemeral credentials standard (RFC 5766). The server signs an expiry timestamp and user ID using HMAC-SHA1 and the shared secret `TURN_SECRET`. Coturn verifies this HMAC locally without querying a database.
* **Code Reference**: `generateIceConfig()` in [`apps/server/src/media/ice-config.ts`](file:///d:/CN%20Project/apps/server/src/media/ice-config.ts).

#### Q8: What is an ICE candidate and what types exist?
* **Answer**: An ICE candidate is a candidate transport address (IP and port). The three main types are:
  1. `host`: Local interface IP address on the physical machine.
  2. `srflx` (Server Reflexive): Public IP and port allocated by a STUN server.
  3. `relay`: Relayed address allocated by a TURN server.

#### Q9: What happens during an ICE Restart?
* **Answer**: When a client changes network interfaces (e.g. Wi-Fi drops to 5G), the existing ICE transport becomes invalid. Instead of renegotiating SDP and terminating active tracks, the client requests `media.restartIce`. The SFU generates fresh ICE `usernameFragment` and `password` parameters, allowing seamless handover without freezing playback.
* **Code Reference**: `handleMediaRestartIce()` in [`apps/server/src/media/handlers.ts`](file:///d:/CN%20Project/apps/server/src/media/handlers.ts).

---

### Category 3: Security & Encryption (DTLS-SRTP)

#### Q10: How does WebRTC encrypt audio and video in transit?
* **Answer**: WebRTC enforces end-to-end transport security using DTLS-SRTP. First, a DTLS handshake is performed over the established UDP ICE connection to authenticate fingerprints and negotiate symmetric cipher keys. Once keys are derived, media packets are encrypted using SRTP (Secure Real-Time Transport Protocol) and SRTCP.
* **Code Reference**: Handled natively in Mediasoup C++ core; parameters negotiated in [`apps/server/src/media/transport.ts`](file:///d:/CN%20Project/apps/server/src/media/transport.ts).

#### Q11: How is the WebSocket signaling channel authenticated against ticket hijacking?
* **Answer**: Clients do not connect to `/ws` with a long-lived JWT. Instead, they make a REST call to `POST /api/ws-ticket` to generate a random ULID ticket stored in Redis with a 30-second TTL. The WebSocket server redeems the ticket using an atomic Redis `GETDEL` command; once consumed, the ticket is invalid, preventing replay attacks.
* **Code Reference**: `createTicket()` & `redeemTicket()` in [`apps/server/src/auth/ticket.ts`](file:///d:/CN%20Project/apps/server/src/auth/ticket.ts).

#### Q12: How are user passwords hashed?
* **Answer**: User passwords are encrypted using Argon2id (RFC 9106 recommended parameters: memory cost 64 MB, time cost 3 iterations, parallelism 1 thread), preventing GPU and ASIC brute-force attacks.
* **Code Reference**: [`apps/server/src/auth/crypto.ts`](file:///d:/CN%20Project/apps/server/src/auth/crypto.ts).

---

### Category 4: RTP, RTCP & Media Control

#### Q13: What is the purpose of SSRC in the RTP header?
* **Answer**: SSRC (Synchronization Source) is a 32-bit identifier in the RTP header that uniquely distinguishes distinct media streams (e.g., audio track, video track, and individual simulcast layers) within the same transport session.

#### Q14: What is the role of RTCP NACK feedback?
* **Answer**: Under RFC 4585, when an RTP receiver detects a gap in sequence numbers, it sends a NACK packet upstream specifying the missing sequence numbers. The SFU inspects its local retransmission buffer and resends only the missing RTP packet, avoiding full-stream buffering.

#### Q15: What is the difference between PLI and FIR?
* **Answer**:
  * **PLI (Picture Loss Indication - RFC 4585)**: Informs the sender that reference frames were lost and past decoding is corrupted, requesting the next keyframe.
  * **FIR (Full Intra Request - RFC 5104)**: Explicitly demands that the sender immediately generate an independent keyframe (IDR frame), typically sent when a new viewer joins a live room or when switching simulcast layers.
* **Code Reference**: `consumer.requestKeyFrame()` in [`apps/server/src/media/lifecycle.ts`](file:///d:/CN%20Project/apps/server/src/media/lifecycle.ts).

#### Q16: How does Transport-Wide Congestion Control (TWCC) operate?
* **Answer**: Broadcasters add a 16-bit transport-wide sequence number to each outgoing packet. The receiver records the exact arrival timestamp of every packet and periodically returns a TWCC feedback packet. The sender's Bandwidth Estimation (BWE) algorithm analyzes one-way delay variations to detect congestion before packet loss occurs.

---

### Category 5: SFU Architecture & Media Routing

#### Q17: What are the differences between P2P Mesh, MCU, and SFU?
* **Answer**:
  * **P2P Mesh**: Every peer sends media to every other peer ($O(N^2)$ bandwidth on clients; unviable for streaming to $>3$ viewers).
  * **MCU (Multipoint Control Unit)**: Server decodes, composites/mixes all video into a single stream, and re-encodes it. Extremely high CPU overhead.
  * **SFU (Selective Forwarding Unit)**: Broadcaster uploads once; the server selectively routes incoming RTP packets to viewers without decoding or re-encoding ($O(N)$ egress, low CPU load).
* **Code Reference**: [`apps/server/src/media/worker-pool.ts`](file:///d:/CN%20Project/apps/server/src/media/worker-pool.ts).

#### Q18: How does WebRTC Simulcast work in this application?
* **Answer**: The broadcaster's browser simultaneously encodes and transmits 3 spatial resolutions:
  * Low (`r0`): 360p @ 500 kbps
  * Medium (`r1`): 720p @ 1.5 Mbps
  * High (`r2`): 1080p @ 3.5 Mbps
  The SFU ingests all three streams but forwards only the layer requested by the viewer's consumer based on their bandwidth or manual selection.
* **Code Reference**: [`apps/web/src/features/studio/usePublisher.ts`](file:///d:/CN%20Project/apps/web/src/features/studio/usePublisher.ts) & [`apps/server/src/media/handlers.ts`](file:///d:/CN%20Project/apps/server/src/media/handlers.ts).

#### Q19: How are Mediasoup worker processes scaled across multi-core CPUs?
* **Answer**: Node.js is single-threaded, but Mediasoup workers run as native C++ child processes. NetStream Live spawns a pool of Mediasoup workers equal to the number of CPU cores and distributes channels across workers using round-robin allocation.
* **Code Reference**: `MediasoupWorkerPool` in [`apps/server/src/media/worker-pool.ts`](file:///d:/CN%20Project/apps/server/src/media/worker-pool.ts).

---

### Category 6: Application Layer & Distributed Systems

#### Q20: Why is PostgreSQL kept off the chat hot path?
* **Answer**: Live stream chat can experience thousands of messages per second during peak events. Querying and writing directly to relational disk storage on every message creates severe database connection pool exhaustion and lock contention. In NetStream Live, messages are broadcast instantly via Redis Pub/Sub, queued in memory, and asynchronously flushed to Postgres in batches.
* **Code Reference**: `ChatPersistenceWorker` in [`apps/server/src/chat/persistence.ts`](file:///d:/CN%20Project/apps/server/src/chat/persistence.ts).

#### Q21: How are chat message IDs structured and why?
* **Answer**: Chat messages use **ULIDs (Universally Unique Lexicographically Sortable Identifiers)**. ULIDs encode a 48-bit millisecond timestamp followed by 80 bits of cryptographic randomness. This allows chat histories to be sorted chronologically by ID without requiring auto-incrementing database sequence locks.
* **Code Reference**: [`apps/server/src/chat/service.ts`](file:///d:/CN%20Project/apps/server/src/chat/service.ts).

#### Q22: How does the server track concurrent viewer presence without polling?
* **Answer**: Viewers join a channel via `media.join` or `chat.join`. Presence is registered in Redis HyperLogLog / Sets with a heartbeat TTL. A background worker samples and broadcasts `viewers.count` pushes periodically.
* **Code Reference**: [`apps/server/src/presence/worker.ts`](file:///d:/CN%20Project/apps/server/src/presence/worker.ts).

#### Q23: How does the stream lifecycle handle transient network disconnections?
* **Answer**: If a broadcaster's WebSocket drops, the server does not immediately kill the stream. Instead, it enters `RECONNECTING` state and starts a 30-second grace timer. If the broadcaster reconnects within 30 seconds, the stream resumes without interrupting viewer consumers; if the timer expires, the stream transitions to `ENDING` and `OFFLINE`.
* **Code Reference**: `handleDisconnect()` in [`apps/server/src/media/lifecycle.ts`](file:///d:/CN%20Project/apps/server/src/media/lifecycle.ts).

---

### Category 7: HTTP Live Streaming (HLS) & Fallback

#### Q24: What is the fundamental latency difference between WebRTC and HLS?
* **Answer**: WebRTC delivers frame-by-frame over UDP with sub-second latency (150–300ms). HLS is chunk-based over HTTP/TCP; the stream is cut into discrete media files (`.ts` or fragmented `.mp4`) indexed by an `.m3u8` playlist. Because players must buffer at least 2–3 segments before playback, latency is typically 6–12 seconds.
* **Code Reference**: [`apps/server/src/recording/hls-pipeline.ts`](file:///d:/CN%20Project/apps/server/src/recording/hls-pipeline.ts).

#### Q25: How does the HLS pipeline ingest WebRTC media from Mediasoup without decoding?
* **Answer**: Mediasoup creates internal `PlainTransport` endpoints listening on local loopback UDP ports. Mediasoup consumes the broadcaster's video and audio producers and forwards raw RTP packets to these UDP ports. An FFmpeg process is spawned reading an SDP description file of these ports and outputs HLS segments (`index.m3u8`).
* **Code Reference**: [`apps/server/src/recording/hls-pipeline.ts`](file:///d:/CN%20Project/apps/server/src/recording/hls-pipeline.ts).

#### Q26: What is a GOP (Group of Pictures) and why does HLS segmenting require keyframe alignment?
* **Answer**: A GOP consists of an I-frame (Intra / Keyframe) followed by predictive P-frames and B-frames. Because P and B frames depend on reference frames, an HLS segment cannot begin with a P or B frame. FFmpeg is configured with a GOP size matching the 2-second segment length so that every segment starts cleanly with an IDR keyframe.

---

### Category 8: Network Measurement & Impairment

#### Q27: How does Linux Kernel `tc netem` simulate network impairment?
* **Answer**: `tc` (Traffic Control) configures queuing disciplines (`qdisc`) in the Linux kernel network stack. The `netem` (Network Emulator) module intercepts outgoing packets on a designated network interface (`eth0`) and applies statistical loss, delays, jitter according to a normal distribution, or rate limiting via Token Bucket Filter (`tbf`).
* **Code Reference**: [`lab/experiments/netem.sh`](file:///d:/CN%20Project/lab/experiments/netem.sh).

#### Q28: How is Jitter calculated in the custom UDP lab?
* **Answer**: According to RFC 3550, transit time difference $D(i, j) = (R_j - S_j) - (R_i - S_i)$ is computed between consecutive packets. Inter-arrival jitter $J$ is calculated using an exponential moving average:
  $$J = J + \frac{|D| - J}{16}$$
* **Code Reference**: `SequenceTracker.record()` in [`lab/udp/packet.py`](file:///d:/CN%20Project/lab/udp/packet.py).

#### Q29: What is the difference between RTT and One-Way Delay (OWD)?
* **Answer**: RTT (Round Trip Time) measures the elapsed time for a packet to reach the receiver and an acknowledgment to return to the sender, easily measured on a single system clock. One-Way Delay measures directional latency ($t_{\text{recv}} - t_{\text{send}}$), which requires sub-millisecond clock synchronization (such as PTP or GPS-disciplined NTP) to prevent clock drift skew.

#### Q30: How does the WebRTC Stats API expose packet loss and jitter in real-time?
* **Answer**: The browser provides `RTCPeerConnection.getStats()`. NetStream Live polls stats every second, reading `inbound-rtp` dictionaries for `packetsLost`, `jitter`, `roundTripTime`, `bytesReceived`, and `framesDecoded`, computing moving bitrates and rendering them in the UI overlay.
* **Code Reference**: [`apps/web/src/features/stream/useViewerStats.ts`](file:///d:/CN%20Project/apps/web/src/features/stream/useViewerStats.ts).

#### Q31: What happens when severe packet loss (e.g. 10%) is applied to WebRTC vs TCP?
* **Answer**: In TCP, 10% packet loss causes throughput collapse due to repeated exponential backoff, window reduction, and retransmission timeouts (TCP Reno/Cubic). In WebRTC, the video frame rate or resolution drops gracefully via TWCC bandwidth estimation, and NACK/PLI recovers keyframes without halting playback.

#### Q32: What security measures prevent path traversal in the HLS and VOD file routes?
* **Answer**: Fastify route parameters are validated using regex ensuring only clean channel UUIDs and alphanumeric segment filenames (`segment-X.ts` or `index.m3u8`) are served. Paths are resolved using `path.resolve()` and verified to reside strictly within `HLS_DIR` and `VOD_DIR`.
* **Code Reference**: [`apps/server/src/recording/routes.ts`](file:///d:/CN%20Project/apps/server/src/recording/routes.ts).
