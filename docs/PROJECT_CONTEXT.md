# NetStream Live: project context

## What we are building
A Twitch-style live streaming platform for a university Computer Networks project. Streamers go live from the browser; viewers watch with sub-second latency; live chat, moderation, follows, VODs. It must demonstrate networking concepts: TCP, UDP, WebSocket, WebRTC (ICE, STUN/TURN, DTLS-SRTP, RTP/RTCP), HTTP/HLS, and measurable network behaviour. A separate "Network Lab" (Python) keeps raw TCP and UDP socket experiments.

## Tech stack (do not substitute without recording a decision in PROGRESS.md)
- Monorepo with pnpm workspaces. TypeScript strict, ESM everywhere.
- apps/server: Node.js 20+, Fastify (REST), ws (WebSocket), mediasoup (SFU), PostgreSQL 16 via Drizzle ORM, Redis 7, pino logging, zod validation, vitest tests.
- apps/web: React + Vite + TypeScript, Tailwind CSS, react-router, mediasoup-client, hls.js.
- packages/shared: zod schemas and TypeScript types for the WebSocket protocol and shared DTOs. Both server and web import from here. This is the single source of truth for message shapes.
- lab/: Python 3.11, standard library only (plus pytest, matplotlib for analysis).
- infra/: docker-compose, Caddyfile, coturn config.
- Pin exact dependency versions. Use the installed library's own TypeScript types as the source of truth for API details (for example mediasoup's listenInfos vs listenIps).

## Repo layout
netstream-live/
  apps/server/src/{config,db,auth,api,realtime,media,chat,presence,moderation,recording,lib}/
  apps/web/src/{pages,components,features/{auth,chat,stream,studio,lab},lib,hooks}/
  packages/shared/src/{protocol.ts,types.ts,index.ts}
  lab/{tcp,udp,experiments,analysis}/
  infra/{docker-compose.yml,Caddyfile,coturn.conf}
  docs/

## Architecture summary
Modular monolith. One server process exposes: REST at /api/*, WebSocket at /ws, HLS files at /hls/* and /vod/* (static). Media module owns mediasoup workers; one Router per live channel; the streamer has one send transport (audio + video producers); each viewer has one receive transport and one consumer per track. mediasoup is ICE-lite; the server must advertise a reachable address (PUBLIC_IP env). Video never travels over WebSocket; WebSocket carries only control, signaling and chat. Redis is used for WS tickets, pub/sub fan-out, presence, rate limits. Postgres is for durable data only and is never on the chat hot path.

## WebSocket protocol
Every message is JSON: { t: string, id?: string, d?: object }.
- Client requests carry an id; server replies { t: 'ack', id, d } or { t: 'error', id, d: { code, message, retryAfterMs? } }.
- Server pushes have no id.
- Client to server types: chat.join, chat.leave, chat.send, media.join, media.createTransport, media.connectTransport, media.produce, media.consume, media.resume, media.setLayers, media.restartIce, mod.ban, mod.timeout, mod.delete, mod.slow, user.subscribe.
- Server to client types: ack, error, chat.message, chat.deleted, chat.cleared, user.banned, viewers.count, stream.live, stream.offline, media.newProducer, media.consumerClosed, media.layers, notify.live, notify.follow.
- Close codes: 4400 bad message, 4401 unauthorized, 4403 forbidden, 4429 too many messages.
- Auth: browser calls POST /api/ws-ticket, receives a one-time ticket (Redis, 30 s TTL, atomic get-and-delete), then connects to /ws?ticket=... Guests get a read-only guest ticket. The server checks the Origin header against WEB_ORIGIN.
- Heartbeat: server pings every 25 s; connections that miss a pong are terminated.

## Ports
443 or 3000 HTTPS/WSS (dev server 3000 API+WS, 5173 web), UDP+TCP 40000-40100 WebRTC media (RTC_MIN_PORT/RTC_MAX_PORT), 3478 TURN/STUN, 5349 TURN TLS, Postgres 5432 and Redis 6379 internal only.

## Environment variables (all validated with zod at startup; keep .env.example current)
PORT, WEB_ORIGIN, DATABASE_URL, REDIS_URL, JWT_SECRET, COOKIE_SECRET, PUBLIC_IP, RTC_MIN_PORT, RTC_MAX_PORT, TURN_HOST, TURN_SECRET, HLS_ENABLED, HLS_DIR, VOD_DIR, LOG_LEVEL, NODE_ENV.

## Coding conventions
- Strict TypeScript, no `any` unless justified in a comment. Validate every inbound REST body, query and WebSocket message with zod from packages/shared.
- Typed error codes (e.g. FORBIDDEN, RATE_LIMITED, NOT_FOUND). Never leak stack traces to clients.
- Never store tokens in localStorage. Access token lives in memory; refresh token is an httpOnly cookie.
- Render user-generated text as text only. Never use dangerouslySetInnerHTML or innerHTML with user content.
- Always release resources on disconnect (rooms, transports, consumers, timers).
- Keep modules small and testable. Business logic lives in services, not in route handlers.
- Every feature gets tests where practical. Do not weaken or delete a failing test to make it pass; fix the cause.
- Do not add dependencies that are not needed. When you add one, note why in PROGRESS.md.

## TASK PROTOCOL (every task prompt says "Follow the TASK PROTOCOL")
1. Read this file and docs/PROGRESS.md first. Inspect the existing code before changing anything.
2. State a short plan (at most 10 bullets) and then proceed without waiting.
3. Implement only the current task. Do not start the next task. Do not refactor unrelated modules.
4. If something is ambiguous, choose the simplest option and record it under "Decisions" in PROGRESS.md.
5. Run every command listed under ACCEPTANCE and show the real output. If something fails, fix it and re-run.
6. Update docs/PROGRESS.md: what was done, files created or changed, decisions, known issues, and exact commands to run and verify.
7. End with a concise summary and a list of the manual checks the human must perform.
