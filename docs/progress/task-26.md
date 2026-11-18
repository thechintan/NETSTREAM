# Task 26: Automated Experiment Tooling
- Built `lab/experiments/netem.sh` + `netem.py` supporting all 10 profiles, `--clear`, `--dry-run`, and Windows Clumsy / macOS Link Conditioner guidance.
- Created `lab/experiments/viewers.ts` (Playwright headless Chromium with fake media devices, sampling `window.__stats` every 1s, with `--auto-publish`) and `chat_load.ts` (100–2000 WebSocket clients measuring p50/p95/p99 latency, loss %, and `/api/debug/stats` telemetry).
- Implemented Studio **Latency Test Mode** (canvas millisecond wall-clock stream) and matching VideoPlayer Clock display for E6 glass-to-glass delay measurement.
- Added `MEDIA_FORCE_TCP=true` server flag for E5, step-by-step guides `run_e2.md` through `run_e8.md`, and `lab/analysis/plot.py` producing all 7 titled PNG graphs from sample and live CSVs.
