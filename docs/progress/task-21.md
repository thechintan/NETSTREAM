# Task 21: STUN and TURN
- Added `infra/coturn.conf` (`use-auth-secret`, ports 3478 UDP/TCP + 5349 TLS, relay 49152-49252, `no-cli`, `fingerprint`, `no-multicast-peers`, private peer denials with documented SFU `allowed-peer-ip` exception) and `coturn` service in `infra/docker-compose.yml`.
- Built `apps/server/src/media/ice-config.ts` and `GET /api/ice-config` (authenticated users or guest ticket holders) returning STUN/TURN URLs and 1-hour HMAC-SHA1 credentials (`expiry:userId`).
- Updated `usePublisher.ts` and `useViewer.ts` to fetch `iceServers` before creating transports and added a dev-only `Force TURN relay` (`iceTransportPolicy: 'relay'`) toggle in `StatsOverlay.tsx` and `StudioStatsOverlay.tsx`.
- Verified with `src/media/ice-config.test.ts` (4/4 pass) and server/web typecheck; documented TURN vs mediasoup TCP scenarios and relay verification in `docs/PROGRESS.md`.
