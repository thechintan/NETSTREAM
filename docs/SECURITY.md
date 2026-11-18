# Security Architecture & Audit Report

This document details the security controls, threat mitigations, code locations, verification tests, and remaining risks for NetStream Live.

## 1. Threat Mitigation Matrix

| Threat | Security Control | Implementation Location | Test Name |
| :--- | :--- | :--- | :--- |
| **Credential Brute Force & Guessing** | Argon2id password hashing (`memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`), Redis-backed rate limiting per IP and per username, generic error messages (`INVALID_CREDENTIALS`). | `apps/server/src/auth/crypto.ts`<br>`apps/server/src/auth/routes.ts`<br>`apps/server/src/auth/service.ts` | `auth.test.ts: returns generic error message on invalid credentials`<br>`auth.test.ts: rejects when rate limited` |
| **Session Hijacking & Cookie Tampering** | Refresh tokens stored in signed, `httpOnly`, `sameSite: 'lax'`, `secure` (in production) cookies. Access tokens stored only in browser memory. | `apps/server/src/auth/routes.ts`<br>`apps/server/src/app.ts` | `auth.test.ts: sets httpOnly refreshToken cookie` |
| **Insecure Secrets in Production** | Server refuses to boot when `NODE_ENV=production` if default or insecure `JWT_SECRET` or `COOKIE_SECRET` values are detected. | `apps/server/src/config/index.ts` | `security.test.ts: refuses startup in production if default/dev JWT_SECRET is used` |
| **Cross-Site Scripting (XSS) & Clickjacking** | `@fastify/helmet` with strict Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`, restricted scripts/media/connect). Zero `dangerouslySetInnerHTML` or `innerHTML` with user content. Chat emotes tokenized via strict AST parsing. | `apps/server/src/app.ts`<br>`apps/web/src/features/chat/messageParser.ts` | `messageParser.test.ts: renders plain text without HTML execution` |
| **WebSocket Abuse & Message Flooding** | WebSocket origin validation against `WEB_ORIGIN`, single-use ticket redemption via Redis (TTL 30s), max payload cap (16 KB), token-bucket message dispatcher rate limiting (50 msg/s). | `apps/server/src/realtime/gateway.ts`<br>`apps/server/src/realtime/dispatcher.ts` | `gateway.test.ts: checks origin and invalid tickets`<br>`dispatcher.test.ts: drops burst messages exceeding limit` |
| **WebSocket Connection Exhaustion (DoS)** | Max connection caps: maximum 20 concurrent connections per remote IP, maximum 5 concurrent connections per authenticated user ID. | `apps/server/src/realtime/gateway.ts` | `security.test.ts: enforces maximum 20 connections per IP`<br>`security.test.ts: enforces maximum 5 connections per authenticated user` |
| **SFU Resource Exhaustion (Media Flooding)** | Mediasoup WebRTC transport cap (max 2 transports per connection) and consumer cap (max 4 consumers per connection). | `apps/server/src/media/handlers.ts` | `security.test.ts: throws TOO_MANY_CONSUMERS if exceeding 4 consumers on a connection`<br>`security.test.ts: throws TOO_MANY_TRANSPORTS if exceeding 2 transports on a connection` |
| **Privilege Escalation & Unauthorized Publishing/Moderation** | Strict server-side database checks for channel ownership (`ownerId === conn.user.id`) and moderator permissions (`can()`). Client-supplied roles or identities are never trusted. | `apps/server/src/media/handlers.ts`<br>`apps/server/src/moderation/handlers.ts`<br>`apps/server/src/moderation/service.ts` | `moderation.test.ts: rejects unauthorized moderation actions`<br>`media.test.ts: rejects non-owner publish attempts` |
| **Path Traversal & Arbitrary File Read** | `/hls/:channelId/:file` and `/vod/:streamId/:file` strictly validate channel and stream IDs against UUID format (`^[0-9a-f-]{36}$`) and allowlist filenames (`index.m3u8`, `seg_*.ts`). Verified containment using `path.resolve` boundary check. | `apps/server/src/recording/routes.ts`<br>`apps/server/src/recording/vod-service.ts` | `security.test.ts: rejects relative path traversal ../ attempts`<br>`security.test.ts: rejects URL-encoded traversal variants`<br>`security.test.ts: rejects absolute paths and non-allowlisted filenames` |
| **CORS Abuse** | `@fastify/cors` configured strictly to whitelist `WEB_ORIGIN` with credentials enabled. Disallows wildcard origins with credentials. | `apps/server/src/app.ts` | `security.test.ts: CORS headers match WEB_ORIGIN` |
| **SQL Injection** | Parameterized queries exclusively used across all operations using Drizzle ORM and Postgres driver. No raw string interpolation into SQL queries. | `apps/server/src/db/*` | Unit & integration tests throughout `@netstream/server` |
| **Credential & Secret Leakage in Git** | `.env`, `.env.*`, and `.env.local` strictly listed in `.gitignore` and verified untracked by Git. | `.gitignore` | `git status --ignored --short .env` confirms ignored status |
| **TURN Relay Abuse** | Ephemeral HMAC-SHA1 TURN credentials generated with 1-hour expiration timestamp (`/api/ice-config`). | `apps/server/src/media/routes.ts` | `turn.test.ts: generates valid 1-hour HMAC-SHA1 TURN credentials` |
| **Stream Key Exposure** | Stream keys are never stored in plaintext; SHA-256 hashed on creation (`streamKeyHash`). | `apps/server/src/auth/service.ts`<br>`apps/server/src/db/schema.ts` | `auth.test.ts: creates channel with hashed stream key` |

---

## 2. Unsafe HTML Audit

A recursive search across `apps/web/src` and `apps/server/src` for `dangerouslySetInnerHTML` and `innerHTML` was performed:

```powershell
Get-ChildItem -Path apps/web/src,apps/server/src -Recurse -Include *.ts,*.tsx,*.js,*.jsx | Select-String -Pattern "dangerouslySetInnerHTML|innerHTML"
```

**Result**: 0 matches found.
All user content, chat messages, stream metadata, and usernames are strictly rendered using React text nodes with automatic HTML escaping.

---

## 3. Dependency Security Audit (`pnpm audit`)

Audit executed against npm advisory registry:
- **Total advisories found**: 30
- **Severity Breakdown**: 2 Low, 17 Moderate, 8 High, 3 Critical
- **Findings Summary**:
  - The Critical and High advisories originate exclusively from development dependencies:
    - `vitest` / `tinypool` / `vite`: Vite custom middleware and Tinypool prototype pollution in test runner worker pools.
    - `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader` used for TypeScript execution in dev mode.
  - Runtime dependency advisory: `fastify <= 5.7.2` regarding `sendWebStream` high memory allocation. (In NetStream Live, static video segments and HLS streams are streamed using Node.js `fs.createReadStream` backpressure streams, not `sendWebStream`).
  - Production container builds strip all `devDependencies` and run only compiled JS.

---

## 4. Remaining Known Risks

1. **WebRTC Peer IP Visibility (ICE-lite)**:
   - Mediasoup functions as an ICE-lite SFU and must advertise its reachable public IP. Without forcing TURN relay (`relayOnly`), client IP addresses are exposed to the SFU during direct STUN binding requests.
2. **Docker Desktop UDP Mapping (macOS/Windows)**:
   - UDP port range forwarding in Docker Desktop on macOS and Windows uses user-space proxying, which can introduce packet jitter or packet drops under heavy media loads. For production or high-throughput demos, Linux native host networking (`network_mode: host`) or running the server natively is recommended.
