# Task 12: Broadcaster signaling and the Studio page
- Built server media signaling (`media.join`, `media.createTransport`, `media.connectTransport`, `media.produce`, cleanup hook) in `apps/server/src/media/handlers.ts`.
- Replaced `media.*` schemas in `packages/shared/src/protocol.ts` and pinned `mediasoup-client@3.7.18` in `apps/web`.
- Implemented `usePublisher` hook (`apps/web/src/features/studio/usePublisher.ts`) and full Studio page UI with preview video, device selectors, screen sharing, and Go Live controls (`apps/web/src/pages/Studio.tsx`).
- Decision: Enforced single publisher per room via `room.publisher`, connection-level transport cap of 2, and max one audio/video producer.
- Verification: Ran unit & integration tests (`pnpm --filter @netstream/server exec vitest run src/media/signaling.mock.test.ts src/media/signaling.integration.test.ts`).
