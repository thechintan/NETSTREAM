import { ChatJoinResponse } from '@netstream/shared';
import { redis, redisSub } from '../lib/redis.js';
import { Conn } from '../realtime/conn.js';
import { WebSocketGateway } from '../realtime/gateway.js';
import { getChannelSlowSeconds } from '../channels/service.js';
import {
  getChannelRole,
  getUserTimeout,
  isUserBanned,
} from '../moderation/service.js';
import { getChatPersistenceWorker } from './persistence.js';
import {
  formatChatMessage,
  getRecentMessages,
  publishChatMessage,
  stripControlCharacters,
} from './service.js';

export async function isModFor(userId: string, channelId: string): Promise<boolean> {
  const role = await getChannelRole({ id: userId }, channelId);
  return role === 'owner' || role === 'moderator';
}

export function registerChatHandlers(gateway: WebSocketGateway): void {
  const activeSubscriptions = new Set<string>();

  // Subscribe to Redis message event for room distribution
  const onRedisMessage = (channel: string, messageStr: string) => {
    if (channel.startsWith('chat:')) {
      gateway.broadcastRawToRoom(channel, messageStr);

      // If a user was banned, remove their socket from this chat room immediately
      try {
        const parsed = JSON.parse(messageStr);
        if (parsed.t === 'user.banned' && parsed.d?.userId) {
          const roomMembers = gateway.rooms.get(channel);
          if (roomMembers) {
            for (const member of [...roomMembers]) {
              if (member.user.id === parsed.d.userId) {
                gateway.leaveRoom(member, channel);
              }
            }
          }
        }
      } catch {
        // Ignore unparseable broadcast
      }
    }
  };

  redisSub.on('message', onRedisMessage);

  // Helper to unsubscribe from Redis when the last local member leaves
  const checkAndUnsubscribe = async (room: string) => {
    const set = gateway.rooms.get(room);
    if ((!set || set.size === 0) && activeSubscriptions.has(room)) {
      activeSubscriptions.delete(room);
      try {
        await redisSub.unsubscribe(room);
      } catch {
        // Ignore unsubscribe error during shutdown
      }
    }
  };

  // chat.join
  gateway.dispatcher.register('chat.join', async (conn: Conn, msg) => {
    const { channelId, lastMid } = msg.d;
    const room = `chat:${channelId}`;

    gateway.joinRoom(conn, room);

    // Subscribe to Redis channel on the first local member
    const roomMembers = gateway.rooms.get(room);
    if (roomMembers && roomMembers.size === 1 && !activeSubscriptions.has(room)) {
      activeSubscriptions.add(room);
      await redisSub.subscribe(room);
    }

    // Retrieve messages from Redis (filtered by lastMid if provided)
    const messages = await getRecentMessages(channelId, 50, lastMid);
    return { messages } satisfies ChatJoinResponse;
  });

  // chat.leave
  gateway.dispatcher.register('chat.leave', async (conn: Conn, msg) => {
    const { channelId } = msg.d;
    const room = `chat:${channelId}`;

    gateway.leaveRoom(conn, room);
    await checkAndUnsubscribe(room);

    return { ok: true };
  });

  // chat.send
  gateway.dispatcher.register('chat.send', async (conn: Conn, msg) => {
    // 1. Guests cannot send
    if (conn.user.guest) {
      conn.fail(msg.id, 'FORBIDDEN', 'Guests cannot send chat messages');
      return;
    }

    const { channelId, text } = msg.d;

    // 2. Banned users get BANNED and their connection is removed immediately
    const banned = await isUserBanned(channelId, conn.user.id);
    if (banned) {
      gateway.leaveRoom(conn, `chat:${channelId}`);
      conn.fail(msg.id, 'BANNED', 'You are banned from chatting in this channel');
      return;
    }

    // 3. Timed-out users get TIMED_OUT with the remaining time
    const timeout = await getUserTimeout(channelId, conn.user.id);
    if (timeout.timedOut) {
      const retryAfterMs = timeout.remainingSeconds * 1000;
      conn.fail(
        msg.id,
        'TIMED_OUT',
        `You are timed out from chatting. Please wait ${timeout.remainingSeconds}s.`,
        retryAfterMs
      );
      return;
    }

    const sanitized = stripControlCharacters(text).trim();

    if (!sanitized) {
      conn.fail(msg.id, 'BAD_REQUEST', 'Message cannot be empty');
      return;
    }

    if (sanitized.length > 500) {
      conn.fail(msg.id, 'BAD_REQUEST', 'Message cannot exceed 500 characters');
      return;
    }

    // 4. Per-user per-channel rate limit: 20 messages per 30 seconds
    const rateKey = `ratelimit:chat:${channelId}:${conn.user.id}`;
    const count = await redis.incr(rateKey);
    if (count === 1) {
      await redis.expire(rateKey, 30);
    }
    if (count > 20) {
      const ttl = await redis.ttl(rateKey);
      const retryAfterMs = Math.max(1000, ttl * 1000);
      conn.fail(
        msg.id,
        'RATE_LIMITED',
        'You are sending messages too quickly. Please wait.',
        retryAfterMs
      );
      return;
    }

    // 5. Role check for slow mode & badges
    const role = await getChannelRole(conn.user, channelId);
    const isModOrOwner = role === 'owner' || role === 'moderator';

    // Slow mode enforcement for non-moderators
    if (!isModOrOwner) {
      const slowSeconds = await getChannelSlowSeconds(channelId);
      if (slowSeconds > 0) {
        const slowKey = `slow:${channelId}:${conn.user.id}`;
        const setResult = await redis.set(slowKey, '1', 'EX', slowSeconds, 'NX');
        if (setResult !== 'OK') {
          const remainingTtl = await redis.ttl(slowKey);
          const retryAfterMs = Math.max(1000, remainingTtl * 1000);
          conn.fail(
            msg.id,
            'SLOW_MODE',
            `Slow mode is active. Please wait ${remainingTtl}s before sending another message.`,
            retryAfterMs
          );
          return;
        }
      }
    }

    // 6. Badges: add 'owner' and 'mod' to message user.badges
    const badges: string[] = [];
    if (role === 'owner') {
      badges.push('owner');
    } else if (role === 'moderator') {
      badges.push('mod');
    }

    // 7. Format message with ULID, deterministic color, and badges
    const chatMsg = formatChatMessage(channelId, conn.user, sanitized, badges);

    // 8. Publish to Redis & recent list (delivered via Redis pub/sub)
    await publishChatMessage(chatMsg);

    // 9. Enqueue for database batch persistence
    getChatPersistenceWorker().enqueue(chatMsg);

    return { ok: true, mid: chatMsg.mid };
  });

  // Cleanup hook so closing a connection removes it from all rooms
  gateway.onCleanup(async (conn: Conn) => {
    for (const room of [...conn.rooms]) {
      if (room.startsWith('chat:')) {
        gateway.leaveRoom(conn, room);
        await checkAndUnsubscribe(room);
      }
    }
  });
}
