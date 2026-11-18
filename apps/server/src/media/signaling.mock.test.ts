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

describe('Task 12: Handlers Unit Tests with Mocked mediasoup Objects', () => {
  let gateway: WebSocketGateway;
  let mockRoom: Room;
  let mockRoomManager: Partial<RoomManager>;
  let mockProducer: { id: string; kind: string; closed: boolean; close: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; observer: EventEmitter };
  let mockTransport: { id: string; closed: boolean; connect: ReturnType<typeof vi.fn>; produce: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; observer: EventEmitter };

  const channelId = '11111111-1111-1111-1111-111111111111';
  const ownerId = '22222222-2222-2222-2222-222222222222';
  const nonOwnerId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    mockProducer = {
      id: 'producer-1',
      kind: 'video',
      closed: false,
      close: vi.fn(() => { mockProducer.closed = true; }),
      on: vi.fn(),
      observer: new EventEmitter(),
    };

    mockTransport = {
      id: 'transport-1',
      closed: false,
      connect: vi.fn(),
      produce: vi.fn(async () => mockProducer),
      close: vi.fn(() => { mockTransport.closed = true; }),
      observer: new EventEmitter(),
    };

    mockRoom = {
      channelId,
      router: {
        id: 'router-1',
        rtpCapabilities: { codecs: [{ mimeType: 'audio/opus' }] } as unknown as RtpCapabilities,
        closed: false,
        close: vi.fn(),
      } as unknown as Room['router'],
      publisher: undefined,
      producers: new Map(),
      viewers: new Map(),
      transports: new Map(),
    };

    mockRoomManager = {
      getOrCreate: vi.fn(async () => mockRoom),
      get: vi.fn((id: string) => (id === channelId ? mockRoom : undefined)),
      createWebRtcTransport: vi.fn(async () => ({
        transport: mockTransport as unknown as any,
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

    gateway = new WebSocketGateway({
      allowedOrigin: 'http://localhost:5173',
      heartbeatIntervalMs: 100000,
    });

    // Mock db.select, insert, update
    const mockSelectChain: any = {
      from: () => mockSelectChain,
      innerJoin: () => mockSelectChain,
      leftJoin: () => mockSelectChain,
      where: () => mockSelectChain,
      limit: async () => [{ id: channelId, ownerId, name: 'test', title: 'test', ownerUsername: 'test' }],
      then: (resolve: any) => resolve([{ id: channelId, ownerId, name: 'test', title: 'test', ownerUsername: 'test' }]),
    };
    vi.spyOn(db, 'select').mockImplementation((() => mockSelectChain) as any);
    vi.spyOn(db, 'insert').mockImplementation((() => ({
      values: () => ({
        returning: async () => [{ id: 'stream-1' }],
      }),
    })) as any);
    vi.spyOn(db, 'update').mockImplementation((() => ({
      set: () => ({
        where: async () => [],
      }),
    })) as any);

    resetLifecycleForTest();
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

  it('1. Non-owner is rejected when joining as publisher', async () => {
    const conn = createMockConn({ id: nonOwnerId, username: 'non_owner', guest: false });

    await expect(
      (gateway.dispatcher as any).handlers.get('media.join')(conn, {
        t: 'media.join',
        d: { channelId, role: 'publisher' },
      })
    ).rejects.toThrowError(WsHandlerError);

    try {
      await (gateway.dispatcher as any).handlers.get('media.join')(conn, {
        t: 'media.join',
        d: { channelId, role: 'publisher' },
      });
    } catch (err) {
      expect((err as WsHandlerError).code).toBe('FORBIDDEN');
    }
  });

  it('2. Second publisher is rejected with ALREADY_PUBLISHING', async () => {
    const conn1 = createMockConn({ id: ownerId, username: 'owner', guest: false });
    const conn2 = createMockConn({ id: ownerId, username: 'owner', guest: false });

    // 1st publisher joins
    const res1 = await (gateway.dispatcher as any).handlers.get('media.join')(conn1, {
      t: 'media.join',
      d: { channelId, role: 'publisher' },
    });
    expect(res1.routerRtpCapabilities).toBeDefined();
    expect(mockRoom.publisher?.connId).toBe(conn1.id);

    // 2nd publisher attempt
    await expect(
      (gateway.dispatcher as any).handlers.get('media.join')(conn2, {
        t: 'media.join',
        d: { channelId, role: 'publisher' },
      })
    ).rejects.toThrowError(WsHandlerError);

    try {
      await (gateway.dispatcher as any).handlers.get('media.join')(conn2, {
        t: 'media.join',
        d: { channelId, role: 'publisher' },
      });
    } catch (err) {
      expect((err as WsHandlerError).code).toBe('ALREADY_PUBLISHING');
    }
  });

  it('3. Enforces transport cap of 2 per connection', async () => {
    const conn = createMockConn({ id: ownerId, username: 'owner', guest: false });
    await (gateway.dispatcher as any).handlers.get('media.join')(conn, {
      t: 'media.join',
      d: { channelId, role: 'publisher' },
    });

    const createHandler = (gateway.dispatcher as any).handlers.get('media.createTransport');

    // 1st transport
    await createHandler(conn, { t: 'media.createTransport', d: { direction: 'send' } });

    // 2nd transport with different id
    mockTransport = { ...mockTransport, id: 'transport-2', observer: new EventEmitter() } as any;
    await createHandler(conn, { t: 'media.createTransport', d: { direction: 'recv' } });

    // 3rd transport -> rejected
    await expect(
      createHandler(conn, { t: 'media.createTransport', d: { direction: 'send' } })
    ).rejects.toThrowError(WsHandlerError);

    try {
      await createHandler(conn, { t: 'media.createTransport', d: { direction: 'send' } });
    } catch (err) {
      expect((err as WsHandlerError).code).toBe('TOO_MANY_TRANSPORTS');
    }
  });

  it('4. Cleanup on close: closes transports, producers, and clears publisher', async () => {
    const conn = createMockConn({ id: ownerId, username: 'owner', guest: false });
    await (gateway.dispatcher as any).handlers.get('media.join')(conn, {
      t: 'media.join',
      d: { channelId, role: 'publisher' },
    });

    await (gateway.dispatcher as any).handlers.get('media.createTransport')(conn, {
      t: 'media.createTransport',
      d: { direction: 'send' },
    });

    await (gateway.dispatcher as any).handlers.get('media.produce')(conn, {
      t: 'media.produce',
      d: {
        transportId: mockTransport.id,
        kind: 'video',
        rtpParameters: {} as any,
      },
    });

    expect(mockRoom.publisher).toBeDefined();
    expect(mockRoom.producers.size).toBe(1);

    // Trigger cleanup hook
    await (gateway as any).cleanupHooks[0](conn);

    expect(mockTransport.close).toHaveBeenCalled();
    expect(mockProducer.close).toHaveBeenCalled();
    expect(mockRoom.publisher).toBeUndefined();
    expect(mockRoom.producers.size).toBe(0);
  });
});
