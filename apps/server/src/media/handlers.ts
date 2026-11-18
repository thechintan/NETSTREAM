import { eq } from 'drizzle-orm';
import type { DtlsParameters, RtpParameters } from 'mediasoup/node/lib/types.js';
import { channels, db } from '../db/index.js';
import type { WebSocketGateway, Conn } from '../realtime/index.js';
import { WsHandlerError } from '../realtime/index.js';
import { getRoomManager } from './index.js';
import type { ConnMediaState } from './types.js';

export function registerMediaHandlers(gateway: WebSocketGateway): void {
  // 1. media.join
  gateway.dispatcher.register('media.join', async (conn: Conn, msg) => {
    const roomManager = getRoomManager();
    const { channelId, role } = msg.d;

    if (role === 'publisher') {
      if (conn.user.guest) {
        throw new WsHandlerError('FORBIDDEN', 'Authentication required to publish');
      }

      // Check ownership
      const [channel] = await db
        .select({ id: channels.id, ownerId: channels.ownerId })
        .from(channels)
        .where(eq(channels.id, channelId))
        .limit(1);

      if (!channel) {
        throw new WsHandlerError('NOT_FOUND', 'Channel not found');
      }

      if (channel.ownerId !== conn.user.id) {
        throw new WsHandlerError('FORBIDDEN', 'Only the channel owner can publish');
      }

      const room = await roomManager.getOrCreate(channelId);

      if (room.publisher && room.publisher.connId !== conn.id) {
        throw new WsHandlerError(
          'ALREADY_PUBLISHING',
          'Another connection is already publishing to this channel'
        );
      }

      room.publisher = {
        userId: conn.user.id,
        connId: conn.id,
      };

      const mediaState: ConnMediaState = {
        channelId,
        role: 'publisher',
        transports: new Map(),
        producers: new Map(),
      };
      conn.state.set('media', mediaState);

      gateway.joinRoom(conn, `media:${channelId}`);

      return {
        routerRtpCapabilities: room.router.rtpCapabilities,
      };
    } else {
      // Viewer join
      const room = await roomManager.getOrCreate(channelId);

      const mediaState: ConnMediaState = {
        channelId,
        role: 'viewer',
        transports: new Map(),
        producers: new Map(),
      };
      conn.state.set('media', mediaState);

      gateway.joinRoom(conn, `media:${channelId}`);

      return {
        routerRtpCapabilities: room.router.rtpCapabilities,
      };
    }
  });

  // 2. media.createTransport
  gateway.dispatcher.register('media.createTransport', async (conn: Conn, msg) => {
    const roomManager = getRoomManager();
    const { direction } = msg.d;
    const mediaState = conn.state.get('media') as ConnMediaState | undefined;

    if (!mediaState || !mediaState.channelId) {
      throw new WsHandlerError('BAD_REQUEST', 'Must join a media room before creating a transport');
    }

    if (mediaState.transports.size >= 2) {
      throw new WsHandlerError(
        'TOO_MANY_TRANSPORTS',
        'Maximum of 2 transports allowed per connection'
      );
    }

    const room = roomManager.get(mediaState.channelId);
    if (!room) {
      throw new WsHandlerError('NOT_FOUND', 'Media room not found');
    }

    const { transport, params } = await roomManager.createWebRtcTransport(room);

    mediaState.transports.set(transport.id, {
      transport,
      direction,
    });

    transport.observer.on('close', () => {
      mediaState.transports.delete(transport.id);
    });

    return params;
  });

  // 3. media.connectTransport
  gateway.dispatcher.register('media.connectTransport', async (conn: Conn, msg) => {
    const { transportId, dtlsParameters } = msg.d;
    const mediaState = conn.state.get('media') as ConnMediaState | undefined;

    if (!mediaState) {
      throw new WsHandlerError('BAD_REQUEST', 'No active media session');
    }

    const entry = mediaState.transports.get(transportId);
    if (!entry) {
      throw new WsHandlerError('NOT_FOUND', 'Transport not found');
    }

    await entry.transport.connect({
      dtlsParameters: dtlsParameters as unknown as DtlsParameters,
    });

    return { connected: true };
  });

  // 4. media.produce
  gateway.dispatcher.register('media.produce', async (conn: Conn, msg) => {
    const roomManager = getRoomManager();
    const { transportId, kind, rtpParameters, appData } = msg.d;
    const mediaState = conn.state.get('media') as ConnMediaState | undefined;

    if (!mediaState || !mediaState.channelId) {
      throw new WsHandlerError('BAD_REQUEST', 'No active media session');
    }

    const room = roomManager.get(mediaState.channelId);
    if (!room) {
      throw new WsHandlerError('NOT_FOUND', 'Media room not found');
    }

    if (mediaState.role !== 'publisher' || room.publisher?.connId !== conn.id) {
      throw new WsHandlerError('FORBIDDEN', 'Only the channel publisher can produce');
    }

    const entry = mediaState.transports.get(transportId);
    if (!entry || entry.direction !== 'send') {
      throw new WsHandlerError('BAD_REQUEST', 'Cannot produce on a non-send transport');
    }

    // Max one audio and one video producer
    for (const producer of room.producers.values()) {
      if (producer.kind === kind && !producer.closed) {
        throw new WsHandlerError(
          'PRODUCER_EXISTS',
          `A ${kind} producer already exists for this channel`
        );
      }
    }

    const producer = await entry.transport.produce({
      kind,
      rtpParameters: rtpParameters as unknown as RtpParameters,
      appData,
    });

    room.producers.set(producer.id, producer);
    mediaState.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
      room.producers.delete(producer.id);
      mediaState.producers.delete(producer.id);
    });

    producer.observer.on('close', () => {
      room.producers.delete(producer.id);
      mediaState.producers.delete(producer.id);
    });

    return { id: producer.id };
  });

  // 5. Cleanup hook
  gateway.onCleanup(async (conn: Conn) => {
    let roomManager;
    try {
      roomManager = getRoomManager();
    } catch {
      return;
    }

    const mediaState = conn.state.get('media') as ConnMediaState | undefined;
    if (!mediaState || !mediaState.channelId) {
      return;
    }

    const room = roomManager.get(mediaState.channelId);
    if (!room) {
      return;
    }

    if (mediaState.role === 'publisher' && room.publisher?.connId === conn.id) {
      // Close all producers for this publisher
      for (const producer of mediaState.producers.values()) {
        if (!producer.closed) {
          producer.close();
        }
        room.producers.delete(producer.id);
      }
      mediaState.producers.clear();

      // Close all transports for this publisher
      for (const entry of mediaState.transports.values()) {
        if (!entry.transport.closed) {
          entry.transport.close();
        }
        room.transports.delete(entry.transport.id);
      }
      mediaState.transports.clear();

      // Clear publisher
      room.publisher = undefined;
    } else if (mediaState.role === 'viewer') {
      // Close viewer transports
      for (const entry of mediaState.transports.values()) {
        if (!entry.transport.closed) {
          entry.transport.close();
        }
        room.transports.delete(entry.transport.id);
      }
      mediaState.transports.clear();
      room.viewers.delete(conn.id);
    }
  });
}
