import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export interface ProcessLogger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const defaultLogger: ProcessLogger = {
  debug: () => {
    // quiet by default unless a structured logger is attached
  },
  info: (msg, meta) => console.info(msg, meta ?? ''),
  warn: (msg, meta) => console.warn(msg, meta ?? ''),
  error: (msg, meta) => console.error(msg, meta ?? ''),
};

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: { stdio?: ['ignore', 'pipe', 'pipe'] }
) => ChildProcess;

export interface StartFfmpegOptions {
  channelId: string;
  sdpPath: string;
  outputDir: string;
  vodOutputDir?: string;
  hasVideo: boolean;
  hasAudio: boolean;
  onRespawn?: () => void;
}

interface ManagedProcess {
  options: StartFfmpegOptions;
  child: ChildProcess;
  restarts: number;
  stopping: boolean;
  killTimer: NodeJS.Timeout | null;
}

/**
 * Checks whether the `ffmpeg` binary is installed and executable on PATH.
 */
export function checkFfmpegAvailable(ffmpegBinary = 'ffmpeg'): {
  available: boolean;
  versionLine?: string;
} {
  try {
    const res = spawnSync(ffmpegBinary, ['-version'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (res.error || res.status !== 0) {
      return { available: false };
    }
    const firstLine = (res.stdout || '').split(/\r?\n/)[0]?.trim();
    return { available: true, versionLine: firstLine };
  } catch {
    return { available: false };
  }
}

export function buildHlsFfmpegArgs(options: {
  sdpPath: string;
  outputDir: string;
  vodOutputDir?: string;
  hasVideo: boolean;
  hasAudio: boolean;
}): string[] {
  const args: string[] = [
    '-loglevel',
    'warning',
    '-protocol_whitelist',
    'file,udp,rtp',
    '-fflags',
    '+genpts',
    '-i',
    options.sdpPath,
  ];

  const appendEncodeAndHls = (
    targetDir: string,
    mode: 'live' | 'vod'
  ) => {
    if (options.hasVideo) {
      args.push(
        '-map',
        '0:v:0',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-tune',
        'zerolatency',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '60',
        '-keyint_min',
        '60',
        '-sc_threshold',
        '0'
      );
    }

    if (options.hasAudio) {
      args.push('-map', '0:a:0', '-c:a', 'aac', '-ar', '48000', '-b:a', '128k');
    }

    const segmentPattern = path.join(targetDir, 'seg_%05d.ts');
    const playlistPath = path.join(targetDir, 'index.m3u8');

    if (mode === 'live') {
      args.push(
        '-f',
        'hls',
        '-hls_time',
        '2',
        '-hls_list_size',
        '6',
        '-hls_flags',
        'delete_segments+append_list+independent_segments',
        '-hls_segment_filename',
        segmentPattern,
        playlistPath
      );
    } else {
      args.push(
        '-f',
        'hls',
        '-hls_time',
        '2',
        '-hls_list_size',
        '0',
        '-hls_playlist_type',
        'event',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_filename',
        segmentPattern,
        playlistPath
      );
    }
  };

  appendEncodeAndHls(options.outputDir, 'live');
  if (options.vodOutputDir) {
    appendEncodeAndHls(options.vodOutputDir, 'vod');
  }

  return args;
}

/**
 * Manages FFmpeg child processes per channel:
 * - Captures stderr at debug level
 * - Automatically restarts up to maxRestarts (default 3) on unexpected exit
 * - Cleanly terminates individual channels or all leftover processes on shutdown
 */
export class FfmpegProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly spawnFn: SpawnFn;
  private readonly ffmpegBinary: string;
  private readonly maxRestarts: number;
  private readonly logger: ProcessLogger;
  private readonly killGraceMs: number;

  constructor(opts?: {
    spawnFn?: SpawnFn;
    ffmpegBinary?: string;
    maxRestarts?: number;
    logger?: ProcessLogger;
    killGraceMs?: number;
  }) {
    this.spawnFn = opts?.spawnFn ?? ((cmd, args, o) => spawn(cmd, args, o ?? {}));
    this.ffmpegBinary = opts?.ffmpegBinary ?? 'ffmpeg';
    this.maxRestarts = opts?.maxRestarts ?? 3;
    this.logger = opts?.logger ?? defaultLogger;
    this.killGraceMs = opts?.killGraceMs ?? 2000;
  }

  public start(options: StartFfmpegOptions): void {
    if (this.processes.has(options.channelId)) {
      this.stop(options.channelId);
    }
    this.spawnForChannel(options, 0);
  }

  private spawnForChannel(options: StartFfmpegOptions, restarts: number): void {
    const args = buildHlsFfmpegArgs(options);
    const child = this.spawnFn(this.ffmpegBinary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const entry: ManagedProcess = {
      options,
      child,
      restarts,
      stopping: false,
      killTimer: null,
    };

    this.processes.set(options.channelId, entry);

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer | string) => {
        const line = chunk.toString().trim();
        if (line) {
          this.logger.debug(`[ffmpeg:${options.channelId}] ${line}`);
        }
      });
    }

    child.on('error', (err) => {
      this.logger.warn(`[ffmpeg:${options.channelId}] process error`, {
        error: err.message,
      });
    });

    child.on('exit', (code, signal) => {
      if (entry.killTimer) {
        clearTimeout(entry.killTimer);
        entry.killTimer = null;
      }

      // Only handle if this entry is still the active one for channelId
      const current = this.processes.get(options.channelId);
      if (current !== entry) return;

      if (entry.stopping) {
        this.processes.delete(options.channelId);
        return;
      }

      // Unexpected exit: restart up to maxRestarts
      if (entry.restarts < this.maxRestarts) {
        const nextAttempt = entry.restarts + 1;
        this.logger.warn(
          `[ffmpeg:${options.channelId}] exited unexpectedly (code=${code}, signal=${signal}); restarting (${nextAttempt}/${this.maxRestarts})`
        );
        this.spawnForChannel(options, nextAttempt);
        try {
          options.onRespawn?.();
        } catch {
          // ignore callback errors
        }
      } else {
        this.logger.error(
          `[ffmpeg:${options.channelId}] exceeded max restarts (${this.maxRestarts}); disabling HLS for channel`
        );
        this.processes.delete(options.channelId);
      }
    });
  }

  public stop(channelId: string): Promise<void> {
    const entry = this.processes.get(channelId);
    if (!entry) return Promise.resolve();

    entry.stopping = true;
    this.processes.delete(channelId);

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        if (entry.killTimer) {
          clearTimeout(entry.killTimer);
          entry.killTimer = null;
        }
        resolve();
      };

      entry.child.once('exit', done);

      try {
        entry.child.kill('SIGTERM');
        entry.killTimer = setTimeout(() => {
          try {
            if (!entry.child.killed) {
              entry.child.kill('SIGKILL');
            }
          } catch {
            // ignore
          }
          done();
        }, this.killGraceMs);
        entry.killTimer.unref?.();
      } catch {
        done();
      }
    });
  }

  public stopAll(): void {
    for (const channelId of [...this.processes.keys()]) {
      void this.stop(channelId);
    }
  }

  public isRunning(channelId: string): boolean {
    return this.processes.has(channelId);
  }

  public getRestartCount(channelId: string): number {
    return this.processes.get(channelId)?.restarts ?? 0;
  }

  public activeCount(): number {
    return this.processes.size;
  }
}
