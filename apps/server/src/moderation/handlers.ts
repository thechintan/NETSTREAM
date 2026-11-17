import { ulid } from 'ulid';
import { redis } from '../lib/redis.js';
import { Conn } from '../realtime/conn.js';
import { WebSocketGateway } from '../realtime/gateway.js';
import {
  banUser,
  can,
  recordDeleteMessage,
  timeoutUser,
  updateSlowMode,
} from './service.js';

export function registerModerationHandlers(gateway: WebSocketGateway): void {
  // mod.delete
  gateway.dispatcher.register('mod.delete', async (conn: Conn, msg) => {
    const { channelId } = msg.d;
    const mid = msg.d.mid || msg.d.messageId;

    if (!mid) {
      conn.fail(msg.id, 'BAD_REQUEST', 'Missing message id');
      return;
    }

    const allowed = await can(conn.user, channelId, 'chat:delete');
    if (!allowed) {
      conn.fail(msg.id, 'FORBIDDEN', 'You do not have permission to delete messages');
      return;
    }

    await recordDeleteMessage(channelId, conn.user.id, mid);

    // Broadcast chat.deleted push event to Redis room
    const pushMsg = JSON.stringify({
      t: 'chat.deleted',
      d: { mid },
    });
    await redis.publish(`chat:${channelId}`, pushMsg);

    return { ok: true, mid };
  });

  // mod.timeout
  gateway.dispatcher.register('mod.timeout', async (conn: Conn, msg) => {
    const { channelId, userId, reason } = msg.d;
    const seconds = msg.d.seconds !== undefined ? msg.d.seconds : msg.d.durationSeconds;

    if (!seconds || seconds <= 0) {
      conn.fail(msg.id, 'BAD_REQUEST', 'Invalid timeout duration');
      return;
    }

    const allowed = await can(conn.user, channelId, 'chat:timeout');
    if (!allowed) {
      conn.fail(msg.id, 'FORBIDDEN', 'You do not have permission to timeout users');
      return;
    }

    const result = await timeoutUser(channelId, conn.user.id, userId, seconds, reason);
    if (!result.ok) {
      conn.fail(msg.id, 'FORBIDDEN', result.error || 'Cannot timeout this user');
      return;
    }

    // Broadcast system message for timeout
    const sysNotice = {
      mid: ulid(),
      channelId,
      user: {
        id: 'system',
        name: 'System',
        color: '#F59E0B',
        badges: [],
      },
      text: `A user was timed out for ${seconds}s.`,
      ts: Date.now(),
    };

    await redis.publish(`chat:${channelId}`, JSON.stringify({
      t: 'chat.message',
      d: sysNotice,
    }));

    return { ok: true, userId, seconds };
  });

  // mod.ban
  gateway.dispatcher.register('mod.ban', async (conn: Conn, msg) => {
    const { channelId, userId, reason } = msg.d;

    const allowed = await can(conn.user, channelId, 'chat:ban');
    if (!allowed) {
      conn.fail(msg.id, 'FORBIDDEN', 'You do not have permission to ban users');
      return;
    }

    const result = await banUser(channelId, conn.user.id, userId, reason);
    if (!result.ok) {
      conn.fail(msg.id, 'FORBIDDEN', result.error || 'Cannot ban this user');
      return;
    }

    // Broadcast user.banned event to Redis room
    await redis.publish(`chat:${channelId}`, JSON.stringify({
      t: 'user.banned',
      d: { channelId, userId },
    }));

    return { ok: true, userId };
  });

  // mod.slow
  gateway.dispatcher.register('mod.slow', async (conn: Conn, msg) => {
    const { channelId } = msg.d;
    const seconds = msg.d.seconds !== undefined ? msg.d.seconds : msg.d.slowSeconds;

    if (seconds === undefined || seconds < 0 || seconds > 3600) {
      conn.fail(msg.id, 'BAD_REQUEST', 'Invalid slow mode duration');
      return;
    }

    const allowed = await can(conn.user, channelId, 'chat:slow');
    if (!allowed) {
      conn.fail(msg.id, 'FORBIDDEN', 'You do not have permission to change slow mode');
      return;
    }

    await updateSlowMode(channelId, conn.user.id, seconds);

    // Broadcast system message for slow mode change
    const sysNotice = {
      mid: ulid(),
      channelId,
      user: {
        id: 'system',
        name: 'System',
        color: '#F59E0B',
        badges: [],
      },
      text: seconds > 0
        ? `Slow mode has been set to ${seconds}s.`
        : 'Slow mode has been disabled.',
      ts: Date.now(),
    };

    await redis.publish(`chat:${channelId}`, JSON.stringify({
      t: 'chat.message',
      d: sysNotice,
    }));

    return { ok: true, slowSeconds: seconds };
  });
}
