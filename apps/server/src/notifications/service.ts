import { and, asc, count, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import type {
  MarkNotificationsReadInput,
  NotificationDto,
  NotifyFollowPayload,
  NotifyLivePayload,
} from '@netstream/shared';
import { db, follows, notifications } from '../db/index.js';
import { redis } from '../lib/redis.js';

export const LIVE_NOTIFY_DEDUPE_SECONDS = 600; // 10 minutes
export const FOLLOWER_BATCH_SIZE = 500;

export interface LiveNotificationEvent {
  channelId: string;
  channelName: string;
  title: string;
  category: string | null;
  ownerUsername?: string;
}

export interface FollowNotificationEvent {
  ownerId: string;
  channelId: string;
  channelName: string;
  followerId: string;
  followerUsername: string;
}

export interface NotifyBatchResult {
  deduplicated: boolean;
  batchesProcessed: number;
  totalNotified: number;
  maxBatchSize: number;
}

export interface NotificationStoreDeps {
  acquireDedupeLock: (channelId: string, ttlSeconds: number) => Promise<boolean>;
  fetchFollowerBatch: (
    channelId: string,
    afterUserId: string | null,
    limit: number
  ) => Promise<string[]>;
  insertNotificationsBatch: (
    rows: Array<{ userId: string; type: string; payload: Record<string, unknown> }>
  ) => Promise<Array<{ id: string; userId: string; createdAt: Date }>>;
  publishToUser: (userId: string, messageStr: string) => Promise<number>;
}

const defaultDeps: NotificationStoreDeps = {
  async acquireDedupeLock(channelId, ttlSeconds) {
    const key = `notify:live:dedupe:${channelId}`;
    const res = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  },

  async fetchFollowerBatch(channelId, afterUserId, limit) {
    const whereClause = afterUserId
      ? and(eq(follows.channelId, channelId), gt(follows.userId, afterUserId))
      : eq(follows.channelId, channelId);

    const rows = await db
      .select({ userId: follows.userId })
      .from(follows)
      .where(whereClause)
      .orderBy(asc(follows.userId))
      .limit(limit);

    return rows.map((r) => r.userId);
  },

  async insertNotificationsBatch(rows) {
    if (rows.length === 0) return [];
    const inserted = await db
      .insert(notifications)
      .values(rows)
      .returning({
        id: notifications.id,
        userId: notifications.userId,
        createdAt: notifications.createdAt,
      });
    return inserted;
  },

  async publishToUser(userId, messageStr) {
    return redis.publish(`user:${userId}`, messageStr);
  },
};

/**
 * Finds the channel's followers in batches of 500, inserts a 'live' notification row
 * for every follower, and pushes `notify.live` over `user:{id}` for online followers.
 * Deduplicated per channel for 10 minutes via Redis key with TTL.
 */
export async function notifyFollowersChannelLive(
  event: LiveNotificationEvent,
  options?: {
    batchSize?: number;
    dedupeSeconds?: number;
    deps?: NotificationStoreDeps;
  }
): Promise<NotifyBatchResult> {
  const deps = options?.deps ?? defaultDeps;
  const batchSize = options?.batchSize ?? FOLLOWER_BATCH_SIZE;
  const dedupeSeconds = options?.dedupeSeconds ?? LIVE_NOTIFY_DEDUPE_SECONDS;

  const acquired = await deps.acquireDedupeLock(event.channelId, dedupeSeconds);
  if (!acquired) {
    return {
      deduplicated: true,
      batchesProcessed: 0,
      totalNotified: 0,
      maxBatchSize: 0,
    };
  }

  let lastUserId: string | null = null;
  let batchesProcessed = 0;
  let totalNotified = 0;
  let maxBatchSize = 0;

  while (true) {
    const followerIds = await deps.fetchFollowerBatch(event.channelId, lastUserId, batchSize);
    if (followerIds.length === 0) {
      break;
    }

    batchesProcessed += 1;
    if (followerIds.length > maxBatchSize) {
      maxBatchSize = followerIds.length;
    }

    const payload: Record<string, unknown> = {
      channelId: event.channelId,
      channelName: event.channelName,
      title: event.title,
      category: event.category,
      ownerUsername: event.ownerUsername,
    };

    const inserted = await deps.insertNotificationsBatch(
      followerIds.map((userId) => ({
        userId,
        type: 'live',
        payload,
      }))
    );

    totalNotified += inserted.length;

    // Publish notify.live on each user's Redis channel (online sockets receive it immediately)
    await Promise.all(
      inserted.map((row) => {
        const pushData: NotifyLivePayload = {
          id: row.id,
          type: 'live',
          channelId: event.channelId,
          channelName: event.channelName,
          title: event.title,
          category: event.category,
          ownerUsername: event.ownerUsername,
          createdAt: row.createdAt.toISOString(),
        };
        const msg = JSON.stringify({ t: 'notify.live', d: pushData });
        return deps.publishToUser(row.userId, msg);
      })
    );

    lastUserId = followerIds[followerIds.length - 1];
    if (followerIds.length < batchSize) {
      break;
    }
  }

  return {
    deduplicated: false,
    batchesProcessed,
    totalNotified,
    maxBatchSize,
  };
}

/**
 * Inserts a 'follow' notification row for the channel owner and pushes `notify.follow` if online.
 */
export async function notifyChannelOwnerFollow(
  event: FollowNotificationEvent,
  deps: Pick<NotificationStoreDeps, 'insertNotificationsBatch' | 'publishToUser'> = defaultDeps
): Promise<NotificationDto | null> {
  const payload: Record<string, unknown> = {
    channelId: event.channelId,
    channelName: event.channelName,
    followerId: event.followerId,
    followerUsername: event.followerUsername,
  };

  const [inserted] = await deps.insertNotificationsBatch([
    {
      userId: event.ownerId,
      type: 'follow',
      payload,
    },
  ]);

  if (!inserted) return null;

  const pushData: NotifyFollowPayload = {
    id: inserted.id,
    type: 'follow',
    channelId: event.channelId,
    channelName: event.channelName,
    followerId: event.followerId,
    followerUsername: event.followerUsername,
    createdAt: inserted.createdAt.toISOString(),
  };

  await deps.publishToUser(
    event.ownerId,
    JSON.stringify({ t: 'notify.follow', d: pushData })
  );

  return {
    id: inserted.id,
    userId: inserted.userId,
    type: 'follow',
    payload,
    readAt: null,
    createdAt: inserted.createdAt.toISOString(),
  };
}

export async function getUserNotifications(
  userId: string,
  options?: { unreadOnly?: boolean; limit?: number }
): Promise<{ notifications: NotificationDto[]; unreadCount: number }> {
  const limit = options?.limit ?? 50;
  const whereClause = options?.unreadOnly
    ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
    : eq(notifications.userId, userId);

  const [rows, unreadResult] = await Promise.all([
    db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        type: notifications.type,
        payload: notifications.payload,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);

  return {
    notifications: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      type: r.type,
      payload: r.payload,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
    unreadCount: unreadResult[0] ? Number(unreadResult[0].count) : 0,
  };
}

export async function markNotificationsRead(
  userId: string,
  input: MarkNotificationsReadInput
): Promise<{ ok: true; updatedCount: number }> {
  const now = new Date();
  const condition = input.all
    ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
    : and(
        eq(notifications.userId, userId),
        inArray(notifications.id, input.ids ?? []),
        isNull(notifications.readAt)
      );

  const updated = await db
    .update(notifications)
    .set({ readAt: now })
    .where(condition)
    .returning({ id: notifications.id });

  return {
    ok: true,
    updatedCount: updated.length,
  };
}
