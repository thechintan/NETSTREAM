import { redis } from '../lib/redis.js';
import { WebSocketGateway } from '../realtime/gateway.js';
import { getViewerCount, updatePeak } from './service.js';

export interface PresenceWorkerOptions {
  intervalMs?: number;
  maxAgeMs?: number;
}

export class PresenceWorker {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly maxAgeMs: number;
  private readonly gateway: WebSocketGateway;
  private readonly trackedChannels = new Set<string>();

  constructor(gateway: WebSocketGateway, options: PresenceWorkerOptions = {}) {
    this.gateway = gateway;
    this.intervalMs = options.intervalMs ?? 5000;
    this.maxAgeMs = options.maxAgeMs ?? 60000;
  }

  /**
   * Explicitly track a channel for presence aggregation.
   */
  public trackChannel(channelId: string): void {
    this.trackedChannels.add(channelId);
  }

  /**
   * Untrack a channel if needed.
   */
  public untrackChannel(channelId: string): void {
    this.trackedChannels.delete(channelId);
  }

  /**
   * Starts the periodic 5-second aggregation timer.
   */
  public start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    this.timer.unref();
  }

  /**
   * Runs a single aggregation tick across all channels with local viewers or tracked channels.
   */
  public async tick(): Promise<void> {
    // Gather all channels with active local viewers or explicitly tracked
    const channelsToProcess = new Set<string>(this.trackedChannels);

    for (const [room, members] of this.gateway.rooms.entries()) {
      if (room.startsWith('chat:') && members && members.size > 0) {
        const channelId = room.slice(5);
        if (channelId) {
          channelsToProcess.add(channelId);
        }
      }
    }

    // For each channel: prune stale older than 60s, get ZCARD, update peak, publish coalesced
    for (const channelId of channelsToProcess) {
      try {
        const count = await getViewerCount(channelId, this.maxAgeMs);
        await updatePeak(channelId, count);

        const pushPayload = JSON.stringify({
          t: 'viewers.count',
          d: { channelId, count },
        });

        // Publish to channel's chat room and to global directory
        await redis.publish(`chat:${channelId}`, pushPayload);
        await redis.publish('directory:live', pushPayload);

        // If no local members and count is 0, remove from tracked channels to prevent memory growth
        const localMembers = this.gateway.rooms.get(`chat:${channelId}`);
        if ((!localMembers || localMembers.size === 0) && count === 0) {
          this.trackedChannels.delete(channelId);
        }
      } catch {
        // Ignore errors during periodic tick
      }
    }
  }

  /**
   * Stops the worker timer.
   */
  public async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

let defaultWorker: PresenceWorker | null = null;

export function initPresenceWorker(
  gateway: WebSocketGateway,
  options?: PresenceWorkerOptions
): PresenceWorker {
  if (!defaultWorker) {
    defaultWorker = new PresenceWorker(gateway, options);
    defaultWorker.start();
  }
  return defaultWorker;
}

export function getPresenceWorker(): PresenceWorker | null {
  return defaultWorker;
}
