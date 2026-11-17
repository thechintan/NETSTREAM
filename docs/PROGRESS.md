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

## Decisions
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
