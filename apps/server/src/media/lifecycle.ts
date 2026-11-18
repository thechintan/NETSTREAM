import { and, desc, eq, isNull } from 'drizzle-orm';
import { channels, db, streams, users, categories } from '../db/index.js';
import { notifyFollowersChannelLive } from '../notifications/service.js';
import { getPeak, resetPeak } from '../presence/service.js';
import { publishStreamLive, publishStreamOffline } from '../presence/handlers.js';
import { getHlsPipelineManager } from '../recording/hls-pipeline.js';
import type { WebSocketGateway } from '../realtime/gateway.js';
import { getRoomManager } from './index.js';

export type StreamState = 'OFFLINE' | 'STARTING' | 'LIVE' | 'ENDING';

export interface ChannelStreamLifecycle {
  state: StreamState;
  publisherUserId: string;
  publisherConnId: string;
  streamId?: string;
  graceTimer: NodeJS.Timeout | null;
}

const channelLifecycles = new Map<string, ChannelStreamLifecycle>();

/**
 * Returns the current stream state for a channel.
 */
export function getStreamState(channelId: string): StreamState {
  return channelLifecycles.get(channelId)?.state ?? 'OFFLINE';
}

/**
 * Checks whether a connecting publisher is allowed to reconnect
 * within their active grace period.
 */
export function canPublisherReconnect(channelId: string, userId: string): boolean {
  const lifecycle = channelLifecycles.get(channelId);
  if (!lifecycle) return false;
  return lifecycle.publisherUserId === userId && lifecycle.graceTimer !== null;
}

/**
 * Initiates a publisher session for a channel.
 * Enforces single stream per channel.
 */
export function startPublisherSession(
  channelId: string,
  userId: string,
  connId: string
): { reconnected: boolean } {
  const existing = channelLifecycles.get(channelId);

  if (existing) {
    if (existing.publisherConnId === connId) {
      // Idempotent re-join on the same connection
      if (existing.graceTimer !== null) {
        clearTimeout(existing.graceTimer);
        existing.graceTimer = null;
      }
      return { reconnected: existing.state === 'LIVE' };
    }

    if (existing.graceTimer !== null && existing.publisherUserId === userId) {
      // Reconnecting within grace period
      clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
      existing.publisherConnId = connId;
      return { reconnected: true };
    }

    if (existing.state === 'STARTING' || existing.state === 'LIVE') {
      throw new Error('STREAM_ALREADY_LIVE');
    }
  }

  channelLifecycles.set(channelId, {
    state: 'STARTING',
    publisherUserId: userId,
    publisherConnId: connId,
    graceTimer: null,
  });

  return { reconnected: false };
}

/**
 * Called when the first video producer is created.
 * Transitions channel to LIVE, updates DB, inserts a streams row,
 * and notifies global directory and followers.
 */
export async function onVideoProducerCreated(
  channelId: string,
  connId: string
): Promise<void> {
  const lifecycle = channelLifecycles.get(channelId);
  if (!lifecycle) return;

  // If already live (e.g. publisher reconnected and re-created video producer), resume LIVE state
  if (lifecycle.state === 'LIVE') {
    if (lifecycle.graceTimer) {
      clearTimeout(lifecycle.graceTimer);
      lifecycle.graceTimer = null;
    }
    lifecycle.publisherConnId = connId;
    try {
      const room = getRoomManager().get(channelId);
      if (room) {
        void getHlsPipelineManager().startForChannel(channelId, room);
      }
    } catch {
      // ignore if room manager unavailable in unit tests
    }
    return;
  }

  lifecycle.state = 'LIVE';
  lifecycle.publisherConnId = connId;

  // 1. Fetch channel metadata
  const [channelData] = await db
    .select({
      id: channels.id,
      name: channels.name,
      title: channels.title,
      ownerId: channels.ownerId,
      recordVod: channels.recordVod,
      ownerUsername: users.username,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryThumbnailUrl: categories.thumbnailUrl,
    })
    .from(channels)
    .innerJoin(users, eq(channels.ownerId, users.id))
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .where(eq(channels.id, channelId));

  if (!channelData) return;

  // 2. Mark channel is_live = true in DB
  await db.update(channels).set({ isLive: true }).where(eq(channels.id, channelId));

  // 3. Insert active stream row
  const [newStream] = await db
    .insert(streams)
    .values({
      channelId,
      title: channelData.title,
      startedAt: new Date(),
    })
    .returning({ id: streams.id });

  if (newStream) {
    lifecycle.streamId = newStream.id;
  }

  // 4. Reset presence peak for this fresh stream
  await resetPeak(channelId);

  // 5. Publish stream.live to global directory
  const livePayload = {
    channelId,
    channelName: channelData.name,
    title: channelData.title,
    category: channelData.categoryId
      ? {
          id: channelData.categoryId,
          name: channelData.categoryName!,
          thumbnailUrl: channelData.categoryThumbnailUrl,
        }
      : null,
    ownerUsername: channelData.ownerUsername,
    viewerCount: 0,
  };

  await publishStreamLive(livePayload);

  // 6. Notify followers in batches of 500 (persists DB rows + pushes notify.live with 10m dedupe)
  try {
    await notifyFollowersChannelLive({
      channelId,
      channelName: channelData.name,
      title: channelData.title,
      category: channelData.categoryName ?? null,
      ownerUsername: channelData.ownerUsername,
    });
  } catch {
    // Non-fatal if follower notification fails
  }

  // 7. Start HLS transcoding (and VOD recording if channel.recordVod is enabled)
  try {
    const room = getRoomManager().get(channelId);
    if (room) {
      void getHlsPipelineManager().startForChannel(channelId, room, {
        streamId: lifecycle.streamId,
        recordVod: channelData.recordVod,
      });
    }
  } catch {
    // Non-fatal if room manager or FFmpeg unavailable
  }
}

/**
 * Handles publisher disconnect or transport failure.
 * Starts a 15-second grace timer and alerts viewers to 'streamer reconnecting'.
 */
export async function onPublisherDisconnected(
  channelId: string,
  connId: string,
  gateway: WebSocketGateway
): Promise<void> {
  const lifecycle = channelLifecycles.get(channelId);
  if (!lifecycle || lifecycle.publisherConnId !== connId) {
    return;
  }

  if (lifecycle.state === 'STARTING') {
    // Never produced video; terminate immediately
    await endStream(channelId, gateway, 'starting_cancelled');
    return;
  }

  if (lifecycle.state === 'LIVE') {
    // Notify viewers that streamer is reconnecting
    gateway.broadcastToRoom(`media:${channelId}`, 'stream.reconnecting', {
      channelId,
    });

    if (lifecycle.graceTimer) {
      clearTimeout(lifecycle.graceTimer);
    }

    lifecycle.graceTimer = setTimeout(async () => {
      await endStream(channelId, gateway, 'grace_expired');
    }, 15000);
  }
}

/**
 * Ends a stream: closes room & consumers, updates DB (is_live = false, ended_at, peak_viewers),
 * broadcasts stream.offline, and resets peak presence.
 */
export async function endStream(
  channelId: string,
  gateway: WebSocketGateway,
  _reason?: string
): Promise<void> {
  const lifecycle = channelLifecycles.get(channelId);

  if (lifecycle) {
    if (lifecycle.graceTimer) {
      clearTimeout(lifecycle.graceTimer);
      lifecycle.graceTimer = null;
    }
    lifecycle.state = 'ENDING';
  }

  // 0. Stop HLS FFmpeg pipeline and remove channel HLS directory
  try {
    await getHlsPipelineManager().stopForChannel(channelId);
  } catch {
    // ignore
  }

  // 1. Close media room, router, transports, consumers
  try {
    const roomManager = getRoomManager();
    roomManager.close(channelId);
  } catch {
    // ignore
  }

  // 2. Broadcast consumerClosed to media room
  gateway.broadcastToRoom(`media:${channelId}`, 'media.consumerClosed', {});

  // 3. Record peak viewers and set channels.is_live = false
  const peakViewers = await getPeak(channelId);

  await db.update(channels).set({ isLive: false }).where(eq(channels.id, channelId));

  // 4. Close any open streams row in DB
  await db
    .update(streams)
    .set({
      endedAt: new Date(),
      peakViewers,
    })
    .where(
      and(
        eq(streams.channelId, channelId),
        isNull(streams.endedAt)
      )
    );

  // 5. Publish stream.offline to global live directory
  await publishStreamOffline({ channelId });

  // 6. Reset peak viewers
  await resetPeak(channelId);

  // 7. Cleanup in-memory lifecycle entry
  channelLifecycles.delete(channelId);
}

/**
 * Crash recovery on server boot:
 * Sets all channels is_live = false and marks any open streams as ended.
 */
export async function recoverCrashedStreamsOnBoot(): Promise<void> {
  await db.update(channels).set({ isLive: false });
  await db.update(streams).set({ endedAt: new Date() }).where(isNull(streams.endedAt));
  channelLifecycles.clear();
}

/**
 * Resets lifecycle map (primarily for unit test isolation).
 */
export function resetLifecycleForTest(channelId?: string): void {
  if (channelId) {
    const l = channelLifecycles.get(channelId);
    if (l?.graceTimer) clearTimeout(l.graceTimer);
    channelLifecycles.delete(channelId);
  } else {
    for (const l of channelLifecycles.values()) {
      if (l.graceTimer) clearTimeout(l.graceTimer);
    }
    channelLifecycles.clear();
  }
}
