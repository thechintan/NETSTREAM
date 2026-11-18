# Experiment E6: Glass-to-Glass Delivery Latency (WebRTC vs. HLS)

## Goal
Measure exact glass-to-glass (camera capture to display) delivery latency comparing sub-second WebRTC against HLS segmented streaming using the burned-in millisecond wall-clock canvas.

## Condition Table to Record

| Parameter | Recommended Value / Setting | Actual Recorded |
|---|---|---|
| Stream Resolution | 1280x720 @ 30 fps | |
| Publisher Mode | Creator Studio **Latency Test Mode** (canvas running clock) | |
| Viewer Clock | VideoPlayer **Clock** button enabled | |
| Clock Resolution | Milliseconds (`HH:MM:SS.mmm` + `epoch_ms`) | |
| Repetitions | 5 screenshots / video frame freeze comparisons each | |

## Step-by-Step Execution

1. Open `/studio` and click **Latency Test Mode** (the video monitor burns a huge running clock onto the feed). Click **Go Live**.
2. Open `/c/<streamer>` in a separate window or device side-by-side with the studio.
3. Click the **Clock** button in the player controls (displays the viewer's local millisecond clock).
4. **Measuring WebRTC Glass-to-Glass Latency**:
   - Take a screenshot (or high-speed photo / screen recording) capturing both the sender canvas and the viewer video.
   - Latency = `Viewer Epoch Ms` - `Sender Epoch Ms burned in frame`.
   - Observed: typically 300–800 ms.
5. **Measuring HLS Glass-to-Glass Latency**:
   - In the viewer quality menu, select **Compatibility mode (HLS)**.
   - Take a screenshot capturing both clocks.
   - Latency = `Viewer Epoch Ms` - `Sender Epoch Ms burned in frame`.
   - Observed: typically 6,000–10,000 ms (6–10 seconds).
6. Save readings to `lab/results/latency_results.csv` and generate plots with `python lab/analysis/plot.py`.
