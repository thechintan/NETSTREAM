Task 27: Security pass and audit complete.
Added @fastify/helmet CSP, @fastify/cors, Argon2id params, production secret check, and WS connection caps (20/IP, 5/user).
Enforced media consumer limit (4) and validated server-side auth and path traversal protections.
Verified 0 instances of dangerouslySetInnerHTML/innerHTML in source code and recorded pnpm audit in docs/SECURITY.md.
Verified with pnpm --filter @netstream/server test src/security/security.test.ts (11 tests pass).
