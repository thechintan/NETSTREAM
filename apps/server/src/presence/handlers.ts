import { StreamLivePayload, StreamOfflinePayload } from '@netstream/shared';
import { redis, redisSub } from '../lib/redis.js';
import { Conn } from '../realtime/conn.js';
import { WebSocketGateway } from '../realtime/gateway.js';
import { removeViewer, touchViewer } from './service.js';

let directorySubscribed = false;

export function registerPresenceHandlers(gateway: WebSocketGateway): void {
  // Listen for Redis pub/sub messages on directory:live
  const onRedisMessage = (channel: string, messageStr: string) => {
    if (channel === 'directory:live') {
      gateway.broadcastRawToRoom('directory:live', messageStr);
    }
  };

  redisSub.on('message', onRedisMessage);

  // Heartbeat hook: refresh score on each heartbeat/pong for viewing connections
  gateway.onHeartbeat(async (conn: Conn) => {
    const channels = new Set<string>();
    for (const room of conn.rooms) {
      if (room.startsWith('chat:')) {
        channels.add(room.slice(5));
      }
    }
    for (const [key] of conn.state) {
      if (key.startsWith('viewing:')) {
        channels.add(key.slice(8));
      }
    }

    for (const channelId of channels) {
      try {
        await touchViewer(channelId, conn.id);
      } catch {
        // Ignore error during heartbeat refresh
      }
    }
  });

  // Cleanup hook: remove viewer on connection close
  gateway.onCleanup(async (conn: Conn) => {
    const channels = new Set<string>();
    for (const room of conn.rooms) {
      if (room.startsWith('chat:')) {
        channels.add(room.slice(5));
      }
    }
    for (const [key] of conn.state) {
      if (key.startsWith('viewing:')) {
        channels.add(key.slice(8));
      }
    }

    for (const channelId of channels) {
      try {
        await removeViewer(channelId, conn.id);
      } catch {
        // Ignore error during cleanup
      }
    }
  });

  // user.subscribe handler
  gateway.dispatcher.register('user.subscribe', async (conn: Conn, msg) => {
    const { topics } = msg.d;
    const subscribedTopics: string[] = [];

    if (topics && topics.includes('live')) {
      gateway.joinRoom(conn, 'directory:live');
      subscribedTopics.push('live');

      if (!directorySubscribed) {
        directorySubscribed = true;
        await redisSub.subscribe('directory:live');
      }
    }

    return { ok: true, subscribed: subscribedTopics };
  });
}

/**
 * Publishes a stream.live event to the global live directory.
 */
export async function publishStreamLive(payload: StreamLivePayload): Promise<void> {
  const messageStr = JSON.stringify({
    t: 'stream.live',
    d: payload,
  });
  await redis.publish('directory:live', messageStr);
}

/**
 * Publishes a stream.offline event to the global live directory.
 */
export async function publishStreamOffline(payload: StreamOfflinePayload): Promise<void> {
  const messageStr = JSON.stringify({
    t: 'stream.offline',
    d: payload,
  });
  await redis.publish('directory:live', messageStr);
}
