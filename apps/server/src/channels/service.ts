import crypto from 'node:crypto';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  CategoryDto,
  ChannelDetailDto,
  FollowedChannelDto,
  LiveChannelDto,
  UpdateChannelInput,
} from '@netstream/shared';
import {
  categories,
  channels,
  db,
  follows,
  streams,
  users,
} from '../db/index.js';
import { redis } from '../lib/redis.js';

export async function getCategories(): Promise<CategoryDto[]> {
  const result = await db
    .select({
      id: categories.id,
      name: categories.name,
      thumbnailUrl: categories.thumbnailUrl,
    })
    .from(categories)
    .orderBy(categories.name);

  return result;
}

export async function getChannelByName(
  name: string,
  currentUserId?: string
): Promise<ChannelDetailDto | null> {
  const [channelData] = await db
    .select({
      id: channels.id,
      name: channels.name,
      title: channels.title,
      isLive: channels.isLive,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryThumbnailUrl: categories.thumbnailUrl,
      ownerUsername: users.username,
    })
    .from(channels)
    .innerJoin(users, eq(channels.ownerId, users.id))
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .where(sql`lower(${channels.name}) = lower(${name})`);

  if (!channelData) {
    return null;
  }

  // Get follower count
  const [followersResult] = await db
    .select({ count: count() })
    .from(follows)
    .where(eq(follows.channelId, channelData.id));

  const followerCount = followersResult ? Number(followersResult.count) : 0;

  // Check if current user is following
  let isFollowing: boolean | undefined = undefined;
  if (currentUserId) {
    const [followRecord] = await db
      .select({ userId: follows.userId })
      .from(follows)
      .where(
        and(
          eq(follows.channelId, channelData.id),
          eq(follows.userId, currentUserId)
        )
      );
    isFollowing = Boolean(followRecord);
  }

  return {
    id: channelData.id,
    name: channelData.name,
    title: channelData.title,
    category: channelData.categoryId
      ? {
          id: channelData.categoryId,
          name: channelData.categoryName!,
          thumbnailUrl: channelData.categoryThumbnailUrl,
        }
      : null,
    followerCount,
    isLive: channelData.isLive,
    ownerUsername: channelData.ownerUsername,
    isFollowing,
  };
}

export async function updateMyChannel(
  ownerId: string,
  input: UpdateChannelInput
): Promise<{
  status: number;
  data?: ChannelDetailDto;
  error?: { code: string; message: string };
}> {
  const [channel] = await db
    .select()
    .from(channels)
    .where(eq(channels.ownerId, ownerId));

  if (!channel) {
    return {
      status: 404,
      error: { code: 'NOT_FOUND', message: 'Channel not found' },
    };
  }

  // If categoryId is provided, verify it exists
  if (input.categoryId !== undefined && input.categoryId !== null) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.categoryId));

    if (!category) {
      return {
        status: 400,
        error: { code: 'INVALID_CATEGORY', message: 'Category not found' },
      };
    }
  }

  const updateValues: Partial<typeof channels.$inferInsert> = {};
  if (input.title !== undefined) {
    updateValues.title = input.title;
  }
  if (input.categoryId !== undefined) {
    updateValues.categoryId = input.categoryId;
  }
  if (input.slowSeconds !== undefined) {
    updateValues.slowSeconds = input.slowSeconds;
  }

  if (Object.keys(updateValues).length > 0) {
    await db
      .update(channels)
      .set(updateValues)
      .where(eq(channels.id, channel.id));
  }

  if (input.slowSeconds !== undefined) {
    await redis.hset(`chan:${channel.id}:settings`, 'slow_seconds', input.slowSeconds.toString());
  }

  const updatedDetail = await getChannelByName(channel.name, ownerId);
  return {
    status: 200,
    data: updatedDetail!,
  };
}

export async function rotateStreamKey(
  ownerId: string
): Promise<{
  status: number;
  data?: { streamKey: string };
  error?: { code: string; message: string };
}> {
  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.ownerId, ownerId));

  if (!channel) {
    return {
      status: 404,
      error: { code: 'NOT_FOUND', message: 'Channel not found' },
    };
  }

  // 32 random bytes (base64url)
  const rawKey = crypto.randomBytes(32).toString('base64url');
  // Store only SHA-256 hash
  const streamKeyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  await db
    .update(channels)
    .set({ streamKeyHash })
    .where(eq(channels.id, channel.id));

  return {
    status: 200,
    data: { streamKey: rawKey },
  };
}

export async function followChannel(
  userId: string,
  channelId: string
): Promise<{
  status: number;
  data?: { ok: boolean; isFollowing: boolean };
  error?: { code: string; message: string };
}> {
  const [channel] = await db
    .select({ id: channels.id, ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId));

  if (!channel) {
    return {
      status: 404,
      error: { code: 'NOT_FOUND', message: 'Channel not found' },
    };
  }

  if (channel.ownerId === userId) {
    return {
      status: 400,
      error: {
        code: 'CANNOT_FOLLOW_SELF',
        message: 'Users cannot follow their own channel',
      },
    };
  }

  await db
    .insert(follows)
    .values({ userId, channelId })
    .onConflictDoNothing();

  return {
    status: 200,
    data: { ok: true, isFollowing: true },
  };
}

export async function unfollowChannel(
  userId: string,
  channelId: string
): Promise<{
  status: number;
  data?: { ok: boolean; isFollowing: boolean };
  error?: { code: string; message: string };
}> {
  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.id, channelId));

  if (!channel) {
    return {
      status: 404,
      error: { code: 'NOT_FOUND', message: 'Channel not found' },
    };
  }

  await db
    .delete(follows)
    .where(
      and(eq(follows.userId, userId), eq(follows.channelId, channelId))
    );

  return {
    status: 200,
    data: { ok: true, isFollowing: false },
  };
}

export async function getFollowedChannels(
  userId: string
): Promise<FollowedChannelDto[]> {
  const results = await db
    .select({
      id: channels.id,
      name: channels.name,
      title: channels.title,
      isLive: channels.isLive,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryThumbnailUrl: categories.thumbnailUrl,
      ownerUsername: users.username,
      followedAt: follows.createdAt,
      streamStartedAt: streams.startedAt,
    })
    .from(follows)
    .innerJoin(channels, eq(follows.channelId, channels.id))
    .innerJoin(users, eq(channels.ownerId, users.id))
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .leftJoin(
      streams,
      and(
        eq(streams.channelId, channels.id),
        sql`${streams.endedAt} IS NULL`
      )
    )
    .where(eq(follows.userId, userId))
    .orderBy(
      desc(channels.isLive),
      desc(sql`COALESCE(${streams.startedAt}, ${channels.createdAt})`),
      desc(follows.createdAt)
    );

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    title: row.title,
    category: row.categoryId
      ? {
          id: row.categoryId,
          name: row.categoryName!,
          thumbnailUrl: row.categoryThumbnailUrl,
        }
      : null,
    isLive: row.isLive,
    ownerUsername: row.ownerUsername,
    followedAt: row.followedAt,
  }));
}

export async function getLiveChannels(filters?: {
  category?: string;
  q?: string;
}): Promise<LiveChannelDto[]> {
  const conditions = [eq(channels.isLive, true)];

  if (filters?.category) {
    conditions.push(ilike(categories.name, `%${filters.category}%`));
  }

  if (filters?.q) {
    const query = `%${filters.q}%`;
    conditions.push(or(ilike(channels.title, query), ilike(channels.name, query))!);
  }

  const results = await db
    .select({
      id: channels.id,
      name: channels.name,
      title: channels.title,
      categoryId: categories.id,
      categoryName: categories.name,
      categoryThumbnailUrl: categories.thumbnailUrl,
      ownerUsername: users.username,
      startedAt: streams.startedAt,
    })
    .from(channels)
    .innerJoin(users, eq(channels.ownerId, users.id))
    .leftJoin(categories, eq(channels.categoryId, categories.id))
    .leftJoin(
      streams,
      and(
        eq(streams.channelId, channels.id),
        sql`${streams.endedAt} IS NULL`
      )
    )
    .where(and(...conditions))
    .orderBy(desc(sql`COALESCE(${streams.startedAt}, ${channels.createdAt})`));

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    title: row.title,
    category: row.categoryId
      ? {
          id: row.categoryId,
          name: row.categoryName!,
          thumbnailUrl: row.categoryThumbnailUrl,
        }
      : null,
    ownerUsername: row.ownerUsername,
    viewerCount: 0, // Filled in by later task
    startedAt: row.startedAt,
  }));
}

export async function getChannelSlowSeconds(channelId: string): Promise<number> {
  const cached = await redis.hget(`chan:${channelId}:settings`, 'slow_seconds');
  if (cached !== null) {
    return parseInt(cached, 10) || 0;
  }

  const [row] = await db
    .select({ slowSeconds: channels.slowSeconds })
    .from(channels)
    .where(eq(channels.id, channelId));

  const seconds = row?.slowSeconds ?? 0;
  await redis.hset(`chan:${channelId}:settings`, 'slow_seconds', seconds.toString());
  return seconds;
}
