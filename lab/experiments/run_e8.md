# Experiment E8: Multi-Viewer SFU Server Resource Scalability

## Goal
Measure mediasoup SFU worker CPU usage, RAM footprint, and per-viewer goodput scaling as concurrent WebRTC viewers scale on a single live room.

## Condition Table to Record

| Parameter | Recommended Value / Setting | Actual Recorded |
|---|---|---|
| Concurrent Viewers | N = 3, 5, 10, 20 headless viewers | |
| Publisher Encodings | Simulcast 720p / 360p / 180p L1T3 | |
| SFU Workers | `MEDIA_WORKERS` = 1 or cpuCores - 1 | |
| Telemetry | `GET /api/debug/stats` & `GET /api/debug/media` | |

## Step-by-Step Execution

1. Start publisher in `/studio` and go live.
2. Launch automated Playwright headless viewers for each tier:
   ```bash
   pnpm exec tsx lab/experiments/viewers.ts --channel http://localhost:5173/c/streamer -n 3 -t 30 --scenario e8-n3
   pnpm exec tsx lab/experiments/viewers.ts --channel http://localhost:5173/c/streamer -n 5 -t 30 --scenario e8-n5
   pnpm exec tsx lab/experiments/viewers.ts --channel http://localhost:5173/c/streamer -n 10 -t 30 --scenario e8-n10
   ```
3. Sample `/api/debug/stats` and `/api/debug/media` during each run to observe worker PIDs and transport/consumer allocation.
