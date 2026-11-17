# NetStream Live: A Twitch-Style Streaming Platform

Computer Networks Project Blueprint v2 | Full architecture and implementation guide (WebSocket, WebRTC, HLS) | Extends the original NetStream blueprint

## 1. What Changes From Blueprint v1

Blueprint v1 was a download-a-file project: a TCP server sends a video in chunks and a separate UDP experiment measures loss. It explicitly excluded WebRTC, login, databases and frontends. This version turns the project into a live streaming platform with streamers, viewers, live chat and moderation, and it deliberately brings those excluded items back in. The v1 networking work is not thrown away: it becomes the **Network Lab** module (section 13), which keeps this a Computer Networks project rather than a web-app project.

| Area | v1 | v2 |
| --- | --- | --- |
| Video delivery | Download a whole file over TCP | Live streams over WebRTC (UDP, SRTP) with optional HLS fallback |
| Interaction | Command line LIST / GET | WebSocket chat, presence, notifications, moderation |
| Server model | Thread per client | Event-driven async server plus SFU media workers |
| Users | None | Accounts, channels, follows, roles |
| Measurement | TCP throughput, UDP loss | Plus live WebRTC stats (RTT, jitter, loss, bitrate) and tc netem experiments |
| Persistence | None | PostgreSQL and Redis |

**Scope warning.** A real Twitch is built by hundreds of engineers. Four weeks is not enough for this plan. Budget **8 weeks**, ship in tiers (section 2), and treat Tier 0 as the real project. Add a higher tier only when the tier below it works end to end. Because v1 listed WebRTC as out of scope, re-confirm scope with your instructor (checklist in section 21).

## 2. Feature Set

### Tier 0: MVP (must ship)

| Feature | How it works on the network | Done when |
| --- | --- | --- |
| Accounts and login | HTTPS REST, short-lived JWT plus refresh cookie | Register, login, logout work; passwords hashed with argon2 or bcrypt |
| Channel and stream key | REST; random 32-byte key stored hashed | Streamer creates a channel and can rotate the key |
| Go live from browser | getUserMedia / getDisplayMedia, then WebRTC publish to the SFU (UDP, SRTP) | Click Go Live and the channel flips to LIVE |
| Watch live | SFU forwards RTP packets to each viewer over WebRTC | Viewer sees and hears the stream in about 1 second or less |
| Live chat | WebSocket (TCP), server fan-out per channel | Messages reach all viewers in under 200 ms on a LAN |
| Live directory and viewer count | REST list plus WebSocket push; Redis presence | Home page lists live channels with viewer counts |
| Stats overlay | RTCPeerConnection.getStats() | Shows bitrate, RTT, jitter, packet loss in real time |

### Tier 1: Core platform features

| Feature | Mechanism |
| --- | --- |
| Follow and go-live notifications | DB row plus WebSocket push to online followers |
| Categories, search, tags | Postgres queries, trigram or full-text index |
| Moderation | Roles (owner, mod, viewer), ban, timeout, delete message, slow mode, per-user rate limit |
| Emotes and mentions | Client-side token parsing; server validates emote IDs |
| Simulcast adaptive quality | Streamer sends 3 resolutions; SFU picks the layer per viewer from bandwidth estimates |
| Reconnect and resilience | Exponential backoff, ICE restart, 15-second grace period for a dropped streamer |
| VOD recording | SFU pipes RTP to FFmpeg, which writes MP4 or HLS to disk |
| HLS fallback | FFmpeg packages the live stream; viewers on bad networks use hls.js over HTTP |

### Tier 2: Stretch

Clips (cut a time range from the VOD), raids, polls and predictions over WebSocket, OBS ingest (WHIP or RTMP), guest co-streaming (two publishers), TURN over TLS on port 443, mock channel points, chat replay synced to VODs, multi-worker SFU cascade.

### Out of scope

Real payments, DRM, global CDN, recommendation ML, native mobile apps, large-scale transcoding ladders.

## 3. Key Design Decisions

### 3.1 How to deliver live video

| Approach | Typical latency | Scales by | Complexity | CN concepts exercised |
| --- | --- | --- | --- | --- |
| RTMP ingest plus HLS (classic Twitch-style pipeline) | 6 to 30 s | CDN caching of HTTP segments | Medium (transcoder plus packager) | TCP, HTTP, playlists and segments |
| LL-HLS / LL-DASH | 2 to 5 s | CDN | High | HTTP/2, chunked transfer |
| WebRTC mesh | under 0.5 s | Does not scale (streamer uploads N copies) | Low | ICE, RTP for a handful of peers |
| WebRTC through an SFU | about 0.2 to 0.8 s | Server egress bandwidth | Medium-high | ICE, STUN/TURN, DTLS-SRTP, RTP/RTCP, congestion control |

**Decision:** WebRTC through an SFU is the primary path: it is the most networking-rich option and gives the live feel. HLS is the Tier 1 fallback because plain HTTP segments are how large platforms really scale. Be honest in the viva: WebRTC is chosen here for latency and learning value, not because it is how Twitch scaled.

### 3.2 Topology: mesh vs MCU vs SFU

- **Mesh:** every viewer connects to the streamer, so the streamer uploads N copies. Dies at about 3 to 5 viewers.
- **MCU:** server decodes and mixes all streams. Very CPU-heavy, unnecessary for one-to-many.
- **SFU (Selective Forwarding Unit):** the streamer uploads once; the server forwards the RTP packets to each viewer without decoding or re-encoding. This is the one we build.

Bandwidth math to put in your report: a 2.5 Mbps stream with 100 viewers needs about 250 Mbps of server egress. With a mesh the streamer would need that uplink. With an SFU the streamer needs about 2.5 Mbps (about 4 Mbps with three simulcast layers). Your demo is limited by Wi-Fi and the server NIC, so plan viewer counts accordingly.

### 3.3 Technology stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript, mediasoup-client, hls.js | Standard, fast to build |
| API and signaling | Node.js 20+ with TypeScript, Fastify (REST), ws (WebSocket) | Same language as the mediasoup API |
| SFU | mediasoup (C++ workers, Node API) | Real SFU with simulcast, RTCP feedback and bandwidth estimation built in |
| Database | PostgreSQL | Users, channels, follows, bans, VODs |
| Cache and pub/sub | Redis | Chat fan-out across processes, presence, rate-limit counters, WS tickets |
| NAT traversal | coturn | STUN and TURN for restrictive networks |
| Recording and HLS | FFmpeg | Packages RTP into HLS or MP4 |
| Reverse proxy | Caddy or Nginx | TLS is mandatory for camera access (except on localhost) |
| Packaging | Docker Compose | One-command demo |
| Test and measure | Wireshark, chrome://webrtc-internals, tc netem, k6 or a custom ws load script | Evidence for the report |

**If the team insists on staying in Python:** FastAPI plus the websockets library plus aiortc works for a small demo. Be aware aiortc is not a true SFU: relaying with MediaRelay decodes and re-encodes frames for each viewer, so it is CPU-heavy and fine only for a handful of viewers, and it will not demonstrate simulcast or packet-level forwarding. We recommend Node and mediasoup. **Shortcut warning:** MediaMTX (a single binary that speaks RTMP, WHIP, WHEP and HLS) is a good reference to compare against, but using it as the project hides the signaling and SFU work you are supposed to learn.

### 3.4 Why WebSocket

A browser cannot open raw TCP or UDP sockets. WebSocket gives one long-lived, full-duplex connection over TCP, started as an HTTP request and then upgraded. It carries signaling (SDP and ICE or mediasoup messages), chat, presence and notifications. Plain HTTP request/response cannot push data; polling wastes bandwidth and adds latency; Server-Sent Events are one-directional only.

## 4. System Architecture

Start as a **modular monolith**: API, realtime gateway and media service are separate modules in one Node project, run as one or two processes. Split into services only where scaling differs (media workers scale with CPU and bandwidth; chat scales with connection count).

```
 STREAMER BROWSER                                  VIEWER BROWSER(S)
 getUserMedia -> mediasoup-client                  mediasoup-client -> video element
   | HTTPS REST (login, channel)                     | HTTPS REST (browse, follow)
   | WSS signaling + chat    (TCP 443)               | WSS signaling + chat    (TCP 443)
   | WebRTC media (UDP 40000-40100, SRTP)            | WebRTC media (UDP 40000-40100, SRTP)
   v                                                 ^
+------------------------------------------------------------------+
|  Reverse proxy (Caddy / Nginx, TLS) :443                         |
+--------------+-----------------------------+---------------------+
               |                             |
      +--------v--------+           +--------v---------+
      |  API module     |           | Realtime gateway |
      |  REST /api/*    |           | WebSocket /ws    |
      |  auth, channels |           | chat, presence,  |
      |  follows, VODs  |           | signaling relay  |
      +----+------+-----+           +----+-------+-----+
           |      |                      |       |
     +-----v--+ +-v------+  pub/sub  +---v----+  |
     |Postgres| | Redis  |<--------->| Redis  |  |
     +--------+ +--------+           +--------+  |
                                                +v-------------------+
                                                | Media module       |
                                                | mediasoup workers  |
                                                | 1 Router / stream  |
                                                +----+---------------+
                                                     | PlainTransport (RTP over loopback)
                                                +----v-----+   +-----------+
                                                |  FFmpeg  |-->| HLS / VOD |
                                                +----------+   +-----------+

 coturn (STUN/TURN): 3478 udp+tcp, 5349 tls, relay ports 49152-49252 udp
```

### Component responsibilities

| Component | Responsibility |
| --- | --- |
| API module | Auth, users, channels, follows, categories, VOD metadata, moderation records. Stateless, REST over HTTPS. |
| Realtime gateway | Owns WebSocket connections. Chat fan-out, presence, notifications, and relays signaling messages to the media module. |
| Media module | Creates mediasoup workers and one Router per live stream, manages transports, producers and consumers, enforces one publisher per channel. |
| Redis | WS auth tickets, presence sets, rate-limit counters, pub/sub between processes. |
| PostgreSQL | Durable data only. Never in the chat hot path. |
| FFmpeg workers | Turn RTP into HLS segments and VOD files. |
| coturn | STUN for address discovery; TURN relay when direct UDP is blocked. |

### Ports and protocols

| Port | Transport | Used for |
| --- | --- | --- |
| 443 | TCP | HTTPS and WSS |
| 80 | TCP | Redirect to HTTPS |
| 40000-40100 | UDP (TCP fallback) | WebRTC media (mediasoup rtcMinPort / rtcMaxPort) |
| 3478 | UDP and TCP | STUN and TURN |
| 5349 | TCP | TURN over TLS |
| 49152-49252 | UDP | TURN relay allocations |
| 5432, 6379 | TCP, internal only | PostgreSQL, Redis |
| 8080 | TCP, internal only | HLS origin served behind the proxy |

## 5. End-to-End Flows

### 5.1 Go live

1. Streamer logs in (REST), opens the Studio page, and the browser calls getUserMedia for camera and microphone (or getDisplayMedia for screen).
2. Browser requests a WS ticket, opens the WebSocket, and sends `media.join { channelId, role: 'publisher' }`.
3. Server checks the user owns the channel and no other publisher is active, creates (or reuses) a mediasoup Router for the channel, and returns the Router RTP capabilities.
4. Browser loads a mediasoup Device with those capabilities and requests a send transport.
5. DTLS handshake happens through `connect`, then the browser calls `produce` for audio and for video (with 3 simulcast encodings).
6. Server stores the producers, marks the channel LIVE in Postgres, writes a `streams` row, publishes `stream.live` on Redis, and notifies online followers.
7. If recording is on, the media module attaches a PlainTransport consumer and starts FFmpeg.

### 5.2 Watch live

1. Viewer opens the channel page, REST returns channel info and live status.
2. Browser opens the WebSocket and sends `chat.join` and `media.join { role: 'viewer' }`.
3. Server returns Router capabilities; viewer creates a receive transport and connects it.
4. Viewer sends `media.consume { rtpCapabilities }`; server calls `canConsume`, creates paused consumers for the audio and video producers and returns their parameters.
5. Browser creates local consumers, attaches the tracks to a video element, then sends `media.resume`; the server resumes the consumers and requests a keyframe so video starts immediately.
6. Gateway increments the channel viewer count in Redis and broadcasts the new count.

### 5.3 Chat message

1. Client sends `chat.send` over the WebSocket.
2. Server authenticates the connection, checks mute/ban state, rate limit and slow mode, sanitizes and length-checks the text.
3. Server publishes to Redis channel `chat:{channelId}`; every gateway process delivers `chat.message` to its local sockets in that room.
4. Optionally persist asynchronously (batch insert) so the database never slows delivery.

### 5.4 End of stream

Streamer clicks End (or the transport closes and the 15-second grace timer expires). Server closes producers and the Router, stops FFmpeg, finalizes the VOD file, sets the channel OFFLINE, updates `streams.ended_at` and peak viewers, broadcasts `stream.offline`, and viewer pages switch to the offline view.

## 6. The WebSocket Layer

### 6.1 What actually happens on the wire

A WebSocket starts as an ordinary HTTP/1.1 request over TCP:

```
GET /ws?ticket=abc123 HTTP/1.1
Host: netstream.example
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: <base64(SHA-1(key + fixed GUID))>
```

After the 101 response the same TCP connection carries WebSocket frames: a header with a FIN bit, an opcode (1 text, 2 binary, 8 close, 9 ping, 10 pong), a mask bit and a 7-bit, 16-bit or 64-bit payload length. Frames from browser to server are always masked with a 4-byte key. Good viva material: it shows TCP framing, HTTP upgrade and why a protocol on top of a byte stream needs its own message boundaries (the same lesson as your v1 header-plus-bytes protocol).

### 6.2 Message envelope

Every message is JSON with a short type, an optional request id (so the client can await a reply) and a payload:

```ts
// client -> server
{ t: 'chat.send',     id: 'r41', d: { channelId, text } }
{ t: 'media.join',    id: 'r42', d: { channelId, role: 'viewer' } }
// server -> client
{ t: 'ack',           id: 'r41', d: { ok: true } }
{ t: 'chat.message',  d: { mid, channelId, user: { id, name, color, badges }, text, ts } }
{ t: 'error',         id: 'r41', d: { code: 'RATE_LIMITED', retryAfterMs: 2000 } }
```

| Direction | Types |
| --- | --- |
| Client to server | chat.join, chat.leave, chat.send, media.join, media.createTransport, media.connectTransport, media.produce, media.consume, media.resume, media.setLayers, mod.ban, mod.timeout, mod.delete, mod.slow |
| Server to client | ack, error, chat.message, chat.deleted, chat.cleared, user.banned, viewers.count, stream.live, stream.offline, notify.follow, notify.live |

Binary data (video) never goes over WebSocket; it goes over WebRTC. WebSocket carries only small control and chat messages.

### 6.3 Authenticating a WebSocket

Browsers cannot set an Authorization header on a WebSocket, and putting a long-lived JWT in the URL leaks it into logs. Use a **one-time ticket**: the client calls `POST /api/ws-ticket` (authenticated by cookie or bearer token); the server stores a random ticket in Redis with a 30-second TTL; the client connects to `/ws?ticket=...`; the server redeems it with an atomic get-and-delete and attaches the user to the connection. Anonymous viewers get a guest ticket with a read-only role.

### 6.4 Server skeleton

```ts
import { WebSocketServer, WebSocket } from 'ws';
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url!, 'http://x');
  const ticket = url.searchParams.get('ticket');
  const user = ticket ? await redeemTicket(ticket) : null; // Redis GETDEL
  if (!user) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, user));
});

type Conn = { ws: WebSocket; user: User; alive: boolean; rooms: Set<string>; media: MediaState };
const conns = new Set<Conn>();

wss.on('connection', (ws: WebSocket, user: User) => {
  const c: Conn = { ws, user, alive: true, rooms: new Set(), media: newMediaState() };
  conns.add(c);
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return ws.close(4400, 'bad json'); }
    dispatch(c, msg); // switch on msg.t, validate payload with a schema (zod)
  });
  ws.on('close', () => { cleanup(c); conns.delete(c); }); // leave rooms, close transports, fix viewer count
});

setInterval(() => {            // heartbeat: detect dead peers
  for (const c of conns) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false; c.ws.ping();
  }
}, 25_000);
```

Why the heartbeat: a TCP connection whose peer vanished (laptop lid closed, Wi-Fi dropped) can look open for minutes. A ping/pong every 25 seconds finds it, and also keeps NAT and proxy idle timers from closing the connection.

### 6.5 Client reconnect with backoff

```ts
async function connect(attempt = 0) {
  const { ticket } = await api.post('/api/ws-ticket');
  const ws = new WebSocket(`wss://${location.host}/ws?ticket=${ticket}`);
  ws.onopen = () => { attempt = 0; resubscribe(); };   // rejoin rooms, re-request media
  ws.onclose = () => {
    const base = Math.min(30_000, 500 * 2 ** attempt);
    setTimeout(() => connect(attempt + 1), base * (0.5 + Math.random() / 2)); // jitter
  };
}
```

Exponential backoff with jitter prevents a thundering herd: if the server restarts, thousands of clients must not all reconnect in the same millisecond. On reconnect the client sends the last chat message id it saw so the server can replay the few messages it missed from a short Redis list.

## 7. WebRTC and the SFU

### 7.1 Protocol stack

| Layer | Protocol | Role |
| --- | --- | --- |
| Signaling | Our WebSocket protocol | WebRTC does not define signaling. We exchange capabilities, ICE and DTLS parameters ourselves. |
| NAT traversal | ICE with STUN and TURN | Finds a working network path between browser and SFU. |
| Key exchange | DTLS over UDP | Handshake that produces the keys for SRTP. |
| Media encryption | SRTP | Encrypted RTP. All WebRTC media is encrypted; there is no plaintext mode. |
| Media transport | RTP over UDP | Audio and video packets with sequence numbers, timestamps and an SSRC per stream. |
| Feedback | RTCP | Loss and jitter reports, NACK, keyframe requests (PLI), bandwidth estimation (TWCC or REMB). |
| Codecs | Opus (audio); VP8 and H.264 (video) | VP9 or AV1 are optional stretch goals. |

### 7.2 ICE, STUN and TURN in this project

The SFU normally has a public IP, so ICE is simpler than peer-to-peer, but the browser is still behind a NAT. mediasoup acts as an **ICE-lite** endpoint: it does not gather candidates or run checks itself, it only advertises its listen addresses, and the browser runs the connectivity checks. Candidate types the browser tries, in rough preference order:

1. **host:** a local interface address (works on the same LAN).
2. **srflx (server reflexive):** the public address learned from a STUN server.
3. **relay:** an address allocated on a TURN server; media is relayed through coturn. Slowest, but works through strict firewalls (use TURN over TLS on port 443 as a Tier 2 stretch).

**The number one failure** is a wrong `announcedAddress`. If mediasoup advertises 0.0.0.0 or a Docker-internal IP, the browser sits in the checking state forever. For a LAN demo, set it to the server's LAN IP; for a cloud demo, its public IP. Also open the UDP port range (40000-40100) in the firewall.

### 7.3 mediasoup object model

| Object | Meaning in our system |
| --- | --- |
| Worker | One OS process pinned to roughly one CPU core. Create `cores - 1` workers. |
| Router | One per live channel. Holds the codec capabilities and routes RTP between endpoints. |
| WebRtcTransport | One ICE+DTLS connection. The streamer has one send transport; each viewer has one receive transport. |
| Producer | An incoming track (audio or video) from the streamer. |
| Consumer | An outgoing copy of one producer sent to one viewer. A viewer has two (audio and video). |

### 7.4 Signaling sequence

```
BROADCASTER                          SERVER (gateway + media)
  media.join {channelId,publisher} ->  check ownership, get/create Router
                                   <-  { routerRtpCapabilities }
  device.load(capabilities)
  media.createTransport {send}     ->  router.createWebRtcTransport()
                                   <-  { id, iceParameters, iceCandidates, dtlsParameters }
  transport.on('connect')
  media.connectTransport {dtls}    ->  transport.connect({ dtlsParameters })   (DTLS handshake)
  transport.on('produce')
  media.produce {kind,rtpParams}   ->  transport.produce()  -> Producer
                                   <-  { producerId }                          (RTP starts flowing)

VIEWER
  media.join {viewer}              ->  get Router (reject if channel offline)
  media.createTransport {recv}     ->  new transport; connect as above
  media.consume {rtpCapabilities}  ->  canConsume(); transport.consume({paused:true})
                                   <-  [ {id, producerId, kind, rtpParameters} ]
  recvTransport.consume(info) -> track -> video element
  media.resume {consumerIds}       ->  consumer.resume(); requestKeyFrame()    (video appears)
```

The consumers are created paused so the viewer's browser can attach the tracks before packets arrive; otherwise the first keyframe is lost and the picture stays black until the next one.

### 7.5 Media module (server)

```ts
import os from 'node:os';
import * as mediasoup from 'mediasoup';

const workers: mediasoup.types.Worker[] = [];
let nextWorker = 0;

export async function initWorkers() {
  const n = Math.max(1, os.cpus().length - 1);
  for (let i = 0; i < n; i++) {
    const w = await mediasoup.createWorker({ rtcMinPort: 40000, rtcMaxPort: 40100, logLevel: 'warn' });
    w.on('died', () => { console.error('mediasoup worker died'); process.exit(1); }); // supervisor restarts us
    workers.push(w);
  }
}
const pickWorker = () => workers[nextWorker++ % workers.length];

const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
  { kind: 'video', mimeType: 'video/H264', clockRate: 90000,
    parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
]; // cast to RouterRtpCodecCapability[] in TypeScript

type Room = { router: mediasoup.types.Router; publisherId?: string; producers: Map<string, mediasoup.types.Producer> };
const rooms = new Map<string, Room>();

export async function getRoom(channelId: string): Promise<Room> {
  let room = rooms.get(channelId);
  if (!room) {
    room = { router: await pickWorker().createRouter({ mediaCodecs }), producers: new Map() };
    rooms.set(channelId, room);
  }
  return room;
}

export async function createTransport(room: Room) {
  const t = await room.router.createWebRtcTransport({
    listenInfos: [
      { protocol: 'udp', ip: '0.0.0.0', announcedAddress: process.env.PUBLIC_IP },
      { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: process.env.PUBLIC_IP },
    ],
    enableUdp: true, enableTcp: true, preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  });
  return { transport: t, params: { id: t.id, iceParameters: t.iceParameters,
           iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters } };
}
```

Note: older mediasoup versions used `listenIps: [{ ip, announcedIp }]` instead of `listenInfos`. Check the API of the version you install.

```ts
// Streamer publishes a track
async function onProduce(c: Conn, d: { transportId: string; kind: 'audio' | 'video'; rtpParameters: any; appData?: any }) {
  const room = rooms.get(c.media.channelId)!;
  if (room.publisherId !== c.user.id) throw err('FORBIDDEN');          // one publisher, must be the owner
  const transport = c.media.transports.get(d.transportId)!;
  const producer = await transport.produce({ kind: d.kind, rtpParameters: d.rtpParameters, appData: d.appData });
  room.producers.set(producer.id, producer);
  producer.on('transportclose', () => room.producers.delete(producer.id));
  notifyViewersOfNewProducer(room, producer);                          // viewers already waiting can consume
  return { producerId: producer.id };
}

// Viewer asks for the stream
async function onConsume(c: Conn, d: { transportId: string; rtpCapabilities: any }) {
  const room = rooms.get(c.media.channelId)!;
  const transport = c.media.transports.get(d.transportId)!;
  const out = [];
  for (const p of room.producers.values()) {
    if (!room.router.canConsume({ producerId: p.id, rtpCapabilities: d.rtpCapabilities })) continue;
    const consumer = await transport.consume({ producerId: p.id, rtpCapabilities: d.rtpCapabilities, paused: true });
    c.media.consumers.set(consumer.id, consumer);
    consumer.on('producerclose', () => send(c, 'media.consumerClosed', { consumerId: consumer.id }));
    consumer.on('layerschange', (layers) => send(c, 'media.layers', { consumerId: consumer.id, layers }));
    out.push({ id: consumer.id, producerId: p.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters });
  }
  return out;
}

async function onResume(c: Conn, d: { consumerIds: string[] }) {
  for (const id of d.consumerIds) {
    const consumer = c.media.consumers.get(id)!;
    await consumer.resume();
    if (consumer.kind === 'video') await consumer.requestKeyFrame();   // PLI: start the picture now
  }
}
```

### 7.6 Browser side

```ts
import { Device } from 'mediasoup-client';

// ---------- Streamer ----------
const device = new Device();
const { routerRtpCapabilities } = await ws.request('media.join', { channelId, role: 'publisher' });
await device.load({ routerRtpCapabilities });

const sendTransport = device.createSendTransport(await ws.request('media.createTransport', { direction: 'send' }));
sendTransport.on('connect', ({ dtlsParameters }, ok, fail) =>
  ws.request('media.connectTransport', { transportId: sendTransport.id, dtlsParameters }).then(ok, fail));
sendTransport.on('produce', ({ kind, rtpParameters, appData }, ok, fail) =>
  ws.request('media.produce', { transportId: sendTransport.id, kind, rtpParameters, appData })
    .then(({ producerId }) => ok({ id: producerId }), fail));
sendTransport.on('connectionstatechange', (s) => { if (s === 'failed') restartIce(sendTransport); });

const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true },
  video: { width: 1280, height: 720, frameRate: 30 },
});
await sendTransport.produce({ track: stream.getAudioTracks()[0] });
await sendTransport.produce({
  track: stream.getVideoTracks()[0],
  encodings: [   // simulcast: three encodings of the same camera
    { rid: 'r0', scaleResolutionDownBy: 4, maxBitrate: 150_000,   scalabilityMode: 'L1T3' },
    { rid: 'r1', scaleResolutionDownBy: 2, maxBitrate: 600_000,   scalabilityMode: 'L1T3' },
    { rid: 'r2', scaleResolutionDownBy: 1, maxBitrate: 2_500_000, scalabilityMode: 'L1T3' },
  ],
  codecOptions: { videoGoogleStartBitrate: 1000 },
});

// ---------- Viewer ----------
const recvTransport = device.createRecvTransport(await ws.request('media.createTransport', { direction: 'recv' }));
recvTransport.on('connect', ({ dtlsParameters }, ok, fail) =>
  ws.request('media.connectTransport', { transportId: recvTransport.id, dtlsParameters }).then(ok, fail));

const infos = await ws.request('media.consume', { transportId: recvTransport.id, rtpCapabilities: device.rtpCapabilities });
const media = new MediaStream();
for (const info of infos) media.addTrack((await recvTransport.consume(info)).track);
videoEl.muted = true;               // browsers block autoplay with sound; unmute on a user click
videoEl.srcObject = media;
await ws.request('media.resume', { consumerIds: infos.map((i) => i.id) });
```

Camera access needs a secure context: HTTPS, or http://localhost during development. For a LAN demo with a second device, use a self-signed or mkcert certificate.

### 7.7 Simulcast and adaptive quality

With simulcast the streamer's browser encodes the same video three times at different resolutions and bitrates, as three separate RTP streams. The SFU does not transcode; it simply chooses which of the three to forward to each viewer, and can switch at a keyframe.

| Layer | Resolution | Bitrate | Chosen when |
| --- | --- | --- | --- |
| r0 (spatial 0) | 320x180 | about 150 kbps | Viewer's available bandwidth is very low |
| r1 (spatial 1) | 640x360 | about 600 kbps | Mid-range connection |
| r2 (spatial 2) | 1280x720 | about 2.5 Mbps | Good connection |

Temporal layers (the T3 in the scalability mode) let the SFU drop frame rate without changing resolution, which is a cheaper way to shed load. The SFU estimates each viewer's available downlink with transport-wide congestion control (the browser reports packet arrival times in RTCP) and adjusts layers automatically. A manual quality menu (Auto, 720p, 360p, 180p) calls `consumer.setPreferredLayers({ spatialLayer, temporalLayer })` through `media.setLayers`. The server emits `layerschange` and `score` events that you can show in the stats overlay.

### 7.8 RTCP feedback and congestion control

| Mechanism | What it does |
| --- | --- |
| Sequence numbers and timestamps | Let the receiver detect loss and reorder, and play frames at the right time. |
| NACK | Receiver asks the sender to retransmit specific lost RTP packets (the SFU keeps a short packet history). |
| PLI / FIR | Receiver asks for a fresh keyframe after heavy loss or when a viewer joins. |
| TWCC / REMB | Bandwidth estimation: receiver reports arrival times; sender adapts bitrate or layer. |
| Receiver reports | Fraction lost, cumulative lost, jitter, and enough timing data to compute RTT. |
| Jitter buffer | Receiver holds packets briefly to smooth arrival variation. It adds latency, which is the cost of smoothness. |

Why UDP for live video: retransmitting a packet that is already too late to display is useless, and TCP retransmission blocks all later data behind the missing segment (head-of-line blocking). WebRTC chooses to drop a frame and keep moving. You will demonstrate this in the Network Lab (section 13).

### 7.9 Failure handling

| Event | Response |
| --- | --- |
| Transport state becomes failed or disconnected | Server `transport.restartIce()` returns new ICE parameters; client calls `transport.restartIce({ iceParameters })`. |
| Streamer loses connection | Start a 15-second grace timer. Viewers show Streamer reconnecting. If the streamer returns, reattach; otherwise end the stream (section 5.4). |
| Viewer closes tab or WebSocket drops | `cleanup(c)` closes transports and consumers, decrements viewer count. |
| mediasoup worker dies | Process exits, supervisor restarts it, active streams end, streamer UI offers one-click re-publish. |
| Browser blocks autoplay | Start muted and show an unmute button. |

## 8. Chat System

### 8.1 Rooms and fan-out

Each gateway process keeps an in-memory map of channel to connected sockets and uses **Redis pub/sub** so multiple gateway processes can serve one channel. Serialize the message once and send the same string to every socket instead of re-serializing per viewer.

```ts
const rooms = new Map<string, Set<Conn>>();

async function joinRoom(c: Conn, channelId: string) {
  let set = rooms.get(channelId);
  if (!set) {
    set = new Set();
    rooms.set(channelId, set);
    await sub.subscribe(`chat:${channelId}`, (msg) => {       // first local member opens the subscription
      for (const m of rooms.get(channelId) ?? []) {
        if (m.ws.readyState === WebSocket.OPEN && m.ws.bufferedAmount < 1_000_000) m.ws.send(msg);
      }
    });
  }
  set.add(c);
  c.rooms.add(channelId);
}

async function leaveRoom(c: Conn, channelId: string) {
  const set = rooms.get(channelId);
  set?.delete(c);
  c.rooms.delete(channelId);
  if (set && set.size === 0) { rooms.delete(channelId); await sub.unsubscribe(`chat:${channelId}`); }
}
```

The `bufferedAmount` check is backpressure: a viewer on a slow connection must not make the server hold unbounded data. Skip (or disconnect) consumers that fall behind.

### 8.2 Send pipeline

```ts
async function onChatSend(c: Conn, { channelId, text }: { channelId: string; text: string }) {
  if (!c.rooms.has(channelId) || c.user.guest) throw err('FORBIDDEN');
  text = sanitize(text.trim());                              // strip control characters, collapse whitespace
  if (!text || text.length > 500) throw err('BAD_MESSAGE');
  if (await isBanned(channelId, c.user.id)) throw err('BANNED');
  if (await isTimedOut(channelId, c.user.id)) throw err('TIMED_OUT');
  await rateLimit(c.user.id, channelId);
  await enforceSlowMode(channelId, c.user);

  const msg = JSON.stringify({ t: 'chat.message', d: {
    mid: ulid(), channelId, user: publicUser(c.user), text, ts: Date.now(),
  }});
  await pub.publish(`chat:${channelId}`, msg);
  await redis.lPush(`chat:recent:${channelId}`, msg);     // short history for reconnect replay
  await redis.lTrim(`chat:recent:${channelId}`, 0, 99);
  persistQueue.push(msg);                                    // batched INSERT later, never blocks delivery
}

async function rateLimit(userId: string, channelId: string) {
  const k = `rl:${channelId}:${userId}`;                     // fixed window: 20 messages per 30 s
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, 30);
  if (n > 20) throw err('RATE_LIMITED');
}

async function enforceSlowMode(channelId: string, user: User) {
  const slow = Number(await redis.hGet(`chan:${channelId}:settings`, 'slowSeconds') ?? 0);
  if (!slow || user.isModFor(channelId)) return;
  const ok = await redis.set(`slow:${channelId}:${user.id}`, '1', { NX: true, EX: slow });
  if (!ok) throw err('SLOW_MODE');
}
```

The client renders chat text as plain text (React escapes by default). Never insert chat text with innerHTML, or chat becomes an XSS vector.

### 8.3 Moderation

| Action | Viewer | Moderator | Owner |
| --- | --- | --- | --- |
| Send message | Yes | Yes | Yes |
| Delete a message | No | Yes | Yes |
| Timeout (temporary mute) | No | Yes | Yes |
| Ban (permanent) | No | Yes | Yes |
| Slow mode, followers-only mode | No | Yes | Yes |
| Add or remove moderators | No | No | Yes |

A ban is a row in the `bans` table plus a Redis set for the hot path. The server publishes `user.banned` so every gateway removes the user from the room, and `chat.deleted { mid }` so every client hides a deleted message. Moderation events are written to an audit table (who did what to whom and when).

### 8.4 Delivery guarantees

- Delivery is **at most once**: a message sent while a viewer is disconnected is not queued for them. The short Redis history list covers the reconnect gap by replaying messages after the last id the client reports.
- **Ordering** is per channel, because one Redis channel preserves publish order. Message ids are ULIDs so clients can sort and de-duplicate.
- The client keeps only the last 150 messages in the DOM and auto-scrolls unless the user scrolled up.
- When a channel is busy (for example over 50 messages per second), the gateway can batch messages and flush every 100 ms as an array. This cuts the number of WebSocket frames and TCP segments considerably.

## 9. Presence, Viewer Counts and Notifications

### 9.1 Viewer count

Counting open WebSockets is not enough: a dead connection can linger, and one user may have two tabs. Use a Redis sorted set per channel with the last-seen time as the score.

```ts
// on media.join (viewer) and on every heartbeat
await redis.zAdd(`viewers:${channelId}`, { score: Date.now(), value: c.id });
// on close
await redis.zRem(`viewers:${channelId}`, c.id);
// every 5 s per live channel (coalesced broadcast, not one message per join)
await redis.zRemRangeByScore(`viewers:${channelId}`, 0, Date.now() - 60_000);   // drop stale entries
const count = await redis.zCard(`viewers:${channelId}`);
await pub.publish(`chat:${channelId}`, JSON.stringify({ t: 'viewers.count', d: { channelId, count } }));
```

Broadcasting every 5 seconds instead of on every join prevents a message storm when a raid or a popular streamer brings in thousands of viewers at once. Record the maximum into `streams.peak_viewers`.

### 9.2 Live directory

`GET /api/live` returns live channels from Postgres joined with counts from Redis. Home-page clients also join a global room so that `stream.live` and `stream.offline` events update the grid without refreshing.

### 9.3 Notifications

When a stream starts, look up followers in batches. Online followers receive `notify.live` instantly through a per-user Redis channel (`user:{id}`). Offline followers get a row in `notifications` and see it at next login. Email or browser push notifications are optional stretch goals. A thumbnail for the directory can be refreshed every 60 seconds by grabbing one frame from the HLS output with FFmpeg.

## 10. HLS Fallback and VOD Recording

HLS is how large platforms scale: video becomes short files (segments) described by a playlist, served over ordinary HTTP, and cached by CDNs. It is slower (several seconds of latency) but works through any network that allows HTTPS and needs no per-viewer server state. We reuse the same pipeline for the fallback and for recording.

```
Producer (RTP inside SFU)
   -> PlainTransport consumer   (plain RTP over UDP on 127.0.0.1, no encryption needed on loopback)
   -> FFmpeg reads an SDP file  (transcodes to H.264 + AAC)
   -> /data/hls/{channelId}/index.m3u8 + segment files
   -> Caddy serves /hls/*       (HTTP, cacheable)
   -> hls.js in the viewer's browser
```

```ts
async function startHls(room: Room, channelId: string) {
  const video = [...room.producers.values()].find((p) => p.kind === 'video')!;
  const t = await room.router.createPlainTransport({
    listenInfo: { protocol: 'udp', ip: '127.0.0.1' }, rtcpMux: false, comedia: false,
  });
  const port = allocateLocalPort();                         // port FFmpeg will listen on
  await t.connect({ ip: '127.0.0.1', port, rtcpPort: port + 1 });
  const consumer = await t.consume({ producerId: video.id, rtpCapabilities: room.router.rtpCapabilities, paused: true });
  writeSdp(`/tmp/${channelId}.sdp`, port, consumer.rtpParameters);   // payload type + codec come from rtpParameters
  spawnFfmpeg(channelId);
  await consumer.resume();
  await consumer.requestKeyFrame();                          // FFmpeg needs a keyframe to start
}
```

```
ffmpeg -protocol_whitelist file,udp,rtp -i /tmp/CHANNEL.sdp \
  -c:v libx264 -preset veryfast -tune zerolatency -g 60 -c:a aac \
  -f hls -hls_time 2 -hls_list_size 6 -hls_flags delete_segments \
  /data/hls/CHANNEL/index.m3u8
```

The audio track is added the same way with a second PlainTransport and a second `m=audio` section in the SDP. Add a second FFmpeg output, or run the same command with `-hls_list_size 0` and without `delete_segments`, to keep every segment: that playlist becomes the VOD. Stop FFmpeg cleanly at stream end so it writes the end-of-list marker, then insert a row in `vods`.

**Why transcode?** The browser may send VP8, and many HLS players expect H.264. If the streamer's browser negotiates H.264 you can copy the video stream without re-encoding (`-c:v copy`), which saves a lot of CPU. State this trade-off in the report.

```ts
// Viewer fallback
if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(`/hls/${channelId}/index.m3u8`);
  hls.attachMedia(videoEl);
} else {
  videoEl.src = `/hls/${channelId}/index.m3u8`;   // Safari plays HLS natively
}
```

Fallback policy: try WebRTC first; if ICE has not connected within 8 seconds, or the user turns on Low-latency off / Low-bandwidth mode, switch to HLS. Expected latency is roughly 3 segments of 2 seconds plus encoding, so about 6 to 10 seconds, against under 1 second for WebRTC. You will measure this in experiment E6.

## 11. Data Model and REST API

```
users          id uuid PK, email UNIQUE, username UNIQUE, password_hash, created_at
channels       id PK, owner_id FK UNIQUE, name UNIQUE, title, category_id FK,
               stream_key_hash, is_live bool, slow_seconds int, created_at
categories     id PK, name UNIQUE, thumbnail_url
follows        user_id FK, channel_id FK, created_at          PK(user_id, channel_id)
channel_mods   channel_id FK, user_id FK                       PK(channel_id, user_id)
streams        id PK, channel_id FK, title, started_at, ended_at, peak_viewers
chat_messages  id (ULID) PK, channel_id, stream_id, user_id, text, created_at   -- batched inserts
bans           channel_id, user_id, banned_by, reason, expires_at NULL, created_at
vods           id PK, stream_id FK, channel_id FK, path, duration_s, created_at
clips          id PK, vod_id FK, creator_id FK, start_s, end_s, created_at      -- Tier 2
notifications  id PK, user_id FK, type, payload jsonb, read_at, created_at
refresh_tokens id PK, user_id FK, token_hash, expires_at, revoked_at

Indexes: follows(channel_id), channels(is_live, category_id),
         chat_messages(channel_id, id), bans(channel_id, user_id)
```

The stream key is generated with a cryptographically secure random generator, shown to the owner once, and only its hash is stored. The browser publisher does not need the key (the logged-in session proves ownership); the key is for OBS and WHIP in Tier 2.

| Method and path | Purpose |
| --- | --- |
| POST /api/auth/register, /login, /refresh, /logout | Account and session handling |
| GET /api/me | Current user |
| POST /api/ws-ticket | One-time WebSocket ticket (section 6.3) |
| GET /api/ice-config | iceServers list with short-lived TURN credentials |
| GET /api/live?category=&q= | Live channels with viewer counts |
| GET /api/channels/:name | Channel info, live status, follower count |
| PATCH /api/channels/me | Update title and category |
| POST /api/channels/me/stream-key/rotate | Issue a new stream key |
| POST and DELETE /api/channels/:id/follow | Follow or unfollow |
| GET /api/me/following | Followed channels and which are live |
| POST /api/channels/:id/mods | Add or remove moderators (owner only) |
| GET /api/channels/:id/chat/history?before= | Older chat messages (pagination) |
| GET /api/channels/:id/vods, GET /api/categories | VOD list, categories |
| GET /api/health | Liveness check for Docker and the load test |

## 12. Security

| Threat | Control |
| --- | --- |
| Stolen or guessed passwords | argon2id or bcrypt; login rate limiting; generic error messages |
| Token theft | Short-lived access JWT (15 minutes); refresh token in an httpOnly, Secure, SameSite cookie; hashed refresh tokens in the DB with rotation |
| Cross-site WebSocket hijacking | Check the Origin header during the upgrade; one-time tickets (section 6.3) |
| Someone else publishes to your channel | Server-side ownership check on `media.join` and `media.produce`; one publisher per Router; never trust a role sent by the client |
| Chat spam and floods | Message length limit, per-user rate limit, slow mode, per-IP connection cap |
| Oversized WebSocket messages | `maxPayload` of about 16 KB on the WebSocketServer |
| XSS through chat or titles | Render as text only, Content-Security-Policy header, escape on output |
| Resource exhaustion in the SFU | Cap transports per connection, viewers per room, and message rate on signaling |
| Eavesdropping | TLS for HTTP and WebSocket; DTLS-SRTP for media (mandatory in WebRTC) |
| Leaked stream key | Stored hashed, shown once, rotate button |
| Path traversal on VOD and HLS files | Serve files by database id from one directory (the same rule as in v1), never by a user-provided path |
| TURN abuse | Short-lived HMAC credentials instead of a static password |

```ts
// Time-limited TURN credentials (coturn: use-auth-secret + static-auth-secret)
function turnCredentials(userId: string) {
  const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;      // expiry timestamp : user
  const credential = crypto.createHmac('sha1', process.env.TURN_SECRET!).update(username).digest('base64');
  return { urls: ['turn:turn.example.com:3478', 'turns:turn.example.com:5349'], username, credential };
}
```

## 13. Network Lab: The Computer Networks Core

This module is what turns the platform into a Computer Networks project. It keeps everything from blueprint v1 and adds measurements of the WebRTC and WebSocket parts.

### 13.1 What is kept from v1

`tcp_server.py`, `tcp_client.py` (LIST / GET protocol, chunked transfer, SHA-256 check) and the UDP sender and receiver stay as standalone Python tools with their original metrics. They provide the baseline for **TCP bulk transfer** and **UDP loss and RTT** on your test network, and they are the clearest place to show raw sockets, message framing and thread-per-client concurrency in the viva.

### 13.2 Experiments

| ID | Question | Method | Metrics |
| --- | --- | --- | --- |
| E1 | How do TCP and UDP behave on this network? | v1 tools | Throughput, observed loss, RTT |
| E2 | How does video quality degrade with packet loss? | netem loss of 0, 1, 3, 5, 10 percent while watching a stream | packetsLost, NACK and PLI counts, freezeCount, fps, bitrate |
| E3 | Effect of delay and jitter | netem delay of 50, 100, 200 ms with jitter | RTT, jitter, jitterBufferDelay, chat round-trip time |
| E4 | Does the SFU adapt to limited bandwidth? | Rate limit the viewer link to 5 Mbps, 1 Mbps, 300 kbps | Active simulcast layer, bitrate, time to adapt |
| E5 | Why not carry live video over TCP? | Compare UDP candidates with TCP-only ICE (`enableUdp: false`) under 3 percent loss | Freezes, latency growth, throughput |
| E6 | WebRTC vs HLS latency | Burn a running clock into the streamer's video and compare with a clock at the viewer | Glass-to-glass delay in seconds |
| E7 | How well does chat fan-out scale? | Load script opening 100 to 2000 WebSocket clients, one sender | Delivery latency p50 and p95, server CPU, egress bandwidth |
| E8 | How many viewers can one SFU worker serve? | Headless Chromium viewers with a fake camera | CPU per worker, egress Mbps, loss at saturation |

Tools for Linux:

```
sudo tc qdisc add dev eth0 root netem delay 100ms 20ms loss 3%    # add delay, jitter, loss
sudo tc qdisc change dev eth0 root netem loss 5%                   # change settings
sudo tc qdisc del dev eth0 root                                    # reset

chromium --use-fake-ui-for-media-stream --use-fake-device-for-media-stream   # fake camera for headless viewers
```

On Windows or macOS use Clumsy or Network Link Conditioner instead of netem. Apply impairment on the link between the viewer and the server, not on the streamer, unless that is what you are testing, and write down which one it was. Repeat each run at least 3 times and report the median, as required in v1.

### 13.3 In-browser stats overlay

```ts
let prev: { bytes: number; ts: number } | undefined;
setInterval(async () => {
  const report = await videoConsumer.getStats();       // RTCStatsReport from the consumer
  report.forEach((s) => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') {
      const kbps = prev ? ((s.bytesReceived - prev.bytes) * 8) / (s.timestamp - prev.ts) : 0;  // bits per ms = kbit/s
      prev = { bytes: s.bytesReceived, ts: s.timestamp };
      overlay.update({ kbps, fps: s.framesPerSecond, width: s.frameWidth, height: s.frameHeight,
        packetsLost: s.packetsLost, jitterMs: s.jitter * 1000, freezes: s.freezeCount,
        nack: s.nackCount, pli: s.pliCount });
    }
    if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
      overlay.update({ rttMs: s.currentRoundTripTime * 1000 });
    }
  });
}, 1000);
```

The overlay also appends each sample to a CSV (timestamp, scenario label, metrics). The graph scripts from v1 (matplotlib) plot throughput, loss and RTT per scenario. The same page opened with chrome://webrtc-internals gives a second source to cross-check your numbers.

### 13.4 Wireshark exercises (great for the viva)

| Capture | Display filter | What to point out |
| --- | --- | --- |
| TCP handshake and HTTP upgrade (run locally over plain ws://) | `tcp.flags.syn==1` then `http` and `websocket` | SYN, SYN-ACK, ACK, then the 101 Switching Protocols response and the first WebSocket frames |
| STUN and ICE checks | `stun` | Binding requests and responses, the candidate pair that wins |
| DTLS handshake | `dtls` | Hello, key exchange, then keys for SRTP |
| RTP media | `rtp` (may need Decode As RTP on the UDP port range) | Version, payload type, sequence number, timestamp, SSRC; the payload is encrypted |
| RTCP feedback | `rtcp` | Receiver reports, NACK and PLI after you add loss with netem |
