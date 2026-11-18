# Experiment E5: UDP vs. TCP Transport for WebRTC Under Packet Loss

## Goal
Compare WebRTC media resilience when running over native UDP versus TCP-only ICE (`MEDIA_FORCE_TCP=true`) under 1% to 10% packet loss.

## Condition Table to Record

| Parameter | Recommended Value / Setting | Actual Recorded |
|---|---|---|
| Server Flag | `MEDIA_FORCE_TCP=false` (UDP+TCP) vs `MEDIA_FORCE_TCP=true` (TCP only) | |
| Loss Profiles | `loss-0`, `loss-3`, `loss-5`, `loss-10` | |
| Metrics | Freeze count, total freeze duration, packet loss %, RTT | |
| Viewers | N=3 concurrent viewers per condition | |

## Step-by-Step Execution

1. **UDP baseline**:
   ```bash
   pnpm dev
   pnpm exec tsx lab/experiments/viewers.ts --channel http://localhost:5173/c/streamer -n 3 -t 30 --scenario e5-udp-loss5 --auto-publish
   ```
2. **TCP-only ICE**:
   Set `MEDIA_FORCE_TCP=true` in `.env` or prefix command:
   ```bash
   MEDIA_FORCE_TCP=true pnpm dev
   pnpm exec tsx lab/experiments/viewers.ts --channel http://localhost:5173/c/streamer -n 3 -t 30 --scenario e5-tcp-loss5 --auto-publish
   ```
3. **Verify candidate type**: The stats overlay candidate row reports `host / tcp` (or `relay / tcp`) instead of `host / udp`. Notice head-of-line blocking on TCP under loss manifests as increased freeze count.
