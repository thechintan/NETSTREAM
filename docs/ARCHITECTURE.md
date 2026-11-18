# NetStream Live Architecture

This document describes the architectural layout, component responsibilities, network ports, and state machines powering NetStream Live.

---

## 1. System Overview Diagram

```mermaid
flowchart TD
    ClientStreamer["Broadcaster Browser (Studio)"]
    ClientViewer["Viewer Browser (Watch Page)"]
    
    subgraph Edge ["Edge Ingress / Reverse Proxy (Optional)"]
        Caddy["Caddy / Reverse Proxy (Ports 80, 443)"]
    end

    subgraph ServerNode ["NetStream Modular Monolith (Node.js 20+)"]
        FastifyREST["Fastify REST API (/api/*)"]
        FastifyStatic["Static Servicing (/hls/*, /vod/*)"]
        WSGateway["WebSocket Gateway (/ws)"]
        RoomManager["Room & Media Lifecycle Manager"]
        ChatWorker["Chat Persistence Worker"]
        PresenceWorker["Presence & Viewer Count Worker"]
        HLSPipeline["HLS & VOD Pipeline Manager"]
    end

    subgraph SFU ["Selective Forwarding Unit (SFU)"]
        MSPool["Mediasoup Worker Pool (C++)"]
        MSRouter["Mediasoup Router (1 per channel)"]
    end

    subgraph Storage ["Durable & Ephemeral Storage"]
        Redis[("Redis 7: Pub/Sub, Presence, Tickets, Rate Limits")]
        Postgres[("PostgreSQL 16: Users, Channels, Chat History, VODs")]
    end

    subgraph External ["Media Infrastructure"]
        Coturn["Coturn (STUN/TURN: 3478, 5349)"]
        FFmpeg["FFmpeg Process Manager (HLS Segmenter)"]
    end

    ClientStreamer -- "HTTPS / API" --> FastifyREST
    ClientStreamer -- "WSS Control & Chat" --> WSGateway
    ClientStreamer -- "WebRTC DTLS/SRTP (Send)" --> MSPool

    ClientViewer -- "HTTPS / API" --> FastifyREST
    ClientViewer -- "WSS Control & Chat" --> WSGateway
    ClientViewer -- "WebRTC DTLS/SRTP (Recv)" --> MSPool
    ClientViewer -- "HLS Fallback (m3u8/ts)" --> FastifyStatic

    WSGateway <--> RoomManager
    WSGateway <--> Redis
    RoomManager <--> MSPool
    MSPool --> MSRouter

    ChatWorker <--> Redis
    ChatWorker --> Postgres

    PresenceWorker <--> Redis
    PresenceWorker --> WSGateway

    HLSPipeline <--> MSRouter
    HLSPipeline --> FFmpeg
    FFmpeg --> FastifyStatic

    ClientStreamer -. "ICE STUN/TURN" .-> Coturn
    ClientViewer -. "ICE STUN/TURN" .-> Coturn
```

---

## 2. Ports and Protocols Table

| Port Range | Protocol | Direction | Purpose | Component |
|---|---|---|---|---|
| `80 / 443` | TCP (HTTP/HTTPS) | Inbound | Web application & REST APIs | Caddy / Fastify |
| `3000` | TCP (HTTP/WS) | Inbound | Server dev port (API + `/ws`) | Fastify |
| `5173` | TCP (HTTP) | Inbound | Vite development dev server | React / Vite |
| `40000–40100` | UDP / TCP | Inbound | WebRTC media traffic (RTP/RTCP/DTLS) | Mediasoup SFU |
| `3478` | UDP / TCP | Inbound | STUN binding / TURN media relay | Coturn |
| `5349` | TCP (TLS) | Inbound | Secure TURN over TLS | Coturn |
| `49152–49252` | UDP | Inbound/Out | Coturn TURN relay port range | Coturn |
| `5432 / 5433` | TCP | Internal | Relational database connection | PostgreSQL 16 |
| `6379` | TCP | Internal | Cache, session tickets, pub/sub queues | Redis 7 |

---

## 3. Go-Live Signaling Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Broadcaster as Broadcaster (Studio)
    participant WS as WebSocket Gateway
    participant RM as RoomManager
    participant MS as Mediasoup SFU
    participant Redis as Redis Pub/Sub
    participant HLS as HLS Pipeline

    Broadcaster->>WS: media.join { channelId, role: "publisher" }
    WS->>RM: getOrCreateRoom(channelId)
    RM->>MS: createRouter()
    WS-->>Broadcaster: ack { routerRtpCapabilities }

    Broadcaster->>WS: media.createTransport { direction: "send" }
    WS->>RM: createWebRtcTransport(send)
    RM->>MS: router.createWebRtcTransport()
    WS-->>Broadcaster: ack { id, iceParameters, iceCandidates, dtlsParameters }

    Broadcaster->>WS: media.connectTransport { transportId, dtlsParameters }
    WS->>MS: transport.connect({ dtlsParameters })
    WS-->>Broadcaster: ack { connected: true }

    Broadcaster->>WS: media.produce { transportId, kind: "video", rtpParameters }
    WS->>MS: transport.produce({ kind, rtpParameters })
    MS-->>RM: videoProducer created (Simulcast r0, r1, r2)
    WS-->>Broadcaster: ack { id: videoProducerId }

    Broadcaster->>WS: media.produce { transportId, kind: "audio", rtpParameters }
    WS->>MS: transport.produce({ kind, rtpParameters })
    MS-->>RM: audioProducer created
    WS-->>Broadcaster: ack { id: audioProducerId }

    RM->>HLS: startHlsPipeline(channelId)
    RM->>Redis: publish("stream:live", { channelId })
    Redis-->>WS: broadcast stream.live to viewers & followers
```

---

## 4. Viewer Watch Signaling Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Viewer as Viewer Browser
    participant WS as WebSocket Gateway
    participant RM as RoomManager
    participant MS as Mediasoup SFU

    Viewer->>WS: media.join { channelId, role: "viewer" }
    WS->>RM: getRoom(channelId)
    WS-->>Viewer: ack { routerRtpCapabilities }

    Viewer->>WS: media.createTransport { direction: "recv" }
    WS->>RM: createWebRtcTransport(recv)
    RM->>MS: router.createWebRtcTransport()
    WS-->>Viewer: ack { id, iceParameters, iceCandidates, dtlsParameters }

    Viewer->>WS: media.connectTransport { transportId, dtlsParameters }
    WS->>MS: transport.connect({ dtlsParameters })
    WS-->>Viewer: ack { connected: true }

    Viewer->>WS: media.consume { transportId, rtpCapabilities }
    WS->>MS: transport.consume(audioProducer), transport.consume(videoProducer)
    WS-->>Viewer: ack [ { id, producerId, kind, rtpParameters } ]

    Viewer->>WS: media.resume { consumerIds }
    WS->>MS: consumer.resume()
    WS-->>Viewer: ack { resumed: [...] }

    Note over Viewer,MS: RTP Media begins flowing over WebRTC

    Viewer->>WS: media.setLayers { consumerId, spatialLayer: 2 }
    WS->>MS: consumer.setPreferredLayers({ spatialLayer: 2 })
```

---

## 5. Live Chat Flow & Persistence Architecture

```mermaid
sequenceDiagram
    autonumber
    actor Chatter as Chat Participant
    participant WS as WebSocket Gateway
    participant Mod as Moderation / Limits
    participant Redis as Redis Pub/Sub & Queue
    participant DBWorker as ChatPersistenceWorker
    participant PG as PostgreSQL 16
    actor Audience as Channel Viewers

    Chatter->>WS: chat.send { channelId, text: "GG!" }
    WS->>Mod: Check ban, timeout, and slow-mode limits
    Mod-->>WS: Approved

    WS->>Redis: RPUSH chat:queue:<channelId> (ULID, user, text, ts)
    WS->>Redis: PUBLISH chat:channel:<channelId> (chat.message)
    
    Redis-->>WS: Fanout message to local socket connections
    WS-->>Audience: Push chat.message

    loop Every 1 second or 100 messages
        DBWorker->>Redis: LPOP / LRANGE chat:queue
        DBWorker->>PG: Batch INSERT INTO chat_messages
    end
```

---

## 6. Stream Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> OFFLINE
    OFFLINE --> STARTING: media.join (publisher) & transport created
    STARTING --> LIVE: audio/video tracks producing
    LIVE --> RECONNECTING: WebSocket disconnect (30s grace timer)
    RECONNECTING --> LIVE: Broadcaster reconnects & resumes
    RECONNECTING --> ENDING: Grace period expired (30s timeout)
    LIVE --> ENDING: media.end explicitly called
    ENDING --> OFFLINE: Transports closed, HLS finalised, VOD saved
    OFFLINE --> [*]
```

---

## 7. HLS & VOD Pipeline Architecture

```mermaid
flowchart LR
    subgraph Mediasoup
        VP["Video Producer"]
        AP["Audio Producer"]
        PT1["PlainTransport (Video)"]
        PT2["PlainTransport (Audio)"]
    end

    subgraph Filesystem
        SDP["channel.sdp"]
        HLSOut["HLS_DIR/channelId/index.m3u8"]
        VODOut["VOD_DIR/streamId/index.m3u8"]
    end

    VP --> PT1
    AP --> PT2
    PT1 -- "RTP UDP" --> FFmpeg["FFmpeg Process Manager"]
    PT2 -- "RTP UDP" --> FFmpeg
    SDP -. "Input spec" .-> FFmpeg

    FFmpeg --> HLSOut
    FFmpeg --> VODOut
    HLSOut --> FastifyStatic["Static Route (/hls/*)"]
    VODOut --> FastifyStaticVOD["Static Route (/vod/*)"]
```
