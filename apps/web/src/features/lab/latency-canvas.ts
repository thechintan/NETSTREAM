/**
 * Studio Latency Test Mode (Experiment E6):
 * Draws the live camera/screen frame onto an offscreen canvas with a large,
 * high-contrast running millisecond wall-clock timestamp burned in, and returns
 * a MediaStream captured from that canvas (preserving original audio tracks).
 */

export interface LatencyClockStreamHandle {
  stream: MediaStream;
  stop: () => void;
}

export function formatWallClockMs(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function createLatencyClockStream(
  sourceStream: MediaStream,
  options?: { width?: number; height?: number; fps?: number }
): LatencyClockStreamHandle {
  const width = options?.width ?? 1280;
  const height = options?.height ?? 720;
  const fps = options?.fps ?? 30;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const sourceVideo = document.createElement('video');
  sourceVideo.srcObject = sourceStream;
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;
  void sourceVideo.play().catch(() => {});

  let stopped = false;
  let frameCount = 0;

  const drawFrame = () => {
    if (stopped || !ctx) return;

    // 1. Draw camera/screen video frame (or dark backdrop while initializing)
    if (sourceVideo.readyState >= 2 && sourceVideo.videoWidth > 0) {
      ctx.drawImage(sourceVideo, 0, 0, width, height);
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Burn high-contrast millisecond wall-clock banner for glass-to-glass measurement
    const nowMs = Date.now();
    const clockText = formatWallClockMs(nowMs);
    frameCount += 1;

    const boxW = Math.min(width - 80, 860);
    const boxH = 210;
    const boxX = Math.floor((width - boxW) / 2);
    const boxY = Math.floor((height - boxH) / 2);

    ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SENDER CLOCK (LATENCY TEST MODE · E6)', width / 2, boxY + 42);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 92px monospace';
    ctx.fillText(clockText, width / 2, boxY + 136);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`epoch_ms=${nowMs}  frame=${frameCount}`, width / 2, boxY + 184);
  };

  drawFrame();
  const intervalMs = Math.max(16, Math.round(1000 / fps));
  const timerId = window.setInterval(drawFrame, intervalMs);

  const canvasStream = canvas.captureStream(fps);
  // Preserve existing microphone / screen audio tracks
  for (const audioTrack of sourceStream.getAudioTracks()) {
    canvasStream.addTrack(audioTrack);
  }

  return {
    stream: canvasStream,
    stop: () => {
      stopped = true;
      window.clearInterval(timerId);
      canvasStream.getVideoTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      sourceVideo.srcObject = null;
    },
  };
}
