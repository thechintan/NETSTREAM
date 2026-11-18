# Task 17: Live Network Statistics Overlay
- Built `apps/web/src/features/lab` (`stats-calculator.ts`, `Sparkline.tsx`, `StatsOverlay.tsx`, `StudioStatsOverlay.tsx`) polling `getStats()` every 1s with graceful `-` fallbacks.
- Viewer `StatsOverlay` (button + `S` key) shows video/audio bitrate, fps, res, interval loss %, jitter, freezes, NACK/PLI, JB delay/frame, concealment, RTT, candidate/protocol, layer, 60s SVG sparklines, and CSV recorder.
- Studio `StudioStatsOverlay` (button + `S` key) shows outbound-rtp bitrate per `rid`, `qualityLimitationReason`, retransmitted packets, and `availableOutgoingBitrate`.
- Verified with `pnpm exec vitest run apps/web/src/features/lab/stats-calculator.test.ts` (4/4 pass) and `pnpm --filter @netstream/web run typecheck` (0 errors).
