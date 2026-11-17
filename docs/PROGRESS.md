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
- Configured root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `db:seed`.
- Completed all acceptance tests: `pnpm install`, `docker compose up -d`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm dev` (verified via curl for both direct server port 3000 and Vite dev proxy port 5173).

## Decisions
- **Docker PostgreSQL host port**: A local Windows service (`postgresql-x64-18`) was running on host port 5432. Per user selection, `infra/docker-compose.yml` maps host port 5433 to container port 5432 (`127.0.0.1:5433:5432`), and `DATABASE_URL` in `.env` / `.env.example` is set to `postgresql://postgres:postgres@localhost:5433/netstream`.
- **Parallel dev script**: Root `package.json` `"dev"` uses `"pnpm -r --parallel dev"` for native, cross-platform workspace task execution without subshell quote-escaping problems.
- **pnpm build approvals**: Approved `esbuild` build script under `allowBuilds` in `pnpm-workspace.yaml` per pnpm v11 requirements.
- **Database driver**: Installed and configured `postgres` (postgres.js) for `apps/server` database connectivity and health checks, compatible with Drizzle ORM.

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
3. Run verification tests:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```
4. Start both API and Web servers in development mode:
   ```bash
   pnpm dev
   ```
5. Check health:
   - Direct API: `curl http://localhost:3000/api/health`
   - Web application: Open [http://localhost:5173](http://localhost:5173) in your browser
