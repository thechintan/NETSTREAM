import crypto from 'node:crypto';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  CategoryDto,
  ChannelDetailDto,
  FollowedChannelDto,
  LiveChannelDto,
  SearchResponseDto,
  UpdateChannelInput,
} from '@netstream/shared';
import {
  categories,
  channelMods,
  channels,
  db,
  follows,
  streams,
  users,
} from '../db/index.js';
import { redis } from '../lib/redis.js';
import { notifyChannelOwnerFollow } from '../notifications/service.js';
import { getViewerCount } from '../presence/service.js';
import { getStreamState } from '../media/lifecycle.js';

export async function getCategories(): Promise<CategoryDto[]> {
  const result = await db
    .select({
      id: categories.id,
      name: categories.name,
      thumbnailUrl: categories.thumbnailUrl,
      liveCount: sql<number>`COALESCE(SUM(CASE WHEN ${channels.isLive} THEN 1 ELSE 0 END), 0)::int`,
    })
    .from(categories)
    .leftJoin(channels, eq(channels.categoryId, categories.id))
    .groupBy(categories.id, categories.name, categories.thumbnailUrl)
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
      ownerId: channels.ownerId,
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

  // Check if current user is following and whether they are a moderator
  let isFollowing: boolean | undefined = undefined;
  let isMod: boolean | undefined = undefined;
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

    const [modRecord] = await db
      .select({ userId: channelMods.userId })
      .from(channelMods)
      .where(
        and(
          eq(channelMods.channelId, channelData.id),
          eq(channelMods.userId, currentUserId)
        )
      );
    isMod = Boolean(modRecord);
  }

  const viewerCount = await getViewerCount(channelData.id);

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
    viewerCount,
    isLive:
      getStreamState(channelData.id) === 'LIVE'
        ? true
        : getStreamState(channelData.id) === 'OFFLINE' ||
            getStreamState(channelData.id) === 'ENDING'
          ? false
          : channelData.isLive,
    ownerUsername: channelData.ownerUsername,
    ownerId: channelData.ownerId,
    isFollowing,
    isMod,
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
    .select({ id: channels.id, name: channels.name, ownerId: channels.ownerId })
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

  const inserted = await db
    .insert(follows)
    .values({ userId, channelId })
    .onConflictDoNothing()
    .returning({ userId: follows.userId });

  if (inserted.length > 0) {
    try {
      const [follower] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId));

      await notifyChannelOwnerFollow({
        ownerId: channel.ownerId,
        channelId: channel.id,
        channelName: channel.name,
        followerId: userId,
        followerUsername: follower?.username ?? 'Someone',
      });
    } catch {
      // Non-fatal if follow notification fails
    }
  }

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

  const liveResults = results.filter((row) => {
    const state = getStreamState(row.id);
    if (state === 'OFFLINE' || state === 'ENDING') return false;
    return true;
  });

  const hydrated = await Promise.all(
    liveResults.map(async (row) => ({
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
      viewerCount: await getViewerCount(row.id),
      startedAt: row.startedAt,
    }))
  );

  hydrated.sort((a, b) => b.viewerCount - a.viewerCount);
  return hydrated;
}

export async function getLiveChannelsByCategory(
  categoryId: string
): Promise<{ category: CategoryDto; channels: LiveChannelDto[] } | null> {
  const [categoryRow] = await db
    .select({
      id: categories.id,
      name: categories.name,
      thumbnailUrl: categories.thumbnailUrl,
    })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!categoryRow) {
    return null;
  }

  const results = await db
    .select({
      id: channels.id,
      name: channels.name,
      title: channels.title,
      ownerUsername: users.username,
      startedAt: streams.startedAt,
    })
    .from(channels)
    .innerJoin(users, eq(channels.ownerId, users.id))
    .leftJoin(
      streams,
      and(eq(streams.channelId, channels.id), sql`${streams.endedAt} IS NULL`)
    )
    .where(and(eq(channels.categoryId, categoryId), eq(channels.isLive, true)))
    .orderBy(desc(sql`COALESCE(${streams.startedAt}, ${channels.createdAt})`));

  const hydrated: LiveChannelDto[] = await Promise.all(
    results.map(async (row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      category: {
        id: categoryRow.id,
        name: categoryRow.name,
        thumbnailUrl: categoryRow.thumbnailUrl,
      },
      ownerUsername: row.ownerUsername,
      viewerCount: await getViewerCount(row.id),
      startedAt: row.startedAt,
    }))
  );

  hydrated.sort((a, b) => b.viewerCount - a.viewerCount);

  return {
    category: {
      id: categoryRow.id,
      name: categoryRow.name,
      thumbnailUrl: categoryRow.thumbnailUrl,
      liveCount: hydrated.length,
    },
    channels: hydrated,
  };
}

export async function searchDiscovery(rawQuery: string): Promise<SearchResponseDto> {
  const q = rawQuery.trim();
  if (!q) {
    return { channels: [], categories: [] };
  }

  const likePattern = `%${q}%`;

  const [channelRows, categoryRows] = await Promise.all([
    db
      .select({
        id: channels.id,
        name: channels.name,
        title: channels.title,
        isLive: channels.isLive,
        ownerUsername: users.username,
        categoryId: categories.id,
        categoryName: categories.name,
        categoryThumbnailUrl: categories.thumbnailUrl,
        score: sql<number>`GREATEST(similarity(${channels.name}, ${q}), similarity(${channels.title}, ${q}))`,
      })
      .from(channels)
      .innerJoin(users, eq(channels.ownerId, users.id))
      .leftJoin(categories, eq(channels.categoryId, categories.id))
      .where(
        or(
          sql`${channels.name} % ${q}`,
          sql`${channels.title} % ${q}`,
          ilike(channels.name, likePattern),
          ilike(channels.title, likePattern)
        )
      )
      .orderBy(
        desc(channels.isLive),
        desc(sql`GREATEST(similarity(${channels.name}, ${q}), similarity(${channels.title}, ${q}))`),
        channels.name
      )
      .limit(12),
    db
      .select({
        id: categories.id,
        name: categories.name,
        thumbnailUrl: categories.thumbnailUrl,
        score: sql<number>`similarity(${categories.name}, ${q})`,
      })
      .from(categories)
      .where(or(sql`${categories.name} % ${q}`, ilike(categories.name, likePattern)))
      .orderBy(desc(sql`similarity(${categories.name}, ${q})`), categories.name)
      .limit(8),
  ]);

  const hydratedChannels = await Promise.all(
    channelRows.map(async (row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      isLive: row.isLive,
      viewerCount: row.isLive ? await getViewerCount(row.id) : 0,
      ownerUsername: row.ownerUsername,
      category: row.categoryId
        ? {
            id: row.categoryId,
            name: row.categoryName!,
            thumbnailUrl: row.categoryThumbnailUrl,
          }
        : null,
    }))
  );

  return {
    channels: hydratedChannels,
    categories: categoryRows.map((c) => ({
      id: c.id,
      name: c.name,
      thumbnailUrl: c.thumbnailUrl,
    })),
  };
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
