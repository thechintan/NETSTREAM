# Progress

## Done
- Initialized pnpm workspace monorepo (`pnpm-workspace.yaml`, root `package.json`, `.gitignore`, `.env.example`, `.env`, `README.md`).
- Configured ESLint (flat config), Prettier, and Vitest at the repository root.
- Created `packages/shared` with `VERSION = '0.1.0'`, Zod dependency, and workspace configuration for direct TypeScript type resolution.
- Created `infra/docker-compose.yml` with PostgreSQL 16 (`postgres:16-alpine`) and Redis 7 (`redis:7-alpine`), complete with healthchecks and named volumes.
- Implemented `apps/server`:
  - Fastify server with Pino logging (`pino-pretty` in development).
  - Strict Zod environment config module reading all required variables from PROJECT_CONTEXT.md and failing fast on invalid/missing values.
  - PostgreSQL client (`postgres` / postgres.js) with ping check and connection termination.
  - Redis client (`ioredis`) with ping check, error event handling, and disconnect logic.
  - Graceful shutdown on `SIGINT` and `SIGTERM` closing Fastify, Redis, and PostgreSQL cleanly.
  - `GET /api/health` returning `{ ok: boolean, db: boolean, redis: boolean, version: string }` from real live pings.
  - Vitest unit tests verifying config schema validation and fail-fast behavior.
- Implemented `apps/web`:
  - React 18, Vite, TypeScript, Tailwind CSS, and React Router.
  - Vite dev server proxy forwarding `/api` to `http://localhost:3000`.
  - Home page displaying live health status badges for Overall API, PostgreSQL 16, and Redis 7.
- Implemented Database layer with Drizzle ORM and PostgreSQL:
  - Installed `drizzle-orm`, `drizzle-kit`, `argon2`, and `ulid`.
  - Defined full schema in `apps/server/src/db/schema.ts` for 12 tables (`users`, `categories`, `channels`, `follows`, `channel_mods`, `streams`, `chat_messages`, `bans`, `mod_actions`, `vods`, `notifications`, `refresh_tokens`).
  - Applied `timestamptz` on every timestamp, UUID/ULID primary keys, and explicit foreign key `ON DELETE` rules (`cascade` / `set null`).
  - Created functional unique indexes on `lower(username)` and `lower(name)` for case-insensitive uniqueness, composite primary keys on `follows`, `channel_mods`, and `bans`, and required lookup indexes.
  - Exported typed client `db`, `Database` type, and `withTransaction` transaction helper from `apps/server/src/db/index.ts`.
  - Configured `drizzle.config.ts` and generated migrations in `apps/server/src/db/migrations`.
  - Implemented migration runner in `apps/server/src/db/migrate.ts` and wired root script `pnpm db:migrate`.
  - Implemented idempotent seed script in `apps/server/src/db/seed.ts` inserting 8 categories and 3 demo users with channels (password `demo12345` hashed with `argon2id`), and wired root script `pnpm db:seed`.
  - Implemented integration tests in `apps/server/src/db/db.integration.test.ts` testing case-insensitive username uniqueness, composite PK duplicate prevention on follows, and cascading deletes on user deletion.
- Implemented Authentication and Sessions:
  - Added shared Zod validation schemas in `packages/shared/src/auth.ts` (`registerSchema`, `loginSchema`, `userDtoSchema`, `channelDtoSchema`, `authResponseSchema`, `meResponseSchema`, `wsTicketResponseSchema`).
  - Implemented cryptographic functions (`apps/server/src/auth/crypto.ts`) using `argon2id` for passwords/stream keys and SHA-256 for token hashing.
  - Implemented JWT signing/verification with `jose` (15-minute expiry) in `apps/server/src/auth/jwt.ts`.
  - Implemented Redis-backed one-time ticket creation and atomic `GETDEL` redemption in `apps/server/src/auth/ticket.ts`.
  - Implemented Redis rate limiting (10 attempts per 15 minutes by IP and username) in `apps/server/src/auth/ratelimit.ts`.
  - Built Fastify preHandler hooks `requireAuth` and `optionalAuth` in `apps/server/src/auth/middleware.ts`.
  - Built auth services and route handlers in `apps/server/src/auth/service.ts` and `apps/server/src/auth/routes.ts`:
    - `POST /api/auth/register`: creates user + channel, sets httpOnly refresh token cookie, returns access token.
    - `POST /api/auth/login`: rate-limited, identical error for wrong user vs password, sets httpOnly cookie.
    - `POST /api/auth/refresh`: rotates refresh token with SHA-256 hash storage, implements token reuse detection that revokes all sessions if a revoked token is reused.
    - `POST /api/auth/logout`: revokes token in DB and clears cookie.
    - `GET /api/me`: returns authenticated user and channel.
    - `POST /api/ws-ticket`: issues authenticated ticket or guest ticket with 30s TTL.
  - Integrated `@fastify/cookie` with `apps/server/src/app.ts`.
  - Wrote 10 comprehensive integration tests in `apps/server/src/auth/auth.integration.test.ts` (all 10 passed).
  - Verified live API via curl happy-path execution.
- Implemented Channel, Category and Follow REST Endpoints:
  - Added shared DTO and validation schemas in `packages/shared/src/channel.ts` (`categoryDtoSchema`, `channelDetailDtoSchema`, `updateChannelSchema`, `rotateStreamKeyResponseSchema`, `followedChannelDtoSchema`, `liveChannelDtoSchema`).
  - Built channel & category service layer in `apps/server/src/channels/service.ts`:
    - `getCategories`: returns all categories alphabetically.
    - `getChannelByName`: public lookup with `optionalAuth` computing followerCount and `isFollowing`.
    - `updateMyChannel`: owner-only updates for title (max 100 characters) and categoryId.
    - `rotateStreamKey`: generates 32 base64url random bytes, stores only SHA-256 hash in DB, and returns the plain key once.
    - `followChannel` & `unfollowChannel`: idempotent follow/unfollow operations with self-follow rejection and 404 for unknown channels.
    - `getFollowedChannels`: returns followed channels ordered with active live channels first (newest live first), followed by offline channels.
    - `getLiveChannels`: returns channels currently marked `isLive = true`, with `viewerCount = 0`, supporting `?category=` and `?q=` ILIKE filters.
  - Implemented thin route handlers in `apps/server/src/channels/routes.ts` registered in `apps/server/src/app.ts`.
  - Added integration tests in `apps/server/src/channels/channels.integration.test.ts` verifying owner-only PATCH, stream key rotation & hash storage, follow idempotence, self-follow rejection, following order, and live filtering.
  - All 22 Vitest tests pass across all test suites, and ESLint / TypeScript typecheck pass with 0 errors and 0 warnings.
- Implemented Web App Shell with Auth and Channel Pages (TASK 5):
  - Core UI component library built purely with Tailwind CSS: `Button`, `Input`, `Modal`, `Toast`, `Avatar` (colored initials), and `Skeleton`.
  - Secure in-memory API client (`apps/web/src/lib/api.ts`) with silent token refresh on app startup / 401 response and `credentials: 'include'`.
  - `AuthProvider` keeping access token strictly in memory, silent refresh via httpOnly cookie on boot, and state synchronization across components.
  - `ProtectedRoute` component redirecting unauthenticated users to `/login`.
  - Layout components: `Navbar` (logo, search placeholder, studio button, user avatar menu, mobile hamburger), `Sidebar` (Following list with live pulsing indicators, offline status, mobile overlay), and composite `AppLayout`.
  - Pages:
    - `Home` (`/`): live channel grid from `/api/live`, loading skeletons, and empty state.
    - `Login` (`/login`): authentication form with error handling and navigation.
    - `Register` (`/register`): sign up form with client-side validation constraints.
    - `Channel` (`/c/:name`): responsive layout with 16:9 player placeholder, 340px chat placeholder, channel header, and toggleable follow/unfollow button.
    - `Studio` (`/studio`): protected creator panel with "Go live panel coming soon" placeholder.
    - `Settings` (`/settings`): protected channel management with title/category updates and copy-once stream key rotation modal.
    - `NotFound` (`*`): responsive 404 page with return-to-home button.
  - Strict TypeScript compliance, ESLint zero errors/warnings, Vitest 22 tests passing, and Vite production bundle build succeeding cleanly.
- Implemented WebSocket Gateway (Server) and WsClient (Browser) (TASK 6):
  - Created `packages/shared/src/protocol.ts` defining:
    - Message envelope schema and Zod discriminated union for all client-to-server messages (`chat.*`, `mod.*`, `user.subscribe`, `test.echo`, and `media.*` placeholders).
    - Server-to-client push message types and error codes.
    - Close codes: 4400 bad message, 4401 unauthorized, 4403 forbidden, 4429 too many messages.
  - Implemented `apps/server/src/realtime`:
    - `Conn`: encapsulated connection tracking with `id`, `user` (`{ id, username, guest }`), `alive`, `rooms` Set, per-connection `state` bag, `send(t, d)`, `ack(id, d)`, `fail(id, code, message)`.
    - `Dispatcher`: handler registry with shared Zod validation, error-to-reply mapping, 4400 close on malformed JSON, unknown type errors, and built-in `test.echo` handler.
    - Inbound rate limiter: per-connection limit of 50 messages/sec; exceeding closes connection with close code 4429.
    - `WebSocketGateway`: `WebSocketServer` with `noServer: true` and `maxPayload: 16 KB`.
    - Upgrade handler: validates `Origin` against `WEB_ORIGIN` (rejects with 403 by destroying socket), redeems one-time ticket via atomic `redeemTicket` (rejects with 401 on missing/invalid/reused ticket).
    - Heartbeat: pings active connections every 25s (configurable for tests); terminates unresponsive connections.
    - Cleanup hook registry: modules register callbacks via `onCleanup(conn => ...)` that execute automatically when connections close.
    - Attached WebSocket gateway upgrade and lifecycle hooks to Fastify app in `apps/server/src/app.ts`.
  - Implemented `apps/web/src/lib/ws.ts` and `WsContext.tsx`:
    - `WsClient`: automatic one-time ticket acquisition from `/api/ws-ticket`, `request(t, d)` returning a Promise resolved by matching `ack` or rejected by `error` with a 10s timeout, event subscription via `on(t, handler)`, and `onOpen` hook registry.
    - Exponential backoff reconnect with full jitter (500ms base, 30s cap) requesting a fresh ticket on each attempt.
    - React context provider `WsProvider` and `useWs` hook mounted in `App.tsx` with a dev-only floating status badge displaying real-time connection status (`WS: open`, `reconnecting`, etc.).
  - Added 8 comprehensive Vitest integration tests in `apps/server/src/realtime/gateway.integration.test.ts` with a real `ws` client verifying all gateway behaviors. All 30 tests pass across the entire monorepo.
- Implemented Live Chat Core, Server and UI (TASK 7):
  - Updated `packages/shared/src/protocol.ts` with `ChatMessageDto`, `ChatUserDto`, `ChatJoinResponse`, and deterministic `getUserColor` utility.
  - Implemented server chat module in `apps/server/src/chat`:
    - `service.ts`: control code stripping, ULID message id generation, deterministic user color assignment, pre-serialized JSON push formatting, Redis recent message storage (`LPUSH` + `LTRIM` to 100), and history retrieval (`getRecentMessages`).
    - `handlers.ts`:
      - `chat.join`: joins connection to room `chat:{channelId}`, subscribes to Redis channel `chat:{channelId}` on first local member, replies with last 50 messages from Redis list in chronological order.
      - `chat.leave`: removes connection from room, unsubscribes from Redis when last local member leaves.
      - `chat.send`: rejects guests with `FORBIDDEN`, enforces 1-500 character limit, sanitizes control characters, publishes to Redis channel and pushes to recent list.
      - `broadcastRawToRoom`: broadcasts pre-serialized JSON payload directly to local sockets, skipping overloaded sockets where `bufferedAmount > 1 MB`.
      - Connection cleanup hook: removes closing connections from all rooms and unregisters Redis subscriptions when rooms become empty.
    - Wired `registerChatHandlers` in `apps/server/src/app.ts`.
  - Implemented web chat UI in `apps/web/src/features/chat/ChatPanel.tsx`:
    - Auto-joins room on mount, leaves on unmount, and automatically resubscribes on socket reconnect.
    - Displays message history from `chat.join` ack reply.
    - Ingests live messages, capping memory at the last 150 messages.
    - Auto-scrolls to bottom, pausing auto-scroll when user scrolls up and displaying a "More messages below" floating pill.
    - Strict plain-text message rendering (no HTML/script injection vectors).
    - Chat input with 500-character counter, Enter-to-send shortcut, and a "Log in to chat" prompt for guests.
    - Integrated `ChatPanel` into `apps/web/src/pages/Channel.tsx`.
  - Added 4 comprehensive integration tests in `apps/server/src/chat/chat.integration.test.ts` verifying delivery only to matching rooms, guest rejection, history on join, and character length enforcement. All 34 tests pass.
- Implemented Chat Rate Limiting, Slow Mode, Reconnect Replay & Persistence (TASK 8):
  - Fixed-window rate limiting in Redis: enforced per-user per-channel limit of 20 messages per 30 seconds (`ratelimit:chat:{channelId}:{userId}`). Violations return `RATE_LIMITED` error with `retryAfterMs`.
  - Slow mode enforcement:
    - Mirrored `slow_seconds` setting in Redis hash `chan:{channelId}:settings`.
    - Enforced slow mode for non-moderators using `SET slow:{channelId}:{userId} 1 EX seconds NX`. Rejected messages return `SLOW_MODE` error with remaining TTL.
    - Updated `PATCH /api/channels/me` to support `slowSeconds` (0-120), persisting to both PostgreSQL and Redis hash.
    - Added `user.isModFor(channelId)` stub returning `false`.
  - Reconnect replay:
    - Updated `chat.join` to accept optional `lastMid`. On reconnect, only messages newer than `lastMid` are retrieved from the recent messages list (`msg.mid > lastMid`).
    - Updated web `ChatPanel` to record `lastSeenMid`, transmit it on reconnect, and de-duplicate incoming messages by `mid`.
  - Batch persistence worker (`ChatPersistenceWorker`):
    - In-memory queue writing messages to PostgreSQL table `chat_messages` in batches (every 1 second or 100 messages, whichever comes first) via multi-row `INSERT ... ON CONFLICT DO NOTHING`.
    - Resilient delivery: persistence errors never block live chat; worker logs and retries once.
    - Gracefully flushes remaining queued messages on server shutdown (`onClose` hook).
  - Chat history cursor pagination:
    - Implemented `GET /api/channels/:id/chat/history?before=<mid>&limit=50` querying `chat_messages` joined with `users`, returning messages before the specified ULID cursor in chronological order.
  - Web UI improvements:
    - Displays inline system notices in the chat stream for `RATE_LIMITED` and `SLOW_MODE`.
    - Temporarily disables the chat input and displays a visible live countdown badge (e.g. "Slow mode: wait 10s...") until the cooldown expires.
    - Added Slow Mode input control (0-120s) to Channel Settings (`/settings`).
  - Added 5 comprehensive Vitest integration tests in `apps/server/src/chat/task8.integration.test.ts` covering 21st message rejection, slow mode blocking & expiration, replay by `lastMid`, batch persistence flush triggers (count and timer), and cursor pagination. All 39 tests pass.
- Implemented Roles and Moderation (TASK 9):
  - Permissions Service (`apps/server/src/moderation/service.ts`):
    - Defined roles per channel: `owner`, `moderator` (via `channel_mods`), `viewer`, and `guest`.
    - Implemented permission matrix `can(user, channelId, action)`: viewers send messages; mods and owner can delete messages (`chat:delete`), timeout (`chat:timeout`), ban (`chat:ban`), and change slow mode (`chat:slow`); only owner adds or removes mods (`mod:manage`).
    - Implemented `canModerateTarget(actorId, targetUserId, channelId)` enforcing immunity rules: owners cannot be moderated/banned; moderators cannot moderate or ban the channel owner or other moderators; users cannot moderate themselves.
    - Redis hot-path ban caching: checks `bans:{channelId}` set with Postgres fallback and cache warming; writes bans to DB table `bans` and logs audit events to `mod_actions`.
    - Timeouts: stored in Redis key `timeout:{channelId}:{userId}` with TTL, returning remaining seconds, and audited in `mod_actions`.
  - Channel REST Endpoints (`apps/server/src/moderation/routes.ts` & `apps/server/src/channels`):
    - `POST /api/channels/:id/mods` { username } (owner only, validates target, creates `channel_mods` row, logs audit).
    - `DELETE /api/channels/:id/mods` { username } (owner only, supports body/query, removes `channel_mods` row, logs audit).
    - `GET /api/channels/:id/mods` (lists all active moderators with IDs and usernames).
    - Enriched `GET /api/channels/:name` with `ownerId` and `isMod` flags for client permission resolution.
  - WebSocket Moderation Handlers (`apps/server/src/moderation/handlers.ts`):
    - `mod.delete { channelId, mid }`: validates permission, logs deletion in `mod_actions`, and broadcasts push event `{ t: 'chat.deleted', d: { mid } }` through Redis pub/sub.
    - `mod.timeout { channelId, userId, seconds, reason? }`: validates target immunity, sets Redis key with TTL, broadcasts system notice to chat room, and logs audit.
    - `mod.ban { channelId, userId, reason? }`: validates target immunity, persists to DB and Redis hot-path set, broadcasts `{ t: 'user.banned', d: { channelId, userId } }`, and immediately kicks the banned socket from the chat room across all gateways.
    - `mod.slow { channelId, seconds }`: validates permission, updates DB and Redis hash, broadcasts slow mode system notice.
  - Chat Enforcement & Badges (`apps/server/src/chat/handlers.ts` & `service.ts`):
    - Banned users get `BANNED` error and immediate eviction from chat room on `chat.send`.
    - Timed-out users get `TIMED_OUT` error with `retryAfterMs` remaining cooldown.
    - Added deterministic `'owner'` and `'mod'` badges to message payload `user.badges`.
  - Web UI Moderation Features:
    - Hover action menu on chat messages for authorized users (Delete, Timeout with 1m / 10m / 1h shortcuts, Ban) with immunity guards.
    - Deleted messages automatically replaced inline with `<span className="italic text-gray-500">message deleted</span>`.
    - Live badges for `[OWNER]` and `[MOD]` rendered next to user names.
    - Banned user banner and disabled input ("You have been banned from chatting in this channel").
    - Timed-out banner with live countdown timer and disabled input during timeout.
    - Quick Slow Mode adjustment popover in chat header for channel owner and mods (Off, 5s, 10s, 30s, 60s, 120s).
    - Dedicated "Channel Moderators" section in Channel Settings (`/settings`) allowing stream owners to view, add by username, and revoke moderators.
  - Added 7 comprehensive Vitest integration tests in `apps/server/src/moderation/moderation.integration.test.ts` verifying permission matrix across all 4 roles and 6 actions, owner and mod immunity rules, REST endpoints authorization, WebSocket message deletion broadcast, timeout expiry, ban persistence across reconnects, and message badges. All 46 tests pass.
- Implemented Viewer Counts and Live Directory Updates (TASK 10):
  - Redis Presence Service (`apps/server/src/presence/service.ts`):
    - Tracks active viewers using Redis sorted set `viewers:{channelId}` (member = connection id `conn.id`, score = last-seen epoch timestamp in ms).
    - Multi-tab tracking: distinct browser tabs establish distinct WebSocket connections with unique `conn.id`s, naturally counting each tab as a viewer.
    - Touch & Refresh: heartbeat ticks update score; explicit `chat.leave` and disconnect cleanup hooks call `removeViewer`.
    - Stale pruning: `ZREMRANGEBYSCORE viewers:{channelId} 0 (now - 60000)` prunes viewers whose connections failed without clean closure.
    - Peak tracking: records maximum count seen in Redis key `stream:peak:{channelId}`, exposed via `getPeak` and `getViewerCount`.
  - Coalesced Aggregation Worker (`PresenceWorker` in `apps/server/src/presence/worker.ts`):
    - Background interval worker running every 5 seconds (configurable for tests).
    - Operates across all channels with local viewers: prunes stale records, fetches `ZCARD`, updates Redis peak, and publishes a single coalesced `{ t: 'viewers.count', d: { channelId, count } }` message to Redis channels `chat:{channelId}` and `directory:live`.
    - Zero broadcast on join/leave: eliminates per-join pub/sub chatter and stampedes.
  - Directory Room & Event Dispatcher (`apps/server/src/presence/handlers.ts`):
    - Implemented `user.subscribe { topics: ['live'] }` handler adding connections to local room `directory:live` and wiring Redis subscription to `directory:live`.
    - Published events: `stream.live` ({ channelId, name, title, category, ownerUsername, viewerCount }), `stream.offline` ({ channelId }), and `viewers.count`.
    - Exported publisher helpers `publishStreamLive` and `publishStreamOffline`.
  - REST Endpoints Integration:
    - Updated `GET /api/live` and `GET /api/channels/:name` to query `getViewerCount(channel.id)` and return real-time viewer counts.
  - Web Client Integration:
    - Channel Page (`apps/web/src/pages/Channel.tsx`): subscribes to `viewers.count` event; displays real-time viewer count in both the channel header and video player overlay.
    - Home Page (`apps/web/src/pages/Home.tsx`): connects to WebSocket on mount, issues `user.subscribe { topics: ['live'] }`, shows live viewer badges on stream cards, dynamically adds/removes stream cards on `stream.live` / `stream.offline`, and smoothly updates viewer counts on `viewers.count` without page reloads.
  - Added 7 comprehensive Vitest integration tests in `apps/server/src/presence/presence.integration.test.ts` verifying:
    - Viewer count increments to 2 for two separate connections.
    - Same user in two tabs counts as 2 viewers.
    - Pruning of stale viewers older than 60s.
    - Coalesced periodic broadcast (no per-join broadcast).
    - Disconnect/cleanup decrementing count.
    - Directory subscription receiving `stream.live`, `stream.offline`, and `viewers.count`.
    - REST `/api/live` and `/api/channels/:name` returning accurate real-time viewer counts.
  - All 9 test files / 53 tests pass across the monorepo; ESLint and TypeScript check pass with zero warnings/errors; Vite production build succeeds.
- Implemented mediasoup Foundation (TASK 11):
  - Installed and pinned `mediasoup@3.15.2` with approved builds in `pnpm-workspace.yaml`. Prebuilt native worker downloaded and verified for Windows x64.
  - Documented OS prerequisites in `README.md` (Python 3.10+, make, C++ compiler (MSVC/Clang/GCC), WSL2 on Windows).
  - Media Codecs (`apps/server/src/media/config.ts`): configured router capabilities for audio (Opus, 48kHz, 2 channels) and video (VP8 at 90kHz; H.264 at 90kHz with `packetization-mode: 1`, `profile-level-id: 42e01f`, `level-asymmetry-allowed: 1`).
  - WorkerPool (`apps/server/src/media/worker-pool.ts`):
    - Instantiates `max(1, cpuCores - 1)` workers (or configured `MEDIA_WORKERS` env override).
    - Configured with `rtcMinPort` (40000) and `rtcMaxPort` (40100) from env, and `logLevel: 'warn'`.
    - Attached `died` event listener logging an error and exiting process (`process.exit(1)`).
    - Round-robin worker selection via `getNextWorker()`.
  - RoomManager (`apps/server/src/media/room-manager.ts`):
    - `getOrCreate(channelId)`: creates a new `Router` on the next worker round-robin with standard codecs; maintains `Room` object `{ router, publisher?: { userId, connId }, producers: Map, viewers: Map, transports: Map }`; reuses existing room if already created.
    - `close(channelId)`: closes all associated transports and the router, removing the room.
    - `list()`: returns all active rooms.
    - `closeAll()`: cleans up all rooms on server shutdown.
    - Tracks router-to-worker mapping to provide `routerCount` per worker.
  - WebRTC Transport Helper (`apps/server/src/media/transport.ts`):
    - Implemented `createWebRtcTransport(room, options)` using mediasoup v3 `listenInfos` API: UDP and TCP enabled, `preferUdp: true`, announced address from `PUBLIC_IP`, and `initialAvailableOutgoingBitrate: 1_000_000`.
    - Returns `{ transport, params: { id, iceParameters, iceCandidates, dtlsParameters } }` and automatically tracks/cleans up transports on `close` and `routerclose`.
  - Lifecycle Integration:
    - Server startup: `initMedia()` initializes WorkerPool and RoomManager during Fastify `onReady` hook and server `start()`.
    - Graceful shutdown: `shutdownMedia()` closes all rooms and terminates all mediasoup workers during Fastify `onClose` hook and server `gracefulShutdown()`.
  - Dev-only Debug Endpoint (`apps/server/src/media/routes.ts`):
    - `GET /api/debug/media`: lists workers (`pid`, `routerCount`, `closed`) and rooms (`channelId`, `producers`, `viewers`, `transports`).
    - Explicitly disabled (returns 404 Not Found) when `NODE_ENV === 'production'`.
  - Fixed `.gitignore` rule from `media/` to `/media/` so runtime media recording directories are ignored while server module `apps/server/src/media` remains tracked by Git.
  - Added 7 comprehensive Vitest integration tests in `apps/server/src/media/media.integration.test.ts` verifying:
    - WorkerPool initialization with configured options and healthy PIDs.
    - Room creation and idempotent retrieval.
    - WebRtcTransport creation with `PUBLIC_IP` and `RTC_MIN_PORT`-`RTC_MAX_PORT` range.
    - Dev-only `/api/debug/media` output.
    - `/api/debug/media` returning 404 in production mode.
    - Clean room closure and transport termination.
    - Clean worker pool shutdown with zero open handles.
  - All 10 test files / 60 tests pass across the monorepo; ESLint 0 warnings/errors; TypeScript typecheck passes; Vite production build succeeds.
- Implemented Broadcaster Signaling and Studio Page (TASK 12):
  - Shared Protocol (`packages/shared/src/protocol.ts`):
    - Replaced `media.*` placeholders with typed schemas: `media.join` (`channelId`, `role: 'publisher' | 'viewer'`), `media.createTransport` (`direction: 'send' | 'recv'`), `media.connectTransport` (`transportId`, `dtlsParameters`), and `media.produce` (`transportId`, `kind: 'audio' | 'video'`, `rtpParameters`, `appData?`).
    - Added error codes `'ALREADY_PUBLISHING'`, `'TOO_MANY_TRANSPORTS'`, `'PRODUCER_EXISTS'` to `WsErrorCode`.
  - Server Media Signaling (`apps/server/src/media/handlers.ts`):
    - `media.join`: verifies authenticated channel ownership (rejects non-owners and guests with `FORBIDDEN`); checks `room.publisher` and rejects concurrent publisher with `ALREADY_PUBLISHING`; returns `{ routerRtpCapabilities }`.
    - `media.createTransport`: enforces per-connection cap of 2 transports (`TOO_MANY_TRANSPORTS`), calls `createWebRtcTransport`, stores transport in `conn.state.media.transports`.
    - `media.connectTransport`: connects transport with client DTLS parameters.
    - `media.produce`: verifies publisher role and send direction; enforces max one audio and one video producer (`PRODUCER_EXISTS`); produces track and tracks in `room.producers` and connection state; cleans up on `'transportclose'`.
    - Disconnect cleanup hook (`gateway.onCleanup`): terminates transports and producers on publisher disconnect and clears `room.publisher`.
  - Web Client Studio (`apps/web`):
    - Installed exact `mediasoup-client@3.7.18`.
    - Built `usePublisher` hook (`apps/web/src/features/studio/usePublisher.ts`): manages `Device` loading, send transport creation, DTLS connect and produce event callbacks over WebSocket, track production with `maxBitrate: 2_500_000`, track replacement for screen sharing, and clean teardown on unmount.
    - Built Studio Page (`apps/web/src/pages/Studio.tsx`): live preview video, camera & microphone pickers (`enumerateDevices`), screen sharing toggle (`getDisplayMedia`), "Go Live" / "End Stream" button, stream title & category from channel settings, status indicator (`idle`, `connecting`, `live`, `error`), and user-friendly permission error notices.
  - Tests:
    - 4 unit tests with mocked mediasoup objects (`apps/server/src/media/signaling.mock.test.ts`): non-owner rejection, second publisher rejection, transport cap, and cleanup on close.
    - 6 end-to-end integration tests with real WebSockets and mediasoup workers (`apps/server/src/media/signaling.integration.test.ts`).
  - Monorepo Verification: All 12 test files / 70 tests pass; ESLint 0 warnings/errors; TypeScript typecheck clean; Vite production bundle built successfully.

## Decisions
- **Mediasoup Prebuilt Binary Strategy**: Pinned exact version `mediasoup@3.15.2`. On Windows, the npm postinstall script automatically fetches precompiled native worker binaries (`mediasoup-worker-3.15.2-win32-x64.tgz`) from GitHub releases, avoiding external MSVC compilation toolchain failures while supporting full C++ performance.
- **Root .gitignore Scope**: Updated `.gitignore` to use `/media/` instead of `media/` so that root runtime media directories (`media/hls`, `media/vod`) are excluded from version control without accidentally ignoring the source code folder `apps/server/src/media/`.
- **Flexible Transport Parameter Returns**: `createWebRtcTransport` returns both `{ transport, params: { id, iceParameters, iceCandidates, dtlsParameters }, clientParams: ... }` and top-level fields (`id`, `iceParameters`, etc.), allowing future signaling handlers in Task 12 to consume either structure cleanly.
- **Router Count Tracking per Worker**: Tracked router allocations in `RoomManager` via a lightweight router-to-worker map (`Map<routerId, workerPid>`), enabling instant O(1) worker router count reporting on the `/api/debug/media` monitoring endpoint.
- **Idempotent Media Initialization & Tear-Down**: `initMedia` and `shutdownMedia` use guarded module singletons. Multiple invocations across tests or server startup hooks safely return existing instances or gracefully close workers.
- **Decoupled Viewer Cleanup via Conn.state**: In addition to `conn.rooms`, active viewing channels are tracked in `conn.state.set('viewing:<channelId>', true)`. This guarantees that even if a room-leave hook runs before a presence cleanup hook on socket termination, presence removal and Redis cleanup execute cleanly and reliably.
- **Strictly Coalesced Viewer Broadcasts**: Zero push messages are broadcast on join or leave. All viewer count updates are batched into a single periodic 5-second tick per channel, completely shielding clients and Redis from connection thrashing during stream spikes.
- **Multi-Tab Presence via Connection ID**: Redis sorted set members are `conn.id` strings (UUIDs) rather than user IDs. This allows guest viewers, unauthenticated tabs, and multiple tabs by the same logged-in user to each be counted accurately as an active viewer stream.
- **Target Moderation Immunity Hierarchy**: Channel owners are immune to all moderation actions (ban, timeout). Moderators cannot moderate other moderators or the owner. Any moderation attempt violating this hierarchy returns `FORBIDDEN` ("Cannot moderate the channel owner" or "Moderators cannot moderate other moderators").
- **Real-Time Cross-Gateway Room Eviction**: When a user is banned via `mod.ban`, the event `user.banned` is broadcast to Redis channel `chat:{channelId}`. Every gateway subscribing to that room evicts any matching local socket connection for that user immediately, preventing any further chat participation without waiting for polling.
- **Hot-Path Redis Ban Caching**: Banned user checks on the `chat.send` critical path first query the Redis set `bans:{channelId}` (O(1)). On cache miss, it queries PostgreSQL `bans` table; if an active ban is found, it warms the Redis set. Unbans atomically remove the user from both PostgreSQL and the Redis set.
- **Inline Message Tombstones**: When a message is deleted via `mod.delete`, gateways broadcast `{ t: 'chat.deleted', d: { mid } }`. Connected clients immediately replace the message text with `"message deleted"` in-place without removing the row, preserving chat stream continuity.
- **REST and Query Tolerance on DELETE**: `DELETE /api/channels/:id/mods` accepts the target username in both request JSON body and query parameters, ensuring compatibility across all HTTP clients and reverse proxies.
- **Non-blocking Chat Persistence**: Chat message delivery remains sub-millisecond over WebSocket and Redis pub/sub. Database persistence is performed asynchronously by a decoupled in-memory batch worker (`ChatPersistenceWorker`), isolating PostgreSQL write latency from the chat hot path.
- **ULID-based Reconnect Replay & History Pagination**: Reconnect replay and REST history pagination exploit ULID lexicographical sorting (`msg.mid > lastMid` and `chatMessages.id < before`), guaranteeing strict chronological message ordering across reconnects.
- **Slow Mode Redis Invalidation**: Channel `slowSeconds` is cached in Redis hash `chan:{channelId}:settings`. Any update via `PATCH /api/channels/me` updates both Postgres and Redis atomically, ensuring instantaneous enforcement without stale read windows.
- **Pre-serialized Chat Delivery**: `chat.send` pre-serializes the server push envelope once and publishes it to Redis. Gateways deliver the exact string directly to local sockets via `broadcastRawToRoom` without deserialization overhead, skipping slow connections whose `bufferedAmount > 1 MB`.
- **Dynamic Redis Pub/Sub Lifecycle**: The server subscribes to `chat:{channelId}` only when the first local client joins the room and unsubscribes immediately when the last local client leaves or disconnects, conserving Redis resources.
- **Strict Plain Text Rendering**: React text nodes are used exclusively in `ChatPanel` so user chat text is never parsed as HTML or markdown, preventing XSS.
- **WebSocket Upgrade Authentication Flow**: Validates Origin against `WEB_ORIGIN` first (403 on mismatch) before redeeming the ticket atomically from Redis via `redeemTicket` (401 on missing, expired, or previously redeemed tickets), destroying the socket cleanly with HTTP status codes.
- **WebSocket Close Code Semantics**: Custom close codes strictly align with PROJECT_CONTEXT.md: 4400 (bad JSON), 4401 (unauthorized), 4403 (forbidden), 4429 (rate limit exceeded / too many messages).
- **Full Jitter Reconnect Algorithm**: Browser `WsClient` reconnects using exponential backoff capped at 30 seconds with full jitter (`random(0, min(30000, 500 * 2^attempt))`) to prevent thundering herd reconnection spikes to the server.
- **In-memory token security**: In accordance with security best practices and project constraints, access tokens are never saved to `localStorage` or `sessionStorage`. They are stored in module memory in `lib/api.ts`, while session persistence is handled via httpOnly SameSite=Lax refresh cookies.
- **Concurrent 401 retry deduplication**: `lib/api.ts` deduplicates concurrent token refreshes using a shared promise so multiple parallel requests receiving 401 do not trigger multiple refresh rotations.
- **Pure Tailwind CSS UI**: Built all interactive components (`Modal`, `Toast`, `Dropdown`, `Avatar`) directly with Tailwind CSS and SVG icons without bloated external component libraries.
- **Docker PostgreSQL host port**: A local Windows service (`postgresql-x64-18`) was running on host port 5432. Per user selection, `infra/docker-compose.yml` maps host port 5433 to container port 5432 (`127.0.0.1:5433:5432`), and `DATABASE_URL` in `.env` / `.env.example` is set to `postgresql://postgres:postgres@localhost:5433/netstream`.
- **Parallel dev script**: Root `package.json` `"dev"` uses `"pnpm -r --parallel dev"` for native, cross-platform workspace task execution without subshell quote-escaping problems.
- **pnpm build approvals**: Approved `esbuild` and `argon2` build scripts under `allowBuilds` in `pnpm-workspace.yaml` per pnpm v11 requirements.
- **Database driver & ORM**: Used `postgres` (postgres.js) with `drizzle-orm/postgres-js` for typed queries, migrations, and transactions.
- **Case-insensitive uniqueness**: Enforced via PostgreSQL functional unique indexes (`uniqueIndex('users_username_lower_idx').on(sql`lower(${table.username})`)` and `channels_name_lower_idx`).
- **ULID for Chat Messages**: Chat message primary key is defined as `text('id').primaryKey()` for ULID identifiers.
- **Fastify Cookie Version**: Pinned `@fastify/cookie` to `^9.4.0` for full compatibility with Fastify 4.x.
- **Refresh Token Lifecycle**: Stored as SHA-256 hashes in `refresh_tokens`. On refresh, the token is rotated. If a revoked token is ever presented, all tokens for that user are immediately revoked (family revocation / reuse detection).
- **Cookie Security**: Refresh token cookies are set with `httpOnly: true, sameSite: 'lax', path: '/'`, and `secure: true` only in production (`NODE_ENV === 'production'`).
- **Stream Key Security**: Plain stream keys are generated as 32-byte base64url random strings. Only the SHA-256 hash is persisted in the database, and the plain key is returned once upon rotation. Neither public nor authenticated channel endpoints include stream keys.
- **Following Order Strategy**: Ordered by `desc(channels.isLive)`, `desc(COALESCE(streams.startedAt, channels.createdAt))`, `desc(follows.createdAt)`.
- **Live Stream Search**: Case-insensitive substring filtering using PostgreSQL `ilike` on category name and on channel title and name.

## Known issues
- None.

## How to run
1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start background databases (PostgreSQL and Redis):
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```
3. Run database migrations:
   ```bash
   pnpm db:migrate
   ```
4. Seed database with categories and demo accounts:
   ```bash
   pnpm db:seed
   ```
5. Run verification tests:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```
6. Start both API and Web servers in development mode:
   ```bash
   pnpm dev
   ```

### Task 5 Manual Verification Steps

1. **Register**: Navigate to `http://localhost:5173/register` and register a new account (e.g., username `teststreamer`, email `teststreamer@example.com`, password `Password123!`). Confirm you are redirected to the homepage and your avatar appears in the top navigation.
2. **Log out**: Click your avatar dropdown in the top navbar and click **Sign Out**. Confirm the navbar reverts to showing **Log In** and **Sign Up** buttons.
3. **Log in**: Navigate to `http://localhost:5173/login`, enter your username or email and password, and click **Sign In**. Confirm you are logged back in.
4. **Session Persistence**: Press `F5` to hard-refresh the browser page. Confirm you remain logged in via silent refresh token exchange without using `localStorage`.
5. **Edit Channel Title & Category**:
   - Go to `http://localhost:5173/settings` (or select **Channel Settings** from the avatar dropdown).
   - Change your stream title to `Computer Networks Live Demo` and select a category from the dropdown.
   - Click **Save Changes** and confirm the green success toast notification appears.
6. **Rotate Stream Key**:
   - On the `/settings` page, click **Rotate Key** in the Stream Key section and confirm the prompt.
   - Confirm the **New Stream Key Generated** modal appears displaying the new plain key.
   - Click the **Copy** button and confirm it copies to your clipboard and displays "Copied!".
   - Close the modal.
7. **Follow Another Channel**:
   - Navigate to `http://localhost:5173/c/alice` (one of the seeded demo channels).
   - Verify the 16:9 player placeholder and 340px chat placeholder render cleanly.
   - Click the **Follow** button. Confirm the button changes to **Following** and follower count increments.
8. **Verify Sidebar Update**:
   - Inspect the left sidebar.
   - Confirm `alice` is now listed under **Following** with her channel status.

### Task 6 Manual Verification Steps

1. **Automatic Connection**:
   - Open `http://localhost:5173` in a web browser.
   - Look at the bottom-left corner: confirm a green status pill appears reading `WS: open` with a steady green dot.
2. **Ticket Generation & Authentication**:
   - Open Browser DevTools -> **Network** tab -> filter by **WS** (or `ws`).
   - Notice the initial request `POST /api/ws-ticket` returning `{ ticket: "..." }`.
   - Notice the immediate WebSocket upgrade connection to `ws://localhost:5173/ws?ticket=...` with status `101 Switching Protocols`.
3. **Reconnection on Server Restart**:
   - Stop or restart the server process.
   - Observe the web app badge switch to `WS: reconnecting` (with pulsing amber indicator).
   - Once the server is running again, observe the client fetch a fresh ticket from `/api/ws-ticket` and re-establish the connection, returning to `WS: open`.

### Task 7 Manual Verification Steps

1. **Two-Browser Real-Time Chat**:
   - Open Browser 1 (logged in as an authenticated user, e.g. `alice` or `streamer1`) and navigate to `http://localhost:5173/c/alice`.
   - Open Browser 2 in **Incognito/Private window** (as an unauthenticated guest) and navigate to the same URL `http://localhost:5173/c/alice`.
2. **Guest Restrictions**:
   - In Browser 2 (Guest), observe the chat input is disabled with a prompt reading `"You must be logged in to participate in chat"` and a `"Log In to Chat"` button.
3. **Live Chat Ingestion & Display**:
   - In Browser 1, type `"Hello world from the streamer!"` in the chat box and press Enter.
   - Confirm the message appears immediately in Browser 1 with the user's deterministic username color, timestamp, and plain text.
   - Look at Browser 2 (Guest): confirm the message appears in real time without refreshing.
4. **Chat History on Join**:
   - Refresh Browser 2 (or open a third tab to `http://localhost:5173/c/alice`).
   - Confirm the previous message `"Hello world from the streamer!"` is retrieved from Redis history and rendered on mount.
5. **Scroll Behavior & "More Messages" Pill**:
   - In Browser 1, send multiple messages.
   - Scroll up in the chat window. Send another message.
   - Confirm auto-scrolling pauses and a floating button `"More messages below"` appears. Clicking it smoothly scrolls down to the bottom and clears the unread indicator.

### Task 8 Manual Verification Steps

1. **Configure Slow Mode**:
   - Log in and navigate to `http://localhost:5173/settings`.
   - In the **Slow Mode** input field, enter `10` seconds and click **Save Changes**.
   - Confirm the success toast notification appears.
2. **Observe Slow Mode Cooldown & Countdown**:
   - Navigate to your channel page (`http://localhost:5173/c/<your_username>`).
   - Type a chat message and press Enter. The message posts immediately.
   - Immediately attempt to send another message.
   - Observe the error handling:
     - An inline system notice appears in the chat stream: `[System]: Slow mode is active. Please wait 10s before sending another message.`
     - The input placeholder changes to `Slow mode: wait 10s...` and becomes disabled.
     - A live countdown badge appears beside the Send button counting down: `10s`, `9s`, `8s` ... until `0s`.
     - When the countdown reaches 0, the input unlocks and allows sending the next message.

### Happy Path curl Examples

1. **Register**:
   ```bash
   curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"testuser@netstream.live","username":"testuser","password":"Password123!"}'
   ```

2. **Login**:
   ```bash
   curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"identifier":"testuser","password":"Password123!"}'
   ```

3. **Get Current User Profile & Channel**:
   ```bash
   curl -s -X GET http://localhost:3000/api/me \
     -H "Authorization: Bearer <ACCESS_TOKEN>"
   ```

4. **Issue WebSocket Ticket (Authenticated)**:
   ```bash
   curl -s -X POST http://localhost:3000/api/ws-ticket \
     -H "Authorization: Bearer <ACCESS_TOKEN>"
   ```

5. **Issue WebSocket Ticket (Guest)**:
   ```bash
   curl -s -X POST http://localhost:3000/api/ws-ticket
   ```

6. **Rotate Refresh Token**:
   ```bash
   curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/refresh
   ```

7. **Logout**:
   ```bash
   curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/logout
   ```

8. **Browse Categories**:
   ```bash
   curl -s -X GET http://localhost:3000/api/categories
   ```

9. **View Channel Details**:
   ```bash
   curl -s -X GET http://localhost:3000/api/channels/alice
   ```

10. **Follow Channel**:
    ```bash
    curl -s -X POST http://localhost:3000/api/channels/<CHANNEL_ID>/follow \
      -H "Authorization: Bearer <ACCESS_TOKEN>"
    ```

11. **Browse Live Streams**:
    ```bash
    curl -s -X GET "http://localhost:3000/api/live?category=Gaming&q=stream"
    ```

### Manual Verification of Viewer Counts & Directory (Task 10)

1. **Start Services & Monorepo**:
   - Ensure Postgres (port 5433) and Redis (port 6379) are running.
   - Run `pnpm dev` from the repository root.

2. **Open Three Browser Windows/Tabs**:
   - **Tab 1**: Navigate to Home (`http://localhost:5173/`). Notice the live channels (if any) and connection status.
   - **Tab 2**: Navigate to `http://localhost:5173/c/alice`. Notice the viewer counter initially showing `1` viewer.
   - **Tab 3**: In an incognito window or second tab, navigate to `http://localhost:5173/c/alice`.
   - **Observe**: Within 5 seconds (the coalescing interval), the viewer badge on both Tab 2 and Tab 3 smoothly updates to `2 viewers`.
   - **Check Home (Tab 1)**: The stream card for alice reflects `2 viewers` without needing a page refresh.
   - **Close Tab 3**: Within 5 seconds, the viewer count decrements to `1 viewer` across Tab 2 and Tab 1.

### Verification of mediasoup Foundation (Task 11)

1. **Run Vitest Integration Tests**:
   ```bash
   pnpm --filter @netstream/server exec vitest run src/media/media.integration.test.ts
   ```

2. **Query Dev-Only Media Debug Endpoint**:
   ```bash
   curl -s -X GET http://localhost:3000/api/debug/media
   ```
   **Expected Response** (example with worker threads):
   ```json
   {
     "workers": [
       { "pid": 12345, "routerCount": 0, "closed": false },
       { "pid": 12346, "routerCount": 0, "closed": false }
     ],
     "rooms": []
   }
   ```
   In production (`NODE_ENV=production`), the endpoint returns `404 Not Found`.

### Verification of Viewer SFU & Player (Task 13)

1. **Run Vitest Unit Tests (with Mocks)**:
   ```bash
   pnpm --filter @netstream/server test run src/media/viewer.mock.test.ts
   ```

2. **Manual End-to-End Verification**:
   - In Tab A (logged in as streamer), navigate to `http://localhost:5173/studio` and click "Go Live" with camera or screen share enabled.
   - In Tab B (guest or separate browser profile), navigate to `http://localhost:5173/c/<streamer_name>`.
   - Observe the player connects via WebRTC and starts playback with the "LIVE" badge and "Click to unmute" button.
   - Click "Click to unmute" to hear audio, test volume slider and fullscreen toggle.
   - In Tab A, click "End Stream" or close the tab: Tab B immediately transitions to offline state.
   - In Tab A, go live again: Tab B recovers and resumes playback without a page reload.

### Verification of Stream Lifecycle State Machine (Task 14)

1. **Run Vitest Unit Tests**:
   ```bash
   pnpm --filter @netstream/server test run src/media/lifecycle.test.ts
   ```

2. **Manual End-to-End Verification**:
   - In Tab A, go live from Creator Studio (`/studio`). Confirm the header displays the duration counter (`MM:SS`) and Home/Sidebar reflect the live channel.
   - In Tab B, watch the stream at `/c/<name>`.
   - Kill Tab A (or close the browser window): Tab B displays "Streamer reconnecting..." with a 15-second grace window.
   - Reopen Tab A at `/studio` within 15 seconds: Tab A re-establishes the broadcast, Tab B recovers playback without refreshing.
   - Kill Tab A again and wait longer than 15 seconds: the stream terminates, Tab B transitions to offline, and the channel disappears from the Home directory grid.

### Verification of Simulcast & Quality Selection (Task 15)

1. **Run Unit Tests**:
   ```bash
   pnpm --filter @netstream/server test run src/media/layers-ice.mock.test.ts
   ```

2. **Verify Three Outbound Simulcast Streams via `chrome://webrtc-internals`**:
   - Start a camera broadcast in Creator Studio (`http://localhost:5173/studio`) and click **Go Live**.
   - Open a new tab to `chrome://webrtc-internals`.
   - Select the `RTCPeerConnection` tab corresponding to `http://localhost:5173/studio`.
   - Expand **Stats Tables** and look for `RTCOutboundRtpVideoStream` (`outbound-rtp`, `kind=video`).
   - Confirm there are **three separate `outbound-rtp` video streams** with `rid: "r0"`, `rid: "r1"`, and `rid: "r2"`, showing scaled resolutions (e.g., 1/4, 1/2, 1x) and distinct `bytesSent` / `scalabilityMode: "L1T3"`.
   - Open two viewer tabs (`/c/<name>`): set Viewer 1 to `180p` via the quality menu and keep Viewer 2 on `Auto`. Verify Viewer 1's resolution/layer badge drops to `S0T2` and lower resolution while Viewer 2 remains at high quality.

### Verification of Reconnection & ICE Restart (Task 16)

1. **Run Unit Tests**:
   ```bash
   pnpm --filter @netstream/server test run src/media/layers-ice.mock.test.ts
   ```

2. **Manual Recovery Verification**:
   - Stream from Studio (Tab A) and watch on `/c/<name>` (Tab B).
   - Click the **Drop WS** button inside the bottom-left dev status badge (`WS: open`) on Tab A or Tab B, or toggle Wi-Fi off for 5 seconds and back on.
   - Verify both sides display the reconnecting state (without destroying the viewer `<video>` element) and automatically recover playback without a page reload.
   - **Observed Recovery Time**: _Record after manual test (expected: ~1-2 s for dev WS drop, ~3-5 s for ICE restart after Wi-Fi restore)._

### Verification of Live Network Statistics Overlay (Task 17)

1. **Run Unit Tests & Typecheck**:
   ```bash
   pnpm exec vitest run apps/web/src/features/lab/stats-calculator.test.ts
   pnpm --filter @netstream/web run typecheck
   ```

2. **Manual Verification**:
   - Start a broadcast in Studio (`/studio`), click **Network Stats (S)** (or press `S`), and verify per-`rid` outbound bitrates (`r0`, `r1`, `r2`), `qualityLimitationReason`, retransmitted packets, and available outgoing bitrate update every second.
   - Open a viewer tab (`/c/<name>`), click **Stats** in the player bar (or press `S`), and verify live metrics and the 60s SVG sparklines (bitrate, loss %, RTT) update every second.
   - Enter a scenario label (e.g. `loss-5pct-run1`), click **Start**, wait 30 seconds, click **Stop**, then click **CSV** to download and verify all 16 columns in a spreadsheet.

### Verification of Go-live Notifications, Discovery & Chat Polish (Tasks 18–20)

1. **Run Unit & Integration Tests**:
   ```bash
   pnpm --filter @netstream/server test run src/notifications/notifications.test.ts src/channels/discovery.test.ts
   pnpm exec vitest run apps/web/src/features/chat/tokenizer.test.ts
   ```
2. **Manual Verification**:
   - **Task 18**: User A follows User B; B goes live in Studio; A instantly sees the clickable toast, unread bell badge, notification dropdown (with Mark all read), and live sidebar update.
   - **Task 19**: Type a partial channel name in the Navbar search, use `ArrowDown`/`ArrowUp` + `Enter` to open the channel by keyboard only; browse `/categories` and `/categories/:id`; verify Studio disables Go Live when title is blank and Home sorts by viewer count with a Following tab.
   - **Task 20**: In channel chat, open the emote picker to insert `:wave:` / `:gg:`, send `@<username>` and an `https://` link, and confirm HTML tags or `javascript:` URLs render strictly as plain text.

### Verification of STUN and TURN (Task 21)

1. **Run Unit & Route Tests**:
   ```bash
   pnpm --filter @netstream/server test run src/media/ice-config.test.ts
   ```
2. **Start coturn (Docker Compose)**:
   ```bash
   docker compose -f infra/docker-compose.yml up -d coturn
   ```
   > For LAN demos where mediasoup runs on a private host IP (e.g. `192.168.1.50`), set `PUBLIC_IP=192.168.1.50` in `.env` (or uncomment `allowed-peer-ip` in `infra/coturn.conf`) so coturn permits relay forwarding to the SFU while still blocking all other private/RFC1918 ranges.
3. **When TURN is Needed vs. mediasoup TCP Candidates**:
   - **Direct UDP (`host` / `srflx`)**: Works on home/office NATs where outbound UDP to the SFU's `RTC_MIN_PORT–RTC_MAX_PORT` (40000–40100) is permitted.
   - **mediasoup TCP candidates (`tcp`)**: Sufficient when a firewall blocks UDP entirely, **provided** outbound TCP to the SFU's high media ports (`40000–40100`) is allowed.
   - **TURN (`relay` over UDP/3478, TCP/3478, or TLS/5349/443)**: Required when clients sit behind **restrictive corporate/campus firewalls** that block all outbound UDP and non-standard TCP ports (allowing only 443/5349/3478 or an HTTP/TLS proxy), or behind **symmetric NAT + strict egress filtering** where direct peer-to-SFU paths cannot be established.
4. **How to Verify a `relay` Candidate Was Used**:
   - Start coturn (`docker compose -f infra/docker-compose.yml up -d coturn`), go live in Studio, and open a viewer tab (`/c/<name>`).
   - Press `S` (or click **Stats**) to open the Network Stats overlay, then check **Force TURN relay (DEV)** (`iceTransportPolicy: 'relay'`).
   - The player reconnects and plays via coturn; confirm the **Candidate** row in the Stats overlay displays `relay / udp` (or `relay / tcp`).

### Verification of HLS Output and Player Fallback (Task 22)

1. **FFmpeg Prerequisite**:
   - Verified with `ffmpeg -version`: FFmpeg is **not currently installed on PATH** on this host, so the server logs a clear warning at startup and disables HLS output without crashing.
   - To enable live HLS output, install FFmpeg and restart the server:
     - Windows: `winget install Gyan.FFmpeg` (or `choco install ffmpeg`) and open a new terminal, then verify `ffmpeg -version`.
     - macOS: `brew install ffmpeg`
     - Linux (Ubuntu/Debian): `sudo apt-get install ffmpeg`
2. **Run Unit Tests**:
   ```bash
   pnpm --filter @netstream/server test run src/recording/recording.test.ts
   ```
3. **Manual Verification & Latency Comparison**:
   - With FFmpeg installed and `HLS_ENABLED=true`, go live in `/studio`.
   - Open `http://localhost:3000/hls/<channelId>/index.m3u8` in VLC (or select **Compatibility mode (HLS)** in the player quality menu at `/c/<name>`).
   - Compare end-to-end delay side-by-side against a WebRTC viewer tab:
     - **WebRTC (`WebRTC (low latency)`)**: ~0.3–0.8 s end-to-end glass-to-glass latency.
     - **HLS (`HLS (about 6-10 s delay)`)**: ~6–10 s end-to-end latency (2-second segments, 3-segment live sync buffer).
   - Click the `HLS (about 6-10 s delay)` badge (or choose **WebRTC (low latency)** in the quality menu) to switch back.

### Verification of VOD Recording & Playback (Task 23)

1. **Run Unit Tests**:
   ```bash
   pnpm --filter @netstream/server test run src/recording/vod.test.ts
   ```
2. **Manual Verification**:
   - Ensure FFmpeg/ffprobe are installed on `PATH` and **Record Past Broadcasts (VOD)** is enabled in `/settings` (on by default).
   - Go live in `/studio` for ~30 seconds, then click **End Stream**.
   - Open your channel page (`/c/<name>`), click the **Past broadcasts** tab, and click the recorded broadcast to open `/vod/<id>` and verify `hls.js` playback, seek bar, ±10s controls, title, date, duration, and owner Delete button.

### Verification of Python TCP & UDP Labs (Tasks 24–25)

1. **Run Pytest Suites**:
   ```bash
   python -m pytest lab/tcp/test_tcp.py lab/udp/test_udp.py -v
   ```
2. **CLI Quick Checks**:
   - TCP: place a test file in `lab/videos`, start `python lab/tcp/server.py`, run `python lab/tcp/client.py list`, `python lab/tcp/client.py get <file>`, and `python lab/tcp/multi_client.py <file> -n 3`; inspect `lab/results/tcp_results.csv`.
   - UDP: run `python lab/udp/run_matrix.py --payload-sizes 256 1024 --counts 500 --sim-drops 0.0 0.05 --runs 2 --ack` and inspect `lab/results/udp_results.csv` (confirm `SIMULATED_*` columns are clearly labelled).

### Verification of Automated Experiment Tooling (Task 26)

1. **Verify Plotting & Netem Scripts**:
   ```bash
   python lab/analysis/plot.py
   python -m pytest lab/experiments/test_netem.py -v
   python lab/experiments/netem.py --iface eth0 --profile loss-5 --dry-run
   ```
   Confirm all 7 PNG graphs are created in `lab/results/graphs/`:
   - `throughput_vs_loss.png`
   - `observed_vs_simulated_loss.png`
   - `rtt_distributions.png`
   - `webrtc_bitrate_freezes_vs_loss.png`
   - `simulcast_layers_vs_bandwidth.png`
   - `chat_latency_vs_clients.png`
   - `webrtc_vs_hls_latency.png`
2. **Run Playwright Multi-Viewer Runner**:
   ```bash
   pnpm exec tsx lab/experiments/viewers.ts --channel http://localhost:5173/c/streamer -n 3 -t 15 --auto-publish
   ```
3. **Run WebSocket Chat Load Benchmark**:
   ```bash
   pnpm exec tsx lab/experiments/chat_load.ts -n 100 -m 20 --interval-ms 200
   ```
4. **E6 Glass-to-Glass Latency Check**:
   - In `/studio`, click **Latency Test Mode** (burns large millisecond clock onto feed) and **Go Live**.
   - Open `/c/<streamer>` and click **Clock** in the player bar.
   - Take a screenshot of both clocks side-by-side: `Latency = Viewer Epoch Ms - Sender Epoch Ms in frame`.

### Verification of Security Pass (Task 27)

1. **Run Security Test Suite**:
   ```bash
   pnpm --filter @netstream/server test src/security/security.test.ts
   ```
   Verifies:
   - Startup refusal on default `JWT_SECRET` / `COOKIE_SECRET` when `NODE_ENV=production`.
   - Path traversal rejection on `/hls` and `/vod` with `../`, encoded `%2e%2e`, and absolute paths.
   - Gateway caps: max 20 connections per IP, max 5 per user ID (HTTP 429).
   - Media caps: max 2 transports, max 4 consumers per connection (`TOO_MANY_CONSUMERS`).

2. **Audit Findings & Unsafe HTML**:
   - Confirmed 0 occurrences of `dangerouslySetInnerHTML` and `innerHTML` in `apps/web/src` and `apps/server/src`.
   - Detailed threat table and `pnpm audit` analysis documented in `docs/SECURITY.md`.

### Verification of Whole Stack Run & LAN Demo Mode (Task 28)

1. **Validate Docker Compose Production Stack**:
   ```bash
   docker-compose -f infra/docker-compose.prod.yml config
   ```

2. **LAN Demo Execution Steps**:
   - **Step 1**: On the host machine, run the LAN detection script:
     ```bash
     ./scripts/lan-demo.sh
     # Or on Windows:
     .\scripts\lan-demo.ps1
     ```
     This auto-detects the host Wi-Fi IPv4 address (e.g. `192.168.1.50`), configures `PUBLIC_IP`, `TURN_HOST`, `WEB_ORIGIN`, and `SITE_ADDRESS` in `.env`, and sets up trusted local certificates with `mkcert` (or falls back to Caddy internal TLS).
   - **Step 2**: Build web assets and start all production services:
     ```bash
     make up
     # Or:
     pnpm --filter @netstream/web build
     docker compose -f infra/docker-compose.prod.yml up --build -d
     ```
   - **Step 3**: Verify all services report healthy:
     ```bash
     docker compose -f infra/docker-compose.prod.yml ps
     ```
   - **Step 4**: On the host machine, open `https://localhost` or `https://<HOST_LAN_IP>`, log in as `streamer`, open `/studio`, and click **Go Live**.
   - **Step 5**: On a second device (smartphone, tablet, or another laptop on the same Wi-Fi):
     - Open `https://<HOST_LAN_IP>` (e.g., `https://192.168.1.50`).
     - Accept the self-signed certificate if prompted (or install the root CA if using `mkcert`).
     - Register an account (or browse as guest), open `/c/streamer`, and verify sub-second WebRTC video playback with live chat.
     - *(Reverse flow)*: Stream from the mobile device's camera to the host player; HTTPS guarantees `navigator.mediaDevices.getUserMedia` permissions are granted.

---

### Verification of Test Suite Reliability & CI Pipeline (Task 29)

1. **Run Full Server Vitest Integration Suite**:
   ```bash
   pnpm --filter @netstream/server test
   ```
   Verifies:
   - All 21 test files and 117 tests execute sequentially without race conditions (`fileParallelism: false`).
   - Media signaling, lifecycle, chat persistence, moderation, and ICE configuration tests pass deterministically.

2. **Run Web Vitest Unit Tests**:
   ```bash
   pnpm --filter @netstream/web test
   ```
   Verifies:
   - Chat tokenization and custom emotes parsing (5 tests).
   - WebRTC statistics and moving bitrate calculations (4 tests).

3. **Run Python Lab Test Suite**:
   ```bash
   python -m pytest lab/tcp lab/udp lab/experiments -v
   ```
   Verifies:
   - All 14 TCP stream framing, UDP jitter tracking, and network impairment tests pass.

4. **Run End-to-End Playwright Suite**:
   ```bash
   pnpm exec playwright test
   ```
   Verifies:
   - User authentication and login flow.
   - Broadcaster go-live with fake camera and viewer playback verification (`currentTime > 0`, `videoWidth > 0`).
   - Real-time chat message propagation.
   - Moderator message deletion.
   - Stream termination and viewer offline state transition.

---

### Final Documentation & Viva Examination Package (Task 30)

1. **Primary Documentation Index**:
   - [`README.md`](../README.md): Project overview, feature tier checklist, development and Docker quick start, and troubleshooting.
   - [`docs/ARCHITECTURE.md`](ARCHITECTURE.md): Comprehensive system architecture with 6 Mermaid diagrams (system, go-live, watch, chat, lifecycle, HLS) and ports/protocols table.
   - [`docs/PROTOCOL.md`](PROTOCOL.md): WebSocket wire protocol specification (framing, error codes, upstream/downstream message schemas) and full REST endpoint listing.
   - [`docs/WEBRTC_NOTES.md`](WEBRTC_NOTES.md): WebRTC networking deep dive (ICE-Lite, STUN/TURN, DTLS-SRTP, RTP/RTCP, NACK, PLI/FIR, TWCC, and 3-layer simulcast).
   - [`docs/LAB.md`](LAB.md): Complete laboratory manual for raw TCP/UDP socket labs, empirical experiments E2–E8, metric definitions, and chart generation.
   - [`docs/DEMO_SCRIPT.md`](DEMO_SCRIPT.md): Minute-by-minute 7-minute live demonstration script with pre-demo checklist and emergency fallback procedures.
   - [`docs/VIVA_QA.md`](VIVA_QA.md): 32 exhaustive Computer Networks viva and exam questions and answers referenced directly to repository source files.
   - [`docs/LIMITATIONS.md`](LIMITATIONS.md): Candid assessment of SFU scaling, in-memory state topology, chat flush durability, and HLS latency tradeoffs.





