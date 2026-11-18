import { eq } from 'drizzle-orm';
import type { DtlsParameters, RtpCapabilities, RtpParameters } from 'mediasoup/node/lib/types.js';
import { channels, db } from '../db/index.js';
import type { WebSocketGateway, Conn } from '../realtime/index.js';
import { WsHandlerError } from '../realtime/index.js';
import { getRoomManager } from './index.js';
import type { ConnMediaState } from './types.js';
import {
  startPublisherSession,
  onVideoProducerCreated,
  onPublisherDisconnected,
  endStream,
} from './lifecycle.js';

function cleanupStaleConnMedia(
  conn: Conn,
  gateway: WebSocketGateway,
  roomManager: ReturnType<typeof getRoomManager>
): void {
  const oldState = conn.state.get('media') as ConnMediaState | undefined;
  if (!oldState) return;

  const oldRoom = roomManager.get(oldState.channelId);

  if (oldState.consumers) {
    for (const consumer of oldState.consumers.values()) {
      if (!consumer.closed) {
        consumer.close();
      }
    }
    oldState.consumers.clear();
  }

  if (oldState.producers) {
    for (const producer of oldState.producers.values()) {
      if (!producer.closed) {
        producer.close();
      }
      oldRoom?.producers.delete(producer.id);
    }
    oldState.producers.clear();
  }

  if (oldState.transports) {
    for (const entry of oldState.transports.values()) {
      if (!entry.transport.closed) {
        entry.transport.close();
      }
      oldRoom?.transports.delete(entry.transport.id);
    }
    oldState.transports.clear();
  }

  if (oldState.role === 'viewer') {
    oldRoom?.viewers.delete(conn.id);
  }

  if (oldState.channelId) {
    gateway.leaveRoom(conn, `media:${oldState.channelId}`);
  }
  conn.state.delete('media');
}

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

      try {
        startPublisherSession(channelId, conn.user.id, conn.id);
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'STREAM_ALREADY_LIVE') {
          throw new WsHandlerError(
            'ALREADY_PUBLISHING',
            'Another connection is already publishing to this channel'
          );
        }
        throw err;
      }

      // Clean up any stale media state on this connection before re-joining
      cleanupStaleConnMedia(conn, gateway, roomManager);

      const room = await roomManager.getOrCreate(channelId);

      // Clean up any stale producers left behind in the room by an earlier disconnected publisher
      for (const producer of room.producers.values()) {
        if (!producer.closed) {
          producer.close();
        }
      }
      room.producers.clear();

      room.publisher = {
        userId: conn.user.id,
        connId: conn.id,
      };

      const mediaState: ConnMediaState = {
        channelId,
        role: 'publisher',
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      conn.state.set('media', mediaState);

      gateway.joinRoom(conn, `media:${channelId}`);

      return {
        routerRtpCapabilities: room.router.rtpCapabilities,
      };
    } else {
      // Viewer join: allowed for guests; reply MEDIA_OFFLINE if there is no publisher with active producers
      const room = roomManager.get(channelId);
      const activeProducers = room
        ? Array.from(room.producers.values()).filter((p) => !p.closed)
        : [];

      if (!room || !room.publisher || activeProducers.length === 0) {
        throw new WsHandlerError('MEDIA_OFFLINE', 'Channel is not currently live');
      }

      // Clean up any stale media state on this connection before re-joining
      cleanupStaleConnMedia(conn, gateway, roomManager);

      const mediaState: ConnMediaState = {
        channelId,
        role: 'viewer',
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      conn.state.set('media', mediaState);

      const viewer = {
        connId: conn.id,
        userId: conn.user.guest ? undefined : conn.user.id,
        consumers: new Map(),
      };
      room.viewers.set(conn.id, viewer);

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

    if (mediaState.role === 'viewer') {
      const viewer = room.viewers.get(conn.id);
      if (viewer && direction === 'recv') {
        viewer.transport = transport;
      }
    }

    transport.observer.on('close', () => {
      mediaState.transports.delete(transport.id);
    });

    if (typeof transport.on === 'function') {
      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed' || dtlsState === 'failed') {
          console.warn(
            `[media] transport dtlsstatechange=${dtlsState} transportId=${transport.id} connId=${conn.id}`
          );
        }
      });

      transport.on('icestatechange', (iceState) => {
        if (iceState === 'disconnected') {
          console.warn(
            `[media] transport icestatechange=${iceState} transportId=${transport.id} connId=${conn.id}`
          );
        }
      });
    }

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

    if (kind === 'video') {
      await onVideoProducerCreated(mediaState.channelId, conn.id);
    }

    producer.on('transportclose', () => {
      room.producers.delete(producer.id);
      mediaState.producers.delete(producer.id);
    });

    producer.observer.on('close', () => {
      room.producers.delete(producer.id);
      mediaState.producers.delete(producer.id);
    });

    // Notify viewers of this room that a new producer is available
    gateway.broadcastToRoom(
      `media:${mediaState.channelId}`,
      'media.newProducer',
      {
        producerId: producer.id,
        kind: producer.kind,
      },
      conn.id
    );

    return { id: producer.id };
  });

  // 5. media.consume
  gateway.dispatcher.register('media.consume', async (conn: Conn, msg) => {
    const roomManager = getRoomManager();
    const { transportId, rtpCapabilities } = msg.d;
    const mediaState = conn.state.get('media') as ConnMediaState | undefined;

    if (!mediaState || !mediaState.channelId) {
      throw new WsHandlerError('BAD_REQUEST', 'No active media session');
    }

    const room = roomManager.get(mediaState.channelId);
    if (!room) {
      throw new WsHandlerError('MEDIA_OFFLINE', 'Media room not found');
    }

    const entry = mediaState.transports.get(transportId);
    if (!entry || entry.direction !== 'recv') {
      throw new WsHandlerError('BAD_REQUEST', 'Cannot consume on a non-receive transport');
    }

    const viewer = room.viewers.get(conn.id);
    const consumerList: Array<{
      id: string;
      producerId: string;
      kind: 'audio' | 'video';
      rtpParameters: unknown;
    }> = [];

    for (const producer of room.producers.values()) {
      if (producer.closed) continue;

      // Skip if viewer is already consuming this producer
      const alreadyConsuming = Array.from(mediaState.consumers.values()).some(
        (c) => c.producerId === producer.id && !c.closed
      );
      if (alreadyConsuming) continue;

      if (
        !room.router.canConsume({
          producerId: producer.id,
          rtpCapabilities: rtpCapabilities as unknown as RtpCapabilities,
        })
      ) {
        continue;
      }

      const consumer = await entry.transport.consume({
        producerId: producer.id,
        rtpCapabilities: rtpCapabilities as unknown as RtpCapabilities,
        paused: true,
      });

      mediaState.consumers.set(consumer.id, consumer);
      if (viewer) {
        viewer.consumers.set(consumer.id, consumer);
      }

      consumer.on('producerclose', () => {
        conn.send('media.consumerClosed', { consumerId: consumer.id });
        mediaState.consumers.delete(consumer.id);
        if (viewer) {
          viewer.consumers.delete(consumer.id);
        }
      });

      consumer.on('transportclose', () => {
        mediaState.consumers.delete(consumer.id);
        if (viewer) {
          viewer.consumers.delete(consumer.id);
        }
      });

      consumer.on('layerschange', (layers) => {
        conn.send('media.layers', {
          consumerId: consumer.id,
          layers: layers ?? null,
        });
      });

      consumer.observer.on('close', () => {
        mediaState.consumers.delete(consumer.id);
        if (viewer) {
          viewer.consumers.delete(consumer.id);
        }
      });

      consumerList.push({
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind as 'audio' | 'video',
        rtpParameters: consumer.rtpParameters,
      });
    }

    return consumerList;
  });

  // 6. media.resume
  gateway.dispatcher.register('media.resume', async (conn: Conn, msg) => {
    const { consumerIds } = msg.d;
    const mediaState = conn.state.get('media') as ConnMediaState | undefined;

    if (!mediaState || !mediaState.consumers) {
      throw new WsHandlerError('BAD_REQUEST', 'No active media session');
    }

    const resumed: string[] = [];

    for (const consumerId of consumerIds) {
      const consumer = mediaState.consumers.get(consumerId);
      if (consumer && !consumer.closed) {
        await consumer.resume();
        if (consumer.kind === 'video') {
          try {
            await consumer.requestKeyFrame();
          } catch {
            // Ignore key frame request errors if worker/consumer is busy
          }
        }
        resumed.push(consumerId);
      }
    }

    return { resumed };
  });

  // 7. media.setLayers
  gateway.dispatcher.register('media.setLayers', async (conn: Conn, msg) => {
    const { consumerId, spatialLayer, temporalLayer } = msg.d;
    const mediaState = conn.state.get('media') as ConnMediaState | undefined;

    if (!mediaState || !mediaState.consumers) {
      throw new WsHandlerError('BAD_REQUEST', 'No active media session');
    }

    if (mediaState.role !== 'viewer') {
      throw new WsHandlerError('FORBIDDEN', 'Only viewers can set preferred layers');
    }

    const consumer = mediaState.consumers.get(consumerId);
    if (!consumer || consumer.closed) {
      throw new WsHandlerError('NOT_FOUND', 'Consumer not found for this connection');
    }

    if (consumer.kind !== 'video') {
      throw new WsHandlerError('BAD_REQUEST', 'Preferred layers can only be set on video consumers');
    }

    await consumer.setPreferredLayers({
      spatialLayer,
      temporalLayer,
    });

    return { ok: true, consumerId, spatialLayer, temporalLayer };
  });

  // 8. media.restartIce
  gateway.dispatcher.register('media.restartIce', async (conn: Conn, msg) => {
    const { transportId } = msg.d;
    const mediaState = conn.state.get('media') as ConnMediaState | undefined;

    if (!mediaState || !mediaState.transports) {
      throw new WsHandlerError('BAD_REQUEST', 'No active media session');
    }

    const entry = mediaState.transports.get(transportId);
    if (!entry || entry.transport.closed) {
      throw new WsHandlerError('NOT_FOUND', 'Transport not found');
    }

    const iceParameters = await entry.transport.restartIce();
    return { iceParameters };
  });

  // 9. media.end
  gateway.dispatcher.register('media.end', async (conn: Conn, msg) => {
    const mediaState = conn.state.get('media') as ConnMediaState | undefined;
    const channelId = msg.d?.channelId || mediaState?.channelId;

    if (!channelId) {
      throw new WsHandlerError('BAD_REQUEST', 'Channel ID is required to end stream');
    }

    if (conn.user.guest) {
      throw new WsHandlerError('FORBIDDEN', 'Authentication required to end stream');
    }

    // Verify channel ownership
    const [channel] = await db
      .select({ id: channels.id, ownerId: channels.ownerId })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

    if (!channel || channel.ownerId !== conn.user.id) {
      throw new WsHandlerError('FORBIDDEN', 'Only the channel owner can end the stream');
    }

    await endStream(channelId, gateway, 'manual_end');
    return { ok: true };
  });

  // 8. Cleanup hook
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

      // Notify lifecycle state machine (starts 15s grace timer for LIVE stream)
      await onPublisherDisconnected(mediaState.channelId, conn.id, gateway);
    } else if (mediaState.role === 'viewer') {
      // Close viewer consumers
      if (mediaState.consumers) {
        for (const consumer of mediaState.consumers.values()) {
          if (!consumer.closed) {
            consumer.close();
          }
        }
        mediaState.consumers.clear();
      }

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
