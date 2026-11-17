import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  bans,
  channelMods,
  channels,
  modActions,
  users,
} from '../db/schema.js';
import { redis } from '../lib/redis.js';

export type ChannelRole = 'owner' | 'moderator' | 'viewer' | 'guest';

export type ModerationAction =
  | 'chat:send'
  | 'chat:delete'
  | 'chat:timeout'
  | 'chat:ban'
  | 'chat:slow'
  | 'mod:manage';

export interface UserContext {
  id?: string;
  username?: string;
  guest?: boolean;
}

/**
 * Resolves a user's role in a specific channel.
 */
export async function getChannelRole(
  user: UserContext | null | undefined,
  channelId: string
): Promise<ChannelRole> {
  if (!user || user.guest || !user.id) {
    return 'guest';
  }

  // Check if owner
  const [channel] = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  if (channel && channel.ownerId === user.id) {
    return 'owner';
  }

  // Check if moderator
  const [modRecord] = await db
    .select({ userId: channelMods.userId })
    .from(channelMods)
    .where(
      and(
        eq(channelMods.channelId, channelId),
        eq(channelMods.userId, user.id)
      )
    )
    .limit(1);

  if (modRecord) {
    return 'moderator';
  }

  return 'viewer';
}

/**
 * Checks whether a user has permission to perform an action in a channel.
 */
export async function can(
  user: UserContext | null | undefined,
  channelId: string,
  action: ModerationAction
): Promise<boolean> {
  const role = await getChannelRole(user, channelId);

  switch (role) {
    case 'owner':
      // Owner can perform all actions
      return true;

    case 'moderator':
      // Mods can moderate chat and change slow mode, but cannot add/remove mods
      if (action === 'mod:manage') return false;
      return true;

    case 'viewer':
      // Viewers can only send messages
      return action === 'chat:send';

    case 'guest':
    default:
      return false;
  }
}

/**
 * Validates whether an actor can moderate a specific target user.
 * Owners cannot be banned or timed out; mods cannot ban or timeout other mods.
 */
export async function canModerateTarget(
  actorId: string,
  targetUserId: string,
  channelId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (actorId === targetUserId) {
    return { ok: false, reason: 'Cannot moderate yourself' };
  }

  const [channel] = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  if (!channel) {
    return { ok: false, reason: 'Channel not found' };
  }

  // Owners cannot be moderated
  if (targetUserId === channel.ownerId) {
    return { ok: false, reason: 'Cannot moderate the channel owner' };
  }

  // If actor is the owner, they can moderate anyone else
  if (actorId === channel.ownerId) {
    return { ok: true };
  }

  // If actor is a mod, check if target is also a mod
  const [targetModRecord] = await db
    .select({ userId: channelMods.userId })
    .from(channelMods)
    .where(
      and(
        eq(channelMods.channelId, channelId),
        eq(channelMods.userId, targetUserId)
      )
    )
    .limit(1);

  if (targetModRecord) {
    return { ok: false, reason: 'Moderators cannot moderate other moderators' };
  }

  return { ok: true };
}

/**
 * Hot path check for whether a user is banned from a channel.
 * Checks Redis set first, falls back to Postgres and warms Redis cache.
 */
export async function isUserBanned(
  channelId: string,
  userId: string
): Promise<boolean> {
  const banKey = `bans:${channelId}`;

  // 1. Redis hot path
  const isMember = await redis.sismember(banKey, userId);
  if (isMember === 1) {
    return true;
  }

  // 2. Database lookup
  const [dbBan] = await db
    .select({ userId: bans.userId, expiresAt: bans.expiresAt })
    .from(bans)
    .where(
      and(
        eq(bans.channelId, channelId),
        eq(bans.userId, userId)
      )
    )
    .limit(1);

  if (dbBan) {
    // If ban has expired, don't count
    if (dbBan.expiresAt && dbBan.expiresAt.getTime() <= Date.now()) {
      return false;
    }
    // Warm Redis cache
    await redis.sadd(banKey, userId);
    return true;
  }

  return false;
}

/**
 * Checks whether a user is timed out in a channel.
 */
export async function getUserTimeout(
  channelId: string,
  userId: string
): Promise<{ timedOut: boolean; remainingSeconds: number }> {
  const timeoutKey = `timeout:${channelId}:${userId}`;
  const ttl = await redis.ttl(timeoutKey);

  if (ttl > 0) {
    return { timedOut: true, remainingSeconds: ttl };
  }

  return { timedOut: false, remainingSeconds: 0 };
}

/**
 * Bans a user from a channel.
 */
export async function banUser(
  channelId: string,
  actorId: string,
  targetUserId: string,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const check = await canModerateTarget(actorId, targetUserId, channelId);
  if (!check.ok) {
    return { ok: false, error: check.reason };
  }

  // 1. Insert or update into bans table
  await db
    .insert(bans)
    .values({
      channelId,
      userId: targetUserId,
      bannedBy: actorId,
      reason: reason || null,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [bans.channelId, bans.userId],
      set: {
        bannedBy: actorId,
        reason: reason || null,
        createdAt: new Date(),
      },
    });

  // 2. Add to Redis hot-path set
  await redis.sadd(`bans:${channelId}`, targetUserId);

  // 3. Audit log
  await db.insert(modActions).values({
    channelId,
    actorId,
    targetUserId,
    action: 'ban',
    detail: { reason: reason || null },
    createdAt: new Date(),
  });

  return { ok: true };
}

/**
 * Times out a user in a channel.
 */
export async function timeoutUser(
  channelId: string,
  actorId: string,
  targetUserId: string,
  seconds: number,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const check = await canModerateTarget(actorId, targetUserId, channelId);
  if (!check.ok) {
    return { ok: false, error: check.reason };
  }

  // 1. Set in Redis with TTL
  const timeoutKey = `timeout:${channelId}:${targetUserId}`;
  await redis.set(timeoutKey, '1', 'EX', seconds);

  // 2. Audit log
  await db.insert(modActions).values({
    channelId,
    actorId,
    targetUserId,
    action: 'timeout',
    detail: { seconds, reason: reason || null },
    createdAt: new Date(),
  });

  return { ok: true };
}

/**
 * Records deletion of a chat message.
 */
export async function recordDeleteMessage(
  channelId: string,
  actorId: string,
  mid: string
): Promise<void> {
  await db.insert(modActions).values({
    channelId,
    actorId,
    targetUserId: null,
    action: 'delete_message',
    detail: { mid },
    createdAt: new Date(),
  });
}

/**
 * Updates slow mode duration.
 */
export async function updateSlowMode(
  channelId: string,
  actorId: string,
  seconds: number
): Promise<void> {
  // Update DB
  await db
    .update(channels)
    .set({ slowSeconds: seconds })
    .where(eq(channels.id, channelId));

  // Mirror to Redis hash
  await redis.hset(`chan:${channelId}:settings`, 'slow_seconds', seconds.toString());

  // Audit log
  await db.insert(modActions).values({
    channelId,
    actorId,
    targetUserId: null,
    action: 'slow_mode',
    detail: { seconds },
    createdAt: new Date(),
  });
}

/**
 * Retrieves all moderators for a channel.
 */
export async function getChannelMods(
  channelId: string
): Promise<Array<{ userId: string; username: string }>> {
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
    })
    .from(channelMods)
    .innerJoin(users, eq(channelMods.userId, users.id))
    .where(eq(channelMods.channelId, channelId));

  return rows;
}

/**
 * Adds a moderator to a channel (owner only).
 */
export async function addChannelMod(
  channelId: string,
  ownerId: string,
  username: string
): Promise<{ status: number; data?: { userId: string; username: string }; error?: { code: string; message: string } }> {
  // Check that channel exists and caller is owner
  const [channel] = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  if (!channel) {
    return { status: 404, error: { code: 'NOT_FOUND', message: 'Channel not found' } };
  }

  if (channel.ownerId !== ownerId) {
    return { status: 403, error: { code: 'FORBIDDEN', message: 'Only the channel owner can add moderators' } };
  }

  // Find target user
  const [targetUser] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);

  if (!targetUser) {
    return { status: 404, error: { code: 'NOT_FOUND', message: 'User not found' } };
  }

  if (targetUser.id === ownerId) {
    return { status: 400, error: { code: 'BAD_REQUEST', message: 'Channel owner cannot be added as a moderator' } };
  }

  // Insert into channel_mods
  await db
    .insert(channelMods)
    .values({
      channelId,
      userId: targetUser.id,
    })
    .onConflictDoNothing();

  // Audit log
  await db.insert(modActions).values({
    channelId,
    actorId: ownerId,
    targetUserId: targetUser.id,
    action: 'add_mod',
    detail: { username: targetUser.username },
    createdAt: new Date(),
  });

  return {
    status: 201,
    data: { userId: targetUser.id, username: targetUser.username },
  };
}

/**
 * Removes a moderator from a channel (owner only).
 */
export async function removeChannelMod(
  channelId: string,
  ownerId: string,
  username: string
): Promise<{ status: number; error?: { code: string; message: string } }> {
  const [channel] = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);

  if (!channel) {
    return { status: 404, error: { code: 'NOT_FOUND', message: 'Channel not found' } };
  }

  if (channel.ownerId !== ownerId) {
    return { status: 403, error: { code: 'FORBIDDEN', message: 'Only the channel owner can remove moderators' } };
  }

  // Find target user
  const [targetUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);

  if (!targetUser) {
    return { status: 404, error: { code: 'NOT_FOUND', message: 'User not found' } };
  }

  await db
    .delete(channelMods)
    .where(
      and(
        eq(channelMods.channelId, channelId),
        eq(channelMods.userId, targetUser.id)
      )
    );

  // Audit log
  await db.insert(modActions).values({
    channelId,
    actorId: ownerId,
    targetUserId: targetUser.id,
    action: 'remove_mod',
    detail: { username },
    createdAt: new Date(),
  });

  return { status: 200 };
}
