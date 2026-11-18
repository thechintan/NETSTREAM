# Task 18: Go-live Notifications
- Added `apps/server/src/notifications` (`service.ts`, `handlers.ts`, `routes.ts`) with batched 500-follower keyset pagination, 10-minute Redis dedupe (`notify:live:dedupe:{channelId}`), follow notifications, and `GET /api/notifications` + `POST /api/notifications/read`.
- Added `gateway.onConnect` auto-subscribing authenticated sockets to `user:{id}` over Redis pub/sub for instant `notify.live` and `notify.follow` delivery.
- Added `NotificationBell` in Navbar with unread badge, dropdown, mark-all-read, clickable live toast, and real-time `Sidebar` Following updates.
- Verified with `src/notifications/notifications.test.ts` (4/4 pass: dedupe, offline DB-only, 1200-follower batching, follow push) and server/web typecheck.
