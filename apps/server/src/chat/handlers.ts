import { ChatJoinResponse } from '@netstream/shared';
import { redisSub } from '../lib/redis.js';
import { Conn } from '../realtime/conn.js';
import { WebSocketGateway } from '../realtime/gateway.js';
import {
  formatChatMessage,
  getRecentMessages,
  publishChatMessage,
  stripControlCharacters,
} from './service.js';

export function registerChatHandlers(gateway: WebSocketGateway): void {
  const activeSubscriptions = new Set<string>();

  // Subscribe to Redis message event for room distribution
  const onRedisMessage = (channel: string, messageStr: string) => {
    if (channel.startsWith('chat:')) {
      gateway.broadcastRawToRoom(channel, messageStr);
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
    const { channelId } = msg.d;
    const room = `chat:${channelId}`;

    gateway.joinRoom(conn, room);

    // Subscribe to Redis channel on the first local member
    const roomMembers = gateway.rooms.get(room);
    if (roomMembers && roomMembers.size === 1 && !activeSubscriptions.has(room)) {
      activeSubscriptions.add(room);
      await redisSub.subscribe(room);
    }

    // Retrieve last 50 messages from Redis recent list
    const messages = await getRecentMessages(channelId, 50);
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
    const sanitized = stripControlCharacters(text).trim();

    if (!sanitized) {
      conn.fail(msg.id, 'BAD_REQUEST', 'Message cannot be empty');
      return;
    }

    if (sanitized.length > 500) {
      conn.fail(msg.id, 'BAD_REQUEST', 'Message cannot exceed 500 characters');
      return;
    }

    // 2. Format message with ULID and deterministic color
    const chatMsg = formatChatMessage(channelId, conn.user, sanitized);

    // 3. Publish to Redis & recent list (delivered via Redis pub/sub)
    await publishChatMessage(chatMsg);

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
