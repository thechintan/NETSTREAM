# Experiment E7: WebSocket Chat Broadcast Scalability & Delivery Latency

## Goal
Evaluate real-time WebSocket chat broadcast latency (p50, p95, p99) and server CPU/memory utilization under scaling concurrent connection counts ($N = 100, 250, 500, 1000$).

## Condition Table to Record

| Parameter | Recommended Value / Setting | Actual Recorded |
|---|---|---|
| Concurrent Sockets $N$ | 100, 250, 500, 1000 clients | |
| Messages per run | 20 messages @ 5 Hz (200 ms interval) | |
| Pub/Sub Backing | Redis pub/sub channel `chat:{channelId}` | |
| Telemetry Endpoint | `GET /api/debug/stats` (CPU %, RSS MB, Heap MB) | |

## Step-by-Step Execution

1. Start NetStream server with Redis and Postgres running:
   ```bash
   pnpm dev
   ```
2. Run the chat load tool across client tiers:
   ```bash
   pnpm exec tsx lab/experiments/chat_load.ts -n 100 -m 20 --interval-ms 200
   pnpm exec tsx lab/experiments/chat_load.ts -n 250 -m 20 --interval-ms 200
   pnpm exec tsx lab/experiments/chat_load.ts -n 500 -m 20 --interval-ms 200
   pnpm exec tsx lab/experiments/chat_load.ts -n 1000 -m 20 --interval-ms 200
   ```
3. Outputs are appended to `lab/results/chat_load_results.csv`.
4. Plot with `python lab/analysis/plot.py` to view latency percentiles vs. $N$.
