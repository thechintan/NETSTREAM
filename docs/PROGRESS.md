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
- Completed all acceptance tests: dropped database schema to empty, ran `pnpm db:migrate` from empty, executed `pnpm db:seed` twice idempotently (verifying 8 categories, 3 users, 3 channels), and verified all Vitest tests pass.

## Decisions
- **Docker PostgreSQL host port**: A local Windows service (`postgresql-x64-18`) was running on host port 5432. Per user selection, `infra/docker-compose.yml` maps host port 5433 to container port 5432 (`127.0.0.1:5433:5432`), and `DATABASE_URL` in `.env` / `.env.example` is set to `postgresql://postgres:postgres@localhost:5433/netstream`.
- **Parallel dev script**: Root `package.json` `"dev"` uses `"pnpm -r --parallel dev"` for native, cross-platform workspace task execution without subshell quote-escaping problems.
- **pnpm build approvals**: Approved `esbuild` and `argon2` build scripts under `allowBuilds` in `pnpm-workspace.yaml` per pnpm v11 requirements.
- **Database driver & ORM**: Used `postgres` (postgres.js) with `drizzle-orm/postgres-js` for typed queries, migrations, and transactions.
- **Case-insensitive uniqueness**: Enforced via PostgreSQL functional unique indexes (`uniqueIndex('users_username_lower_idx').on(sql`lower(${table.username})`)` and `channels_name_lower_idx`).
- **ULID for Chat Messages**: Chat message primary key is defined as `text('id').primaryKey()` for ULID identifiers.

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
7. Check health:
   - Direct API: `curl http://localhost:3000/api/health`
   - Web application: Open [http://localhost:5173](http://localhost:5173) in your browser
