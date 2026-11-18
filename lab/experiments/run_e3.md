# Experiment E3: Simulcast Layer Adaptation Under Dynamic Bandwidth

## Goal
Observe mediasoup SFU dynamic spatial layer switching (S2 720p -> S1 360p -> S0 180p -> S2 recovery) as available bandwidth is throttled using `tc netem rate` or Clumsy throttle.

## Condition Table to Record

| Parameter | Recommended Value / Setting | Actual Recorded |
|---|---|---|
| Video Source | Web camera (simulcast encodings r0/r1/r2, L1T3) | |
| Publisher Bitrates | r0=150k, r1=600k, r2=2500k | |
| Rate Cap Sequence | 5 Mbps (10s) -> 1 Mbps (10s) -> 300 kbps (10s) -> 5 Mbps (10s) | |
| Profile Names | `rate-5mbit`, `rate-1mbit`, `rate-300kbit` | |
| Total Duration | 40 seconds | |

## Step-by-Step Execution

1. Start publisher in `/studio` with camera and click **Go Live**.
2. Start viewer in a second browser window at `/c/<streamer>` and press `S` to toggle Network Stats overlay.
3. Apply rate caps consecutively:
   ```bash
   # t=0s: baseline
   sudo bash lab/experiments/netem.sh --iface eth0 --profile rate-5mbit --confirm
   # t=10s: throttle to 1 Mbps
   sudo bash lab/experiments/netem.sh --iface eth0 --profile rate-1mbit --confirm
   # t=20s: throttle to 300 kbps
   sudo bash lab/experiments/netem.sh --iface eth0 --profile rate-300kbit --confirm
   # t=30s: restore to 5 Mbps
   sudo bash lab/experiments/netem.sh --iface eth0 --profile rate-5mbit --confirm
   ```
4. Click **Stop** in the Recorder panel on the stats overlay and download the CSV.
5. Save output to `lab/results/viewers_e3_simulcast.csv`.
