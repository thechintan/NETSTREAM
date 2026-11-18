/* eslint-disable @typescript-eslint/no-explicit-any */
import EventEmitter from 'node:events';
import type { RtpCapabilities } from 'mediasoup/node/lib/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Conn } from '../realtime/conn.js';
import { WsHandlerError } from '../realtime/dispatcher.js';
import { WebSocketGateway } from '../realtime/gateway.js';
import { registerMediaHandlers } from './handlers.js';
import * as mediaModule from './index.js';
import type { RoomManager } from './room-manager.js';
import type { Room } from './types.js';

describe('Task 13: Viewer Signaling Unit Tests with Mocks', () => {
  let gateway: WebSocketGateway;
  let mockRoom: Room;
  let mockRoomManager: Partial<RoomManager>;

  let mockAudioProducer: any;
  let mockVideoProducer: any;
  let mockConsumer: any;
  let mockRecvTransport: any;

  const channelId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    mockAudioProducer = {
      id: 'producer-audio-1',
      kind: 'audio',
      closed: false,
      close: vi.fn(() => { mockAudioProducer.closed = true; }),
      on: vi.fn(),
      observer: new EventEmitter(),
    };

    mockVideoProducer = {
      id: 'producer-video-1',
      kind: 'video',
      closed: false,
      close: vi.fn(() => { mockVideoProducer.closed = true; }),
      on: vi.fn(),
      observer: new EventEmitter(),
    };

    mockConsumer = {
      id: 'consumer-1',
      kind: 'video',
      producerId: 'producer-video-1',
      rtpParameters: { codecs: [] },
      closed: false,
      resume: vi.fn(async () => {}),
      requestKeyFrame: vi.fn(async () => {}),
      close: vi.fn(() => { mockConsumer.closed = true; }),
      on: vi.fn(),
      observer: new EventEmitter(),
    };

    mockRecvTransport = {
      id: 'recv-transport-1',
      closed: false,
      connect: vi.fn(async () => {}),
      consume: vi.fn(async () => mockConsumer),
      close: vi.fn(() => { mockRecvTransport.closed = true; }),
      observer: new EventEmitter(),
    };

    mockRoom = {
      channelId,
      router: {
        id: 'router-1',
        rtpCapabilities: { codecs: [{ mimeType: 'video/VP8' }] } as unknown as RtpCapabilities,
        canConsume: vi.fn(({ producerId }: { producerId: string }) => producerId === 'producer-video-1'),
        closed: false,
        close: vi.fn(),
      } as unknown as Room['router'],
      publisher: { userId: 'pub-user-1', connId: 'pub-conn-1' },
      producers: new Map([
        ['producer-audio-1', mockAudioProducer],
        ['producer-video-1', mockVideoProducer],
      ]),
      viewers: new Map(),
      transports: new Map(),
    };

    mockRoomManager = {
      getOrCreate: vi.fn(async () => mockRoom),
      get: vi.fn((id: string) => (id === channelId ? mockRoom : undefined)),
      createWebRtcTransport: vi.fn(async () => ({
        transport: mockRecvTransport as any,
        params: {
          id: mockRecvTransport.id,
          iceParameters: {} as any,
          iceCandidates: [],
          dtlsParameters: {} as any,
        },
        clientParams: {
          id: mockRecvTransport.id,
          iceParameters: {} as any,
          iceCandidates: [],
          dtlsParameters: {} as any,
        },
        id: mockRecvTransport.id,
        iceParameters: {} as any,
        iceCandidates: [],
        dtlsParameters: {} as any,
      })),
    };

    vi.spyOn(mediaModule, 'getRoomManager').mockReturnValue(mockRoomManager as RoomManager);

    gateway = new WebSocketGateway({
      allowedOrigin: 'http://localhost:5173',
      heartbeatIntervalMs: 100000,
    });

    registerMediaHandlers(gateway);
  });

  function createMockConn(user: { id: string; username: string; guest: boolean }): Conn {
    const mockWs = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    } as any;
    return new Conn(mockWs, user);
  }

  it('1. Offline join: rejects viewer with MEDIA_OFFLINE when channel is not streaming or has no producers', async () => {
    const conn1 = createMockConn({ id: 'guest-1', username: 'guest_1', guest: true });
    // Case A: Room doesn't exist
    (mockRoomManager.get as any).mockReturnValueOnce(undefined);

    await expect(
      (gateway.dispatcher as any).handlers.get('media.join')(conn1, {
        t: 'media.join',
        d: { channelId, role: 'viewer' },
      })
    ).rejects.toThrowError(WsHandlerError);

    try {
      (mockRoomManager.get as any).mockReturnValueOnce(undefined);
      await (gateway.dispatcher as any).handlers.get('media.join')(conn1, {
        t: 'media.join',
        d: { channelId, role: 'viewer' },
      });
    } catch (err) {
      expect((err as WsHandlerError).code).toBe('MEDIA_OFFLINE');
    }

    // Case B: Room has no active producers
    mockRoom.producers.clear();
    const conn2 = createMockConn({ id: 'guest-2', username: 'guest_2', guest: true });

    try {
      await (gateway.dispatcher as any).handlers.get('media.join')(conn2, {
        t: 'media.join',
        d: { channelId, role: 'viewer' },
      });
    } catch (err) {
      expect((err as WsHandlerError).code).toBe('MEDIA_OFFLINE');
    }
  });

  it('2. Viewer join: joins successfully for guests when channel is live', async () => {
    const conn = createMockConn({ id: 'guest-1', username: 'guest_1', guest: true });

    const res = await (gateway.dispatcher as any).handlers.get('media.join')(conn, {
      t: 'media.join',
      d: { channelId, role: 'viewer' },
    });

    expect(res.routerRtpCapabilities).toBeDefined();
    expect(mockRoom.viewers.has(conn.id)).toBe(true);
  });

  it('3. Consume only compatible producers: filters by router.canConsume and returns consumer list', async () => {
    const conn = createMockConn({ id: 'guest-1', username: 'guest_1', guest: true });

    // Join
    await (gateway.dispatcher as any).handlers.get('media.join')(conn, {
      t: 'media.join',
      d: { channelId, role: 'viewer' },
    });

    // Create recv transport
    await (gateway.dispatcher as any).handlers.get('media.createTransport')(conn, {
      t: 'media.createTransport',
      d: { direction: 'recv' },
    });

    // Consume
    const consumers = await (gateway.dispatcher as any).handlers.get('media.consume')(conn, {
      t: 'media.consume',
      d: {
        transportId: mockRecvTransport.id,
        rtpCapabilities: { codecs: [] },
      },
    });

    // canConsume returns true only for mockVideoProducer ('producer-video-1')
    expect(mockRecvTransport.consume).toHaveBeenCalledTimes(1);
    expect(mockRecvTransport.consume).toHaveBeenCalledWith(
      expect.objectContaining({
        producerId: 'producer-video-1',
        paused: true,
      })
    );

    expect(consumers).toEqual([
      expect.objectContaining({
        id: 'consumer-1',
        producerId: 'producer-video-1',
        kind: 'video',
      }),
    ]);
  });

  it('4. Resume: resumes consumer and requests keyframe for video', async () => {
    const conn = createMockConn({ id: 'guest-1', username: 'guest_1', guest: true });

    // Setup state directly
    const mediaState = {
      channelId,
      role: 'viewer' as const,
      transports: new Map([[mockRecvTransport.id, { transport: mockRecvTransport, direction: 'recv' as const }]]),
      producers: new Map(),
      consumers: new Map([[mockConsumer.id, mockConsumer]]),
    };
    conn.state.set('media', mediaState);

    const res = await (gateway.dispatcher as any).handlers.get('media.resume')(conn, {
      t: 'media.resume',
      d: { consumerIds: [mockConsumer.id] },
    });

    expect(mockConsumer.resume).toHaveBeenCalled();
    expect(mockConsumer.requestKeyFrame).toHaveBeenCalled();
    expect(res).toEqual({ resumed: [mockConsumer.id] });
  });

  it('5. Cleanup: closing viewer connection closes its consumers and transports', async () => {
    const conn = createMockConn({ id: 'guest-1', username: 'guest_1', guest: true });

    const mediaState = {
      channelId,
      role: 'viewer' as const,
      transports: new Map([[mockRecvTransport.id, { transport: mockRecvTransport, direction: 'recv' as const }]]),
      producers: new Map(),
      consumers: new Map([[mockConsumer.id, mockConsumer]]),
    };
    conn.state.set('media', mediaState);
    mockRoom.viewers.set(conn.id, {
      connId: conn.id,
      consumers: new Map([[mockConsumer.id, mockConsumer]]),
    });

    // Run registered cleanup hooks
    for (const hook of (gateway as any).cleanupHooks) {
      await hook(conn);
    }

    expect(mockConsumer.close).toHaveBeenCalled();
    expect(mockRecvTransport.close).toHaveBeenCalled();
    expect(mockRoom.viewers.has(conn.id)).toBe(false);
  });
});
