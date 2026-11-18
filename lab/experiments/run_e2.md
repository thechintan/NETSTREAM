# Experiment E2: Video Quality & Bitrate Under Packet Loss

## Goal
Measure how WebRTC video bitrate, packet loss percentage, jitter, freeze count, and NACK/PLI recovery adapt as network packet loss increases from 0% to 10%, comparing WebRTC's resilience to TCP file transfer goodput degradation.

## Condition Table to Record

| Parameter | Recommended Value / Setting | Actual Recorded |
|---|---|---|
| Machine Model | e.g. HP Laptop / Desktop x64 | |
| OS & Kernel | Windows 11 / Ubuntu 22.04 | |
| Network Interface | `eth0` / `wlan0` / `lo` | |
| Server Location | Localhost / LAN Server | |
| Impairment Profiles | `loss-0`, `loss-1`, `loss-3`, `loss-5`, `loss-10` | |
| Video Source & Codec | Camera / Fake device, VP8 / H.264 | |
| Target Resolution | 720p @ 30 fps | |
| Test Duration | 30 seconds per run | |
| Repetitions | 3 runs per profile | |

## Step-by-Step Execution

1. **Start the NetStream stack**:
   ```bash
   pnpm dev
   ```
2. **Apply impairment profile** (or use Clumsy on Windows / Network Link Conditioner on macOS):
   ```bash
   # Linux (dry run first, then confirm):
   bash lab/experiments/netem.sh --iface eth0 --profile loss-1 --dry-run
   sudo bash lab/experiments/netem.sh --iface eth0 --profile loss-1 --confirm
   ```
3. **Run automated Playwright multi-viewer runner**:
   ```bash
   pnpm exec tsx lab/experiments/viewers.ts --channel http://localhost:5173/c/streamer -n 3 -t 30 --scenario loss-1 --output lab/results/viewers_loss1.csv --auto-publish
   ```
4. **Repeat for each profile**: `loss-0`, `loss-1`, `loss-3`, `loss-5`, `loss-10`.
5. **Clear network impairment**:
   ```bash
   sudo bash lab/experiments/netem.sh --iface eth0 --clear --confirm
   ```
6. **Expected CSV Outputs**:
   - `lab/results/viewers_loss*.csv` with columns:
     `timestamp_iso,scenario,viewer_id,elapsed_s,bitrate_kbps,fps,width,height,packets_lost,loss_pct,jitter_ms,freeze_count,nack_count,pli_count,rtt_ms,candidate_type,protocol,layer`
