import { redisSub } from '../lib/redis.js';
import type { Conn } from '../realtime/conn.js';
import type { WebSocketGateway } from '../realtime/gateway.js';

/**
 * Automatically subscribes authenticated WebSocket connections to their personal
 * Redis channel `user:{userId}` on connect and forwards `notify.*` / `stream.*`
 * events directly to the user's open sockets.
 */
export function registerNotificationHandlers(gateway: WebSocketGateway): void {
  const localUserRefCounts = new Map<string, number>();

  const onRedisMessage = (channel: string, messageStr: string) => {
    if (channel.startsWith('user:')) {
      gateway.broadcastRawToRoom(channel, messageStr);
    }
  };

  redisSub.on('message', onRedisMessage);

  gateway.onConnect(async (conn: Conn) => {
    if (conn.user.guest) return;

    const channel = `user:${conn.user.id}`;
    gateway.joinRoom(conn, channel);

    const prevCount = localUserRefCounts.get(channel) ?? 0;
    localUserRefCounts.set(channel, prevCount + 1);

    if (prevCount === 0) {
      try {
        await redisSub.subscribe(channel);
      } catch {
        // Ignore transient subscribe errors
      }
    }
  });

  gateway.onCleanup(async (conn: Conn) => {
    if (conn.user.guest) return;

    const channel = `user:${conn.user.id}`;
    gateway.leaveRoom(conn, channel);

    const prevCount = localUserRefCounts.get(channel) ?? 0;
    if (prevCount <= 1) {
      localUserRefCounts.delete(channel);
      try {
        await redisSub.unsubscribe(channel);
      } catch {
        // Ignore transient unsubscribe errors
      }
    } else {
      localUserRefCounts.set(channel, prevCount - 1);
    }
  });
}
