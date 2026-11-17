import { redis } from '../lib/redis.js';

/**
 * Adds a connection as an active viewer for a channel.
 * Uses a Redis sorted set: viewers:{channelId} with member=connId and score=timestamp.
 */
export async function addViewer(
  channelId: string,
  connId: string,
  timestamp: number = Date.now()
): Promise<void> {
  const key = `viewers:${channelId}`;
  await redis.zadd(key, timestamp, connId);
}

/**
 * Updates the last-seen timestamp of an existing viewer connection.
 * The 'XX' flag ensures we only update elements that already exist.
 */
export async function touchViewer(
  channelId: string,
  connId: string,
  timestamp: number = Date.now()
): Promise<void> {
  const key = `viewers:${channelId}`;
  await redis.zadd(key, 'XX', timestamp, connId);
}

/**
 * Removes a viewer connection from a channel.
 */
export async function removeViewer(
  channelId: string,
  connId: string
): Promise<void> {
  const key = `viewers:${channelId}`;
  await redis.zrem(key, connId);
}

/**
 * Prunes viewer entries older than maxAgeMs (default 60 seconds).
 */
export async function pruneStaleViewers(
  channelId: string,
  maxAgeMs: number = 60000,
  now: number = Date.now()
): Promise<number> {
  const key = `viewers:${channelId}`;
  const cutoff = now - maxAgeMs;
  return await redis.zremrangebyscore(key, 0, cutoff);
}

/**
 * Retrieves the current live viewer count for a channel,
 * pruning stale entries first.
 */
export async function getViewerCount(
  channelId: string,
  maxAgeMs: number = 60000
): Promise<number> {
  const key = `viewers:${channelId}`;
  await pruneStaleViewers(channelId, maxAgeMs);
  return await redis.zcard(key);
}

/**
 * Retrieves the recorded peak viewer count for a channel's stream.
 */
export async function getPeak(channelId: string): Promise<number> {
  const key = `stream:peak:${channelId}`;
  const val = await redis.get(key);
  return val ? parseInt(val, 10) || 0 : 0;
}

/**
 * Updates the recorded peak viewer count if the current count exceeds it.
 */
export async function updatePeak(
  channelId: string,
  currentCount: number
): Promise<number> {
  const key = `stream:peak:${channelId}`;
  const currentPeak = await getPeak(channelId);
  if (currentCount > currentPeak) {
    await redis.set(key, currentCount.toString());
    return currentCount;
  }
  return currentPeak;
}

/**
 * Resets peak viewer count for a channel (e.g. on stream start).
 */
export async function resetPeak(channelId: string): Promise<void> {
  const key = `stream:peak:${channelId}`;
  await redis.del(key);
}
