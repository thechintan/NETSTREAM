import fs from 'node:fs/promises';
import path from 'node:path';
import type { Consumer, PlainTransport } from 'mediasoup/node/lib/types.js';
import { config } from '../config/index.js';
import type { Room } from '../media/types.js';
import {
  FfmpegProcessManager,
  checkFfmpegAvailable,
  type ProcessLogger,
} from './ffmpeg-manager.js';
import { PortAllocator } from './port-allocator.js';
import { buildSdp, type SdpMediaStreamInput } from './sdp.js';
import { finalizeVodRecording, resolveSafeVodDir } from './vod-service.js';

interface ChannelHlsSession {
  channelId: string;
  outputDir: string;
  vodStreamId?: string;
  transports: PlainTransport[];
  consumers: Consumer[];
  allocatedRtpPorts: number[];
  videoConsumer?: Consumer;
  keyFrameTimer?: NodeJS.Timeout;
}

export class HlsPipelineManager {
  private readonly portAllocator = new PortAllocator(50000, 50998);
  private readonly sessions = new Map<string, ChannelHlsSession>();
  private readonly ffmpeg: FfmpegProcessManager;
  private readonly logger: ProcessLogger;
  private enabled = false;
  private initialized = false;

  constructor(logger?: ProcessLogger) {
    this.logger = logger ?? {
      debug: () => {},
      info: (msg, meta) => console.info(msg, meta ?? ''),
      warn: (msg, meta) => console.warn(msg, meta ?? ''),
      error: (msg, meta) => console.error(msg, meta ?? ''),
    };
    this.ffmpeg = new FfmpegProcessManager({ logger: this.logger });
  }

  public init(): boolean {
    if (this.initialized) return this.enabled;
    this.initialized = true;

    if (!config.HLS_ENABLED) {
      this.logger.info('HLS output is disabled via HLS_ENABLED=false');
      this.enabled = false;
      return false;
    }

    const check = checkFfmpegAvailable();
    if (!check.available) {
      this.logger.warn(
        'FFmpeg binary not found on PATH; disabling HLS output without crashing the server. Install FFmpeg to enable HLS fallback.'
      );
      this.enabled = false;
      return false;
    }

    this.logger.info(`HLS output enabled (${check.versionLine ?? 'ffmpeg detected'})`);
    this.enabled = true;
    return true;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public async startForChannel(
    channelId: string,
    room: Room,
    options?: { streamId?: string; recordVod?: boolean }
  ): Promise<boolean> {
    if (!this.initialized) {
      this.init();
    }
    if (!this.enabled) return false;

    // Tear down any stale session before starting fresh
    if (this.sessions.has(channelId)) {
      await this.stopForChannel(channelId);
    }

    const producers = Array.from(room.producers.values());
    const videoProducer = producers.find((p) => p.kind === 'video' && !p.closed);
    const audioProducer = producers.find((p) => p.kind === 'audio' && !p.closed);

    if (!videoProducer) {
      return false;
    }

    const transports: PlainTransport[] = [];
    const consumers: Consumer[] = [];
    const allocatedRtpPorts: number[] = [];
    const sdpStreams: SdpMediaStreamInput[] = [];
    let videoConsumer: Consumer | undefined;

    const outputDir = path.resolve(config.HLS_DIR, channelId);
    const vodStreamId = options?.recordVod && options?.streamId ? options.streamId : undefined;
    const vodOutputDir = vodStreamId ? resolveSafeVodDir(config.VOD_DIR, vodStreamId) ?? undefined : undefined;

    try {
      const targetProducers = [videoProducer, ...(audioProducer ? [audioProducer] : [])];

      for (const producer of targetProducers) {
        const plainTransport = await room.router.createPlainTransport({
          listenIp: { ip: '127.0.0.1' },
          rtcpMux: false,
          comedia: false,
        });
        transports.push(plainTransport);

        const pair = this.portAllocator.allocatePair();
        allocatedRtpPorts.push(pair.rtpPort);

        await plainTransport.connect({
          ip: '127.0.0.1',
          port: pair.rtpPort,
          rtcpPort: pair.rtcpPort,
        });

        const consumer = await plainTransport.consume({
          producerId: producer.id,
          rtpCapabilities: room.router.rtpCapabilities,
          paused: true,
        });
        consumers.push(consumer);

        if (consumer.kind === 'video') {
          videoConsumer = consumer;
        }

        const primaryCodec = consumer.rtpParameters.codecs[0];
        if (!primaryCodec) {
          throw new Error(`Consumer ${consumer.id} has no RTP codec`);
        }

        sdpStreams.push({
          kind: consumer.kind,
          rtpPort: pair.rtpPort,
          rtcpPort: pair.rtcpPort,
          codec: {
            mimeType: primaryCodec.mimeType,
            payloadType: primaryCodec.payloadType,
            clockRate: primaryCodec.clockRate,
            channels: primaryCodec.channels,
            parameters: primaryCodec.parameters as Record<string, string | number | boolean> | undefined,
          },
        });
      }

      await fs.mkdir(outputDir, { recursive: true });
      if (vodOutputDir) {
        await fs.mkdir(vodOutputDir, { recursive: true });
      }
      const sdpPath = path.join(outputDir, 'stream.sdp');
      const sdpContent = buildSdp(sdpStreams, `NetStream Live - ${channelId}`);
      await fs.writeFile(sdpPath, sdpContent, 'utf8');

      this.ffmpeg.start({
        channelId,
        sdpPath,
        outputDir,
        vodOutputDir,
        hasVideo: Boolean(videoProducer),
        hasAudio: Boolean(audioProducer),
        onRespawn: () => {
          if (videoConsumer && !videoConsumer.closed) {
            void videoConsumer.requestKeyFrame().catch(() => {});
          }
        },
      });

      for (const consumer of consumers) {
        await consumer.resume();
      }
      if (videoConsumer && !videoConsumer.closed) {
        await videoConsumer.requestKeyFrame();
      }

      // Send a follow-up keyframe once FFmpeg finishes probing SDP
      const keyFrameTimer = setTimeout(() => {
        if (videoConsumer && !videoConsumer.closed) {
          void videoConsumer.requestKeyFrame().catch(() => {});
        }
      }, 1000);
      keyFrameTimer.unref?.();

      this.sessions.set(channelId, {
        channelId,
        outputDir,
        vodStreamId,
        transports,
        consumers,
        allocatedRtpPorts,
        videoConsumer,
        keyFrameTimer,
      });

      return true;
    } catch (err) {
      this.logger.warn(`Failed to start HLS pipeline for channel ${channelId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      for (const c of consumers) {
        try {
          c.close();
        } catch {
          // ignore
        }
      }
      for (const t of transports) {
        try {
          t.close();
        } catch {
          // ignore
        }
      }
      for (const port of allocatedRtpPorts) {
        this.portAllocator.releasePair(port);
      }
      return false;
    }
  }

  public async stopForChannel(channelId: string): Promise<void> {
    await this.ffmpeg.stop(channelId);

    const session = this.sessions.get(channelId);
    const vodStreamId = session?.vodStreamId;

    if (session) {
      if (session.keyFrameTimer) {
        clearTimeout(session.keyFrameTimer);
      }
      for (const c of session.consumers) {
        try {
          c.close();
        } catch {
          // ignore
        }
      }
      for (const t of session.transports) {
        try {
          t.close();
        } catch {
          // ignore
        }
      }
      for (const port of session.allocatedRtpPorts) {
        this.portAllocator.releasePair(port);
      }
      this.sessions.delete(channelId);
    }

    // Finalize VOD recording (measure duration with ffprobe, discard < 10s, else insert vods row)
    if (vodStreamId) {
      try {
        await finalizeVodRecording({
          streamId: vodStreamId,
          channelId,
        });
      } catch {
        // ignore VOD finalization errors so stream teardown completes cleanly
      }
    }

    // Remove the channel's live HLS directory after stream ends (VOD keeps its own copy in VOD_DIR)
    const outputDir = path.resolve(config.HLS_DIR, channelId);
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  public async shutdown(): Promise<void> {
    const channelIds = [...this.sessions.keys()];
    this.ffmpeg.stopAll();
    await Promise.all(channelIds.map((id) => this.stopForChannel(id)));
  }
}

let singleton: HlsPipelineManager | null = null;

export function getHlsPipelineManager(): HlsPipelineManager {
  if (!singleton) {
    singleton = new HlsPipelineManager();
  }
  return singleton;
}
