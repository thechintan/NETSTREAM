/* eslint-disable @typescript-eslint/no-explicit-any */
import EventEmitter from 'node:events';
import type { RtpCapabilities } from 'mediasoup/node/lib/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/index.js';
import { Conn } from '../realtime/conn.js';
import { WsHandlerError } from '../realtime/dispatcher.js';
import { WebSocketGateway } from '../realtime/gateway.js';
import { registerMediaHandlers } from './handlers.js';
import { resetLifecycleForTest } from './lifecycle.js';
import * as mediaModule from './index.js';
import type { RoomManager } from './room-manager.js';
import type { Room } from './types.js';

describe('Tasks 15 & 16: media.setLayers, media.restartIce & Stale-State Cleanup', () => {
  let gateway: WebSocketGateway;
  let mockRoom: Room;
  let mockRoomManager: Partial<RoomManager>;
  let mockVideoProducer: any;
  let mockVideoConsumer: any;
  let mockAudioConsumer: any;
  let mockTransport: any;

  const channelId = '11111111-1111-1111-1111-111111111111';
  const ownerId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    resetLifecycleForTest();

    mockVideoProducer = {
      id: 'producer-video-1',
      kind: 'video',
      closed: false,
      close: vi.fn(() => {
        mockVideoProducer.closed = true;
      }),
      on: vi.fn(),
      observer: new EventEmitter(),
    };

    const consumerEvents = new EventEmitter();
    mockVideoConsumer = {
      id: 'consumer-video-1',
      kind: 'video',
      producerId: 'producer-video-1',
      rtpParameters: { codecs: [] },
      closed: false,
      setPreferredLayers: vi.fn(async () => {}),
      close: vi.fn(() => {
        mockVideoConsumer.closed = true;
      }),
      on: vi.fn((ev: string, cb: (...args: any[]) => void) => consumerEvents.on(ev, cb)),
      emit: (ev: string, ...args: any[]) => consumerEvents.emit(ev, ...args),
      observer: new EventEmitter(),
    };

    mockAudioConsumer = {
      id: 'consumer-audio-1',
      kind: 'audio',
      producerId: 'producer-audio-1',
      rtpParameters: { codecs: [] },
      closed: false,
      setPreferredLayers: vi.fn(async () => {}),
      close: vi.fn(() => {
        mockAudioConsumer.closed = true;
      }),
      on: vi.fn(),
      observer: new EventEmitter(),
    };

    mockTransport = {
      id: 'transport-1',
      closed: false,
      connect: vi.fn(async () => {}),
      consume: vi.fn(async () => mockVideoConsumer),
      restartIce: vi.fn(async () => ({
        usernameFragment: 'new-ufrag',
        password: 'new-pwd',
        iceLite: true,
      })),
      close: vi.fn(() => {
        mockTransport.closed = true;
      }),
      on: vi.fn(),
      observer: new EventEmitter(),
    };

    mockRoom = {
      channelId,
      router: {
        id: 'router-1',
        rtpCapabilities: { codecs: [{ mimeType: 'video/VP8' }] } as unknown as RtpCapabilities,
        canConsume: vi.fn(() => true),
        closed: false,
        close: vi.fn(),
      } as unknown as Room['router'],
      publisher: { userId: ownerId, connId: 'pub-conn-1' },
      producers: new Map([['producer-video-1', mockVideoProducer]]),
      viewers: new Map(),
      transports: new Map([['transport-1', mockTransport]]),
    };

    mockRoomManager = {
      getOrCreate: vi.fn(async () => mockRoom),
      get: vi.fn((id: string) => (id === channelId ? mockRoom : undefined)),
      createWebRtcTransport: vi.fn(async () => ({
        transport: mockTransport as any,
        params: {
          id: mockTransport.id,
          iceParameters: {} as any,
          iceCandidates: [],
          dtlsParameters: {} as any,
        },
        clientParams: {
          id: mockTransport.id,
          iceParameters: {} as any,
          iceCandidates: [],
          dtlsParameters: {} as any,
        },
        id: mockTransport.id,
        iceParameters: {} as any,
        iceCandidates: [],
        dtlsParameters: {} as any,
      })),
    };

    vi.spyOn(mediaModule, 'getRoomManager').mockReturnValue(mockRoomManager as RoomManager);

    const mockSelectChain: any = {
      from: () => mockSelectChain,
      innerJoin: () => mockSelectChain,
      leftJoin: () => mockSelectChain,
      where: () => mockSelectChain,
      limit: async () => [{ id: channelId, ownerId }],
    };
    vi.spyOn(db, 'select').mockImplementation((() => mockSelectChain) as any);

    gateway = new WebSocketGateway({
      allowedOrigin: 'http://localhost:5173',
      heartbeatIntervalMs: 100000,
    });

    registerMediaHandlers(gateway);
  });

  function createMockConn(user: { id: string; username: string; guest: boolean }): Conn {
    const mockWs = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    } as any;
    return new Conn(mockWs, user);
  }

  it('1. media.setLayers: allows viewer to set layers on their own video consumer and rejects audio/foreign/publisher', async () => {
    const viewerConn = createMockConn({ id: 'v1', username: 'viewer1', guest: true });
    viewerConn.state.set('media', {
      channelId,
      role: 'viewer',
      transports: new Map(),
      producers: new Map(),
      consumers: new Map([
        [mockVideoConsumer.id, mockVideoConsumer],
        [mockAudioConsumer.id, mockAudioConsumer],
      ]),
    });

    // Valid video layer change
    const res = await (gateway.dispatcher as any).handlers.get('media.setLayers')(viewerConn, {
      t: 'media.setLayers',
      d: { consumerId: mockVideoConsumer.id, spatialLayer: 0, temporalLayer: 2 },
    });
    expect(mockVideoConsumer.setPreferredLayers).toHaveBeenCalledWith({
      spatialLayer: 0,
      temporalLayer: 2,
    });
    expect(res).toMatchObject({ ok: true, spatialLayer: 0, temporalLayer: 2 });

    // Reject audio consumer
    await expect(
      (gateway.dispatcher as any).handlers.get('media.setLayers')(viewerConn, {
        t: 'media.setLayers',
        d: { consumerId: mockAudioConsumer.id, spatialLayer: 0 },
      })
    ).rejects.toThrowError(WsHandlerError);

    // Reject consumer belonging to another connection
    const otherViewer = createMockConn({ id: 'v2', username: 'viewer2', guest: true });
    otherViewer.state.set('media', {
      channelId,
      role: 'viewer',
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });
    await expect(
      (gateway.dispatcher as any).handlers.get('media.setLayers')(otherViewer, {
        t: 'media.setLayers',
        d: { consumerId: mockVideoConsumer.id, spatialLayer: 1 },
      })
    ).rejects.toThrowError(WsHandlerError);

    // Reject publisher role
    const pubConn = createMockConn({ id: ownerId, username: 'owner', guest: false });
    pubConn.state.set('media', {
      channelId,
      role: 'publisher',
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });
    try {
      await (gateway.dispatcher as any).handlers.get('media.setLayers')(pubConn, {
        t: 'media.setLayers',
        d: { consumerId: mockVideoConsumer.id, spatialLayer: 1 },
      });
    } catch (err) {
      expect((err as WsHandlerError).code).toBe('FORBIDDEN');
    }
  });

  it('2. media.setLayers: rejects invalid spatialLayer via Zod dispatcher validation', async () => {
    const viewerConn = createMockConn({ id: 'v1', username: 'viewer1', guest: true });
    await gateway.dispatcher.dispatch(
      viewerConn,
      JSON.stringify({
        t: 'media.setLayers',
        id: 'req-bad-layer',
        d: { consumerId: 'c1', spatialLayer: 9 },
      })
    );

    expect(viewerConn.ws.send).toHaveBeenCalledWith(
      expect.stringContaining('"code":"BAD_REQUEST"')
    );
  });

  it('3. consumer layerschange forwards media.layers push event to viewer', async () => {
    const viewerConn = createMockConn({ id: 'v1', username: 'viewer1', guest: true });

    await (gateway.dispatcher as any).handlers.get('media.join')(viewerConn, {
      t: 'media.join',
      d: { channelId, role: 'viewer' },
    });
    await (gateway.dispatcher as any).handlers.get('media.createTransport')(viewerConn, {
      t: 'media.createTransport',
      d: { direction: 'recv' },
    });
    await (gateway.dispatcher as any).handlers.get('media.consume')(viewerConn, {
      t: 'media.consume',
      d: { transportId: mockTransport.id, rtpCapabilities: { codecs: [] } },
    });

    // Simulate mediasoup layerschange event
    mockVideoConsumer.emit('layerschange', { spatialLayer: 1, temporalLayer: 2 });

    expect(viewerConn.ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        t: 'media.layers',
        d: {
          consumerId: mockVideoConsumer.id,
          layers: { spatialLayer: 1, temporalLayer: 2 },
        },
      })
    );
  });

  it('4. media.restartIce: calls transport.restartIce and returns new iceParameters', async () => {
    const conn = createMockConn({ id: 'v1', username: 'viewer1', guest: true });
    conn.state.set('media', {
      channelId,
      role: 'viewer',
      transports: new Map([[mockTransport.id, { transport: mockTransport, direction: 'recv' }]]),
      producers: new Map(),
      consumers: new Map(),
    });

    const res = await (gateway.dispatcher as any).handlers.get('media.restartIce')(conn, {
      t: 'media.restartIce',
      d: { transportId: mockTransport.id },
    });

    expect(mockTransport.restartIce).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      iceParameters: {
        usernameFragment: 'new-ufrag',
        password: 'new-pwd',
        iceLite: true,
      },
    });

    // Unknown transportId rejected with NOT_FOUND
    try {
      await (gateway.dispatcher as any).handlers.get('media.restartIce')(conn, {
        t: 'media.restartIce',
        d: { transportId: 'non-existent' },
      });
    } catch (err) {
      expect((err as WsHandlerError).code).toBe('NOT_FOUND');
    }
  });

  it('5. Stale-state cleanup on re-join: closes old transports and consumers idempotently', async () => {
    const viewerConn = createMockConn({ id: 'v1', username: 'viewer1', guest: true });

    // Pre-populate stale media state on connection
    viewerConn.state.set('media', {
      channelId,
      role: 'viewer',
      transports: new Map([[mockTransport.id, { transport: mockTransport, direction: 'recv' }]]),
      producers: new Map(),
      consumers: new Map([[mockVideoConsumer.id, mockVideoConsumer]]),
    });

    // Re-join as viewer on same connection
    const res = await (gateway.dispatcher as any).handlers.get('media.join')(viewerConn, {
      t: 'media.join',
      d: { channelId, role: 'viewer' },
    });

    expect(mockVideoConsumer.close).toHaveBeenCalledTimes(1);
    expect(mockTransport.close).toHaveBeenCalledTimes(1);
    expect(res.routerRtpCapabilities).toBeDefined();
    expect((viewerConn.state.get('media') as any).transports.size).toBe(0);
    expect((viewerConn.state.get('media') as any).consumers.size).toBe(0);
  });
});
