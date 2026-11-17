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

## Decisions
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
