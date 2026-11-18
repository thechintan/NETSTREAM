import { describe, expect, it, vi } from 'vitest';
import {
  FOLLOWER_BATCH_SIZE,
  LIVE_NOTIFY_DEDUPE_SECONDS,
  notifyChannelOwnerFollow,
  notifyFollowersChannelLive,
  type NotificationStoreDeps,
} from './service.js';

function createInMemoryDeps(followers: string[], onlineUsers: Set<string>) {
  const dedupeKeys = new Map<string, number>();
  const insertedRows: Array<{ id: string; userId: string; type: string; payload: Record<string, unknown> }> = [];
  const deliveredToOnline: Array<{ userId: string; envelope: { t: string; d: Record<string, unknown> } }> = [];
  const batchSizesRequested: number[] = [];
  const sortedFollowers = [...followers].sort();
  let idSeq = 1;

  const deps: NotificationStoreDeps = {
    acquireDedupeLock: vi.fn(async (channelId: string, ttlSeconds: number) => {
      if (dedupeKeys.has(channelId)) return false;
      dedupeKeys.set(channelId, ttlSeconds);
      return true;
    }),

    fetchFollowerBatch: vi.fn(async (_channelId: string, afterUserId: string | null, limit: number) => {
      const startIdx = afterUserId
        ? sortedFollowers.findIndex((id) => id > afterUserId)
        : 0;
      if (startIdx === -1) return [];
      const slice = sortedFollowers.slice(startIdx, startIdx + limit);
      if (slice.length > 0) batchSizesRequested.push(slice.length);
      return slice;
    }),

    insertNotificationsBatch: vi.fn(
      async (rows: Array<{ userId: string; type: string; payload: Record<string, unknown> }>) => {
        const now = new Date();
        return rows.map((row) => {
          const id = `notif-${idSeq++}`;
          insertedRows.push({ id, ...row });
          return { id, userId: row.userId, createdAt: now };
        });
      }
    ),

    publishToUser: vi.fn(async (userId: string, messageStr: string) => {
      if (!onlineUsers.has(userId)) {
        return 0; // Offline user: no active Redis subscriber
      }
      deliveredToOnline.push({
        userId,
        envelope: JSON.parse(messageStr) as { t: string; d: Record<string, unknown> },
      });
      return 1;
    }),
  };

  return { deps, dedupeKeys, insertedRows, deliveredToOnline, batchSizesRequested };
}

describe('Notifications service (Task 18)', () => {
  it('notifies followers once and delivers real-time push only to online followers (offline get DB rows only)', async () => {
    const followers = ['user-001', 'user-002', 'user-003'];
    const onlineUsers = new Set(['user-001', 'user-003']);
    const { deps, insertedRows, deliveredToOnline } = createInMemoryDeps(followers, onlineUsers);

    const res = await notifyFollowersChannelLive(
      {
        channelId: 'chan-1',
        channelName: 'streamerB',
        title: 'Live Coding',
        category: 'Software & Dev',
        ownerUsername: 'streamerB',
      },
      { deps }
    );

    expect(res.deduplicated).toBe(false);
    expect(res.totalNotified).toBe(3);
    expect(insertedRows).toHaveLength(3);
    expect(insertedRows.map((r) => r.userId)).toEqual(['user-001', 'user-002', 'user-003']);
    expect(insertedRows.every((r) => r.type === 'live')).toBe(true);
    expect(insertedRows[0].payload).toMatchObject({
      channelName: 'streamerB',
      title: 'Live Coding',
      category: 'Software & Dev',
    });

    // Only online followers (user-001 and user-003) received socket push; offline user-002 got DB row only
    expect(deliveredToOnline).toHaveLength(2);
    expect(deliveredToOnline.map((d) => d.userId).sort()).toEqual(['user-001', 'user-003']);
    expect(deliveredToOnline[0].envelope.t).toBe('notify.live');
  });

  it('deduplicates repeat stream.live notifications within 10 minutes', async () => {
    const followers = ['user-001', 'user-002'];
    const onlineUsers = new Set(['user-001']);
    const { deps, dedupeKeys, insertedRows, deliveredToOnline } = createInMemoryDeps(
      followers,
      onlineUsers
    );

    const first = await notifyFollowersChannelLive(
      { channelId: 'chan-dedupe', channelName: 'bob', title: 'Stream 1', category: null },
      { deps }
    );
    const second = await notifyFollowersChannelLive(
      { channelId: 'chan-dedupe', channelName: 'bob', title: 'Stream 1 reconnect', category: null },
      { deps }
    );

    expect(first.deduplicated).toBe(false);
    expect(first.totalNotified).toBe(2);
    expect(dedupeKeys.get('chan-dedupe')).toBe(LIVE_NOTIFY_DEDUPE_SECONDS);

    expect(second.deduplicated).toBe(true);
    expect(second.totalNotified).toBe(0);
    expect(insertedRows).toHaveLength(2); // No duplicate rows inserted
    expect(deliveredToOnline).toHaveLength(1);
  });

  it('batches 1200 followers in chunks of 500 without loading all at once', async () => {
    const followers = Array.from({ length: 1200 }, (_, i) => `u-${String(i).padStart(4, '0')}`);
    const onlineUsers = new Set<string>(['u-0000', 'u-0600', 'u-1199']);
    const { deps, insertedRows, deliveredToOnline, batchSizesRequested } = createInMemoryDeps(
      followers,
      onlineUsers
    );

    const res = await notifyFollowersChannelLive(
      { channelId: 'chan-big', channelName: 'popular', title: 'Big Stream', category: 'Gaming' },
      { deps }
    );

    expect(FOLLOWER_BATCH_SIZE).toBe(500);
    expect(res.deduplicated).toBe(false);
    expect(res.batchesProcessed).toBe(3);
    expect(res.maxBatchSize).toBe(500);
    expect(res.totalNotified).toBe(1200);
    expect(batchSizesRequested).toEqual([500, 500, 200]);
    expect(insertedRows).toHaveLength(1200);
    expect(deliveredToOnline).toHaveLength(3);
    // Verify insertNotificationsBatch was called 3 times, each <= 500 rows
    expect(deps.insertNotificationsBatch).toHaveBeenCalledTimes(3);
  });

  it('creates a follow notification row and publishes notify.follow for the channel owner', async () => {
    const { deps, insertedRows, deliveredToOnline } = createInMemoryDeps([], new Set(['owner-1']));

    const notif = await notifyChannelOwnerFollow(
      {
        ownerId: 'owner-1',
        channelId: 'chan-1',
        channelName: 'ownerChan',
        followerId: 'fan-1',
        followerUsername: 'superfan',
      },
      deps
    );

    expect(notif).not.toBeNull();
    expect(notif?.type).toBe('follow');
    expect(insertedRows).toHaveLength(1);
    expect(deliveredToOnline).toHaveLength(1);
    expect(deliveredToOnline[0].envelope.t).toBe('notify.follow');
    expect(deliveredToOnline[0].envelope.d).toMatchObject({
      followerUsername: 'superfan',
      channelName: 'ownerChan',
    });
  });
});
