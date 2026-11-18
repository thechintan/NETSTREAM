# NetStream Live Protocol Specification

This document is the authoritative specification for all WebSocket messages and REST endpoints in NetStream Live, validated against [`packages/shared/src/protocol.ts`](file:///d:/CN%20Project/packages/shared/src/protocol.ts) and the server route registry.

---

## 1. WebSocket Protocol Architecture

### 1.1 Connection & Ticket Handshake
1. Browser requests a ticket: `POST /api/ws-ticket` (with JWT or as anonymous guest).
2. Server issues a single-use ticket stored in Redis with 30s TTL.
3. Client opens WebSocket connection:
   ```text
   GET /ws?ticket=<ticket_uuid> HTTP/1.1
   Host: localhost:3000
   Upgrade: websocket
   Connection: Upgrade
   Origin: http://localhost:5173
   ```
4. Server validates `Origin` against `WEB_ORIGIN`, redeems ticket atomically (`MULTI` / `GETDEL`), and maps authenticated user identity.
5. Server sends periodic ping frames every 25 seconds; clients failing to respond with pong within timeout are terminated.

### 1.2 Framing & Envelope
All WebSocket frames carry a UTF-8 JSON envelope:
```typescript
interface WsEnvelope<T = unknown> {
  t: string;      // Message type
  id?: string;    // Correlation ID (required for client requests)
  d?: T;          // Payload data
}
```

### 1.3 Close Codes
| Code | Identifier | Description |
|---|---|---|
| `4400` | `BAD_MESSAGE` | Malformed JSON or invalid schema |
| `4401` | `UNAUTHORIZED` | Invalid, expired, or missing ticket |
| `4403` | `FORBIDDEN` | Origin mismatch or blacklisted identity |
| `4429` | `TOO_MANY_MESSAGES` | Exceeded rate limit (60 msg/min per socket) |

### 1.4 Error Codes
Standard errors returned in `{ t: 'error', id, d: { code, message, retryAfterMs? } }`:
`BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `SLOW_MODE`, `BANNED`, `TIMED_OUT`, `INTERNAL_ERROR`, `TIMEOUT`, `UNKNOWN_TYPE`, `ALREADY_PUBLISHING`, `TOO_MANY_TRANSPORTS`, `TOO_MANY_CONSUMERS`, `PRODUCER_EXISTS`, `MEDIA_OFFLINE`, `STREAM_ALREADY_LIVE`.

---

## 2. Client-to-Server Messages (Upstream)

### `chat.join`
Subscribes the connection to a channel's live chat room and retrieves recent history.
* **Payload (`d`)**:
  ```json
  { "channelId": "d781a3e7-54dd-435c-b4e9-c9dc93420190", "lastMid": "01M7RA3MFDX971YH8CNCT6T495" }
  ```
* **Success Reply (`ack`)**:
  ```json
  { "t": "ack", "id": "req-1", "d": { "messages": [] } }
  ```

### `chat.leave`
Leaves a channel's chat room.
* **Payload (`d`)**: `{ "channelId": "<uuid>" }`

### `chat.send`
Broadcasts a new chat message (max 500 characters).
* **Payload (`d`)**:
  ```json
  { "channelId": "d781a3e7-54dd-435c-b4e9-c9dc93420190", "text": "Hello world!" }
  ```

### `media.join`
Joins a channel's media router as either `publisher` or `viewer`.
* **Payload (`d`)**: `{ "channelId": "<uuid>", "role": "publisher" | "viewer" }`
* **Success Reply (`ack`)**:
  ```json
  { "t": "ack", "id": "req-2", "d": { "routerRtpCapabilities": { ... } } }
  ```

### `media.createTransport`
Requests the SFU to create a WebRTC transport.
* **Payload (`d`)**: `{ "direction": "send" | "recv" }`
* **Success Reply (`ack`)**:
  ```json
  {
    "t": "ack",
    "id": "req-3",
    "d": {
      "id": "transport-uuid",
      "iceParameters": { "usernameFragment": "...", "password": "..." },
      "iceCandidates": [ ... ],
      "dtlsParameters": { "fingerprints": [ ... ], "role": "auto" }
    }
  }
  ```

### `media.connectTransport`
Completes DTLS handshake parameters with the server transport.
* **Payload (`d`)**: `{ "transportId": "...", "dtlsParameters": { ... } }`
* **Success Reply (`ack`)**: `{ "t": "ack", "id": "req-4", "d": { "connected": true } }`

### `media.produce`
Publishes an audio or video track to the send transport.
* **Payload (`d`)**:
  ```json
  {
    "transportId": "transport-uuid",
    "kind": "video",
    "rtpParameters": { ... },
    "appData": { "source": "webcam" }
  }
  ```
* **Success Reply (`ack`)**: `{ "t": "ack", "id": "req-5", "d": { "id": "producer-uuid" } }`

### `media.consume`
Creates consumers on a receive transport matching client RTP capabilities.
* **Payload (`d`)**: `{ "transportId": "...", "rtpCapabilities": { ... } }`
* **Success Reply (`ack`)**:
  ```json
  {
    "t": "ack",
    "id": "req-6",
    "d": [
      { "id": "consumer-uuid", "producerId": "producer-uuid", "kind": "video", "rtpParameters": { ... } }
    ]
  }
  ```

### `media.resume`
Resumes paused consumers after client-side track binding.
* **Payload (`d`)**: `{ "consumerIds": ["consumer-uuid-1", "consumer-uuid-2"] }`
* **Success Reply (`ack`)**: `{ "t": "ack", "id": "req-7", "d": { "resumed": ["consumer-uuid-1"] } }`

### `media.setLayers`
Switches preferred spatial/temporal simulcast layers.
* **Payload (`d`)**:
  ```json
  { "consumerId": "consumer-uuid", "spatialLayer": 2, "temporalLayer": 2 }
  ```

### `media.restartIce`
Triggers an ICE restart on an existing transport.
* **Payload (`d`)**: `{ "transportId": "transport-uuid" }`
* **Success Reply (`ack`)**: `{ "t": "ack", "id": "req-8", "d": { "iceParameters": { ... } } }`

### `media.end`
Broadcaster explicitly terminates the live stream.
* **Payload (`d`)**: `{ "channelId": "<uuid>" }`

### `mod.ban`, `mod.timeout`, `mod.delete`, `mod.slow`
Channel owner/moderator administration commands.
* **`mod.ban`**: `{ "channelId": "<uuid>", "userId": "<uuid>", "reason": "Spam" }`
* **`mod.timeout`**: `{ "channelId": "<uuid>", "userId": "<uuid>", "durationSeconds": 300 }`
* **`mod.delete`**: `{ "channelId": "<uuid>", "mid": "<message_ulid>" }`
* **`mod.slow`**: `{ "channelId": "<uuid>", "seconds": 10 }`

---

## 3. Server-to-Client Messages (Downstream Pushes)

* **`chat.message`**:
  ```json
  {
    "t": "chat.message",
    "d": {
      "mid": "01M7RA3MFDX971YH8CNCT6T495",
      "channelId": "uuid",
      "user": { "id": "uuid", "name": "alice", "color": "#FF5252", "badges": ["broadcaster"] },
      "text": "Welcome to the stream!",
      "ts": 1795038420000
    }
  }
  ```
* **`chat.deleted`**: `{ "t": "chat.deleted", "d": { "mid": "01M7RA3MFDX971YH8CNCT6T495" } }`
* **`chat.cleared`**: `{ "t": "chat.cleared", "d": { "channelId": "uuid" } }`
* **`user.banned`**: `{ "t": "user.banned", "d": { "channelId": "uuid", "userId": "uuid" } }`
* **`viewers.count`**: `{ "t": "viewers.count", "d": { "channelId": "uuid", "count": 42 } }`
* **`stream.live`**: `{ "t": "stream.live", "d": { "channelId": "uuid", "channelName": "alice", "title": "Speedrun" } }`
* **`stream.offline`**: `{ "t": "stream.offline", "d": { "channelId": "uuid" } }`
* **`media.newProducer`**: `{ "t": "media.newProducer", "d": { "producerId": "uuid", "kind": "video" } }`
* **`media.consumerClosed`**: `{ "t": "media.consumerClosed", "d": { "consumerId": "uuid" } }`
* **`media.layers`**: `{ "t": "media.layers", "d": { "consumerId": "uuid", "layers": { "spatialLayer": 1, "temporalLayer": 2 } } }`
* **`notify.live`**: `{ "t": "notify.live", "d": { "id": "uuid", "channelId": "uuid", "channelName": "alice", "title": "Live now!" } }`
* **`notify.follow`**: `{ "t": "notify.follow", "d": { "id": "uuid", "channelId": "uuid", "followerUsername": "bob" } }`

---

## 4. REST Endpoints

### Authentication & Tickets
* `POST /api/auth/register` — Register user `{ username, email, password }`
* `POST /api/auth/login` — Login user `{ email, password }` (sets `refreshToken` cookie, returns `{ token, user }`)
* `POST /api/auth/refresh` — Issue fresh access token using cookie
* `POST /api/auth/logout` — Revoke session cookie
* `GET /api/me` — Return current authenticated user profile
* `POST /api/ws-ticket` — Mint one-time WebSocket connection ticket

### Channels & Follows
* `GET /api/channels` — List channels (paginated)
* `GET /api/channels/live` — List active live streams
* `GET /api/channels/:id` — Get channel details and owner info
* `PATCH /api/channels/:id` — Update channel title, category, or VOD recording setting
* `POST /api/channels/:id/follow` — Follow channel
* `DELETE /api/channels/:id/follow` — Unfollow channel
* `GET /api/channels/:id/followers` — List channel followers

### Moderation
* `GET /api/channels/:id/mods` — List channel moderators
* `POST /api/channels/:id/mods` — Add moderator
* `DELETE /api/channels/:id/mods/:userId` — Remove moderator
* `GET /api/channels/:id/bans` — List active bans and timeouts

### Notifications
* `GET /api/notifications?unread=true` — Get user notifications
* `POST /api/notifications/read` — Mark notifications as read (`{ ids: [...] }` or all)

### WebRTC & ICE
* `GET /api/ice-config` — Get STUN/TURN URLs and short-lived HMAC credentials
* `GET /api/debug/media` — Debug metrics of active routers, transports, producers, and consumers

### Recording & VOD
* `GET /api/channels/:id/vods` — List past broadcasts for a channel
* `GET /api/vods/:id` — Get VOD metadata
* `DELETE /api/vods/:id` — Delete VOD recording (owner only)
* `GET /hls/:channelId/:file` — Static live HLS playlist (`index.m3u8`) and `.ts` segments
* `GET /vod/:streamId/:file` — Static VOD HLS playlist and `.ts` segments

### System Health
* `GET /api/health` — Service health probe (`{ ok, db, redis, version }`)
