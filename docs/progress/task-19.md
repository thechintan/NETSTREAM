# Task 19: Discovery
- Added migration `0001_trgm_discovery.sql` enabling `pg_trgm` and GIN trigram indexes on `channels.name`, `channels.title`, and `categories.name`; ran `pnpm db:migrate`.
- Implemented `GET /api/search?q=` (live channels first, then `pg_trgm` similarity) and `GET /api/categories/:id/live`, plus viewer-count sorting and category live counts.
- Added debounced keyboard-navigable Navbar search, `/categories` grid page, `/categories/:id` live page, Studio inline title/category editor (Go Live disabled until title exists), and Home Following tab.
- Verified with `src/channels/discovery.test.ts` (3/3 pass against Postgres `pg_trgm`) and server/web typecheck.
