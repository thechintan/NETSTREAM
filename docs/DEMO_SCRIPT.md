# NetStream Live 7-Minute Presentation & Demo Script

This script provides an exact, minute-by-minute demonstration walkthrough for project presentation, lab evaluation, and viva examinations.

---

## Pre-Demo Checklist (5 Minutes Before)
- [ ] Docker infrastructure running: `docker compose -f infra/docker-compose.yml up -d`
- [ ] Dev servers running: `pnpm dev`
- [ ] Browser tabs open:
  - Tab 1: Broadcaster Studio (`http://localhost:5173/studio`)
  - Tab 2: Viewer Watch page (`http://localhost:5173/c/streamer`)
  - Tab 3: Channel Settings / Past Broadcasts (`http://localhost:5173/dashboard/settings`)
- [ ] Terminal open for quick commands in project root `d:/CN Project`

---

## 7-Minute Demo Timeline

### 0:00 – 1:00: Introduction & Architectural Overview
* **Action**: Show landing page and the Mermaid system diagram in [`docs/ARCHITECTURE.md`](file:///d:/CN%20Project/docs/ARCHITECTURE.md).
* **Talking Points**:
  * "NetStream Live is an open-source, Twitch-style live streaming platform built to demonstrate advanced Computer Networking concepts."
  * "We built a Selective Forwarding Unit (SFU) using Mediasoup. Video is NEVER sent over WebSockets or HTTP; WebRTC carries real-time media over UDP with DTLS-SRTP encryption, achieving sub-second latency (150–250ms)."
  * "WebSockets are used strictly for control signaling, chat, and live presence."

### 1:00 – 2:30: Broadcaster Go-Live & WebRTC Negotiation
* **Action**: On Tab 1 (Studio), click **"Start Streaming"** (or use fake video device).
* **Talking Points**:
  * "Notice the signaling flow in DevTools: the browser exchanges SDP capabilities, establishes ICE candidates, and negotiates DTLS parameters."
  * "The broadcaster publishes 3 simulcast spatial layers simultaneously: 1080p high bitrate, 720p medium bitrate, and 360p low bitrate."
  * Open the **Stats Overlay** in the top-right corner of the video player:
    * Highlight **Encoding Bitrate**, **FPS (30)**, **Packet Loss (0%)**, and **Round Trip Time (RTT)**.

### 2:30 – 3:45: Viewer Watch Experience, Chat & Real-Time Presence
* **Action**: Switch to Tab 2 (Viewer Watch Page). Play the video side-by-side with Tab 1.
* **Talking Points**:
  * "Observe glass-to-glass latency: when I raise my hand or clap on camera, the viewer sees it within 200 milliseconds."
  * "Type in live chat: *'Testing sub-second chat fan-out!'*. The message appears instantly across all viewers via Redis pub/sub, without querying PostgreSQL on the hot path."
  * "Moderate chat: click the message moderation menu, delete the message, or timeout a user. Notice `mod.delete` broadcasts a `chat.deleted` push to everyone in the channel."
  * "Notice the live viewer counter increment in real-time."

### 3:45 – 5:00: Networking in Action: Simulcast & Network Impairment
* **Action**: In the Viewer Stats Overlay, demonstrate manual quality layer switching:
  * Select **"360p (Low)"**: Show resolution instantly drop to 640x360 and bitrate drop to ~500 kbps without interrupting playback.
  * Select **"Auto"**: SFU dynamically selects layers based on bandwidth feedback.
* **Action**: Demonstrate STUN/TURN toggle:
  * Enable **"Force TURN Relay"** in Studio settings.
  * Show the candidate pair type change from `host` (direct UDP) to `relay` (via Coturn port 3478).
* **Talking Points**:
  * "Mediasoup is an SFU, so switching layers does not require transcoding on the server; the server selectively routes RTP packets at the next keyframe boundary using PLI/FIR requests."

### 5:00 – 6:00: HLS Fallback Pipeline & VOD Archival
* **Action**: Open HLS player tab or explain HLS fallback URL (`http://localhost:3000/hls/<channelId>/index.m3u8`).
* **Talking Points**:
  * "For viewers with restrictive networks where UDP is blocked, our background PlainTransport pipeline sends RTP to an FFmpeg process, segmenting the stream into 2-second HLS chunks."
* **Action**: In Studio, click **"Stop Broadcast"**.
* **Action**: Navigate to Tab 3 (Past Broadcasts / VODs):
  * Show the recorded stream metadata, duration, and playback using `hls.js`.

### 6:00 – 7:00: Python Socket Lab & Examiner Q&A
* **Action**: Switch to terminal. Run the Python UDP test matrix:
  ```bash
  python lab/udp/run_matrix.py
  ```
* **Talking Points**:
  * "In addition to the WebRTC platform, our Python lab implements raw TCP stream-framing with SHA-256 verification, and a custom binary UDP datagram protocol measuring jitter, out-of-order delivery, and packet drops."
* **Wrap-up**: "We are now ready for your questions!"

---

## Emergency Fallback Plans

| Scenario | Immediate Fallback |
|---|---|
| **No Webcam / Audio Device** | Launch Chromium with fake media device flags: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` (or use the automated Playwright bot `tsx lab/experiments/viewers.ts --auto-publish`). |
| **TURN Container Unreachable** | Leave "Force TURN Relay" off. Mediasoup will operate via direct host candidates on `127.0.0.1` / `PUBLIC_IP`. |
| **FFmpeg Binary Missing** | HLS output gracefully disables with a non-fatal warning; WebRTC streaming and chat will function normally. |
| **Port Conflict on 3000 or 5173** | Stop stray node processes (`Get-Process -Name node | Stop-Process`) and re-run `pnpm dev`. |
