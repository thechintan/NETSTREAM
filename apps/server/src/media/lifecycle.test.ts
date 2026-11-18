/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { channels, db, streams, users } from '../db/index.js';
import { updatePeak } from '../presence/service.js';
import { WebSocketGateway } from '../realtime/gateway.js';
import {
  getStreamState,
  startPublisherSession,
  onVideoProducerCreated,
  onPublisherDisconnected,
  endStream,
  recoverCrashedStreamsOnBoot,
} from './lifecycle.js';
import * as mediaModule from './index.js';

describe('Task 14: Stream Lifecycle State Machine Tests', () => {
  let gateway: WebSocketGateway;
  let testUserId: string;
  let testChannelId: string;
  let mockRoom: any;
  let mockRoomManager: any;

  beforeAll(async () => {
    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    const [testUser] = await db
      .insert(users)
      .values({
        email: `streamer_${timestamp}@netstream.live`,
        username: `streamer_${timestamp}`,
        passwordHash: 'dummy_hash',
      })
      .returning({ id: users.id });
    testUserId = testUser.id;

    const [testChannel] = await db
      .insert(channels)
      .values({
        ownerId: testUserId,
        name: `chan_${timestamp}`,
        title: 'Epic Gaming Stream',
        streamKeyHash: 'dummy_key_hash',
        isLive: false,
      })
      .returning({ id: channels.id });
    testChannelId = testChannel.id;
  });

  afterAll(async () => {
    if (testChannelId) {
      await db.delete(streams).where(eq(streams.channelId, testChannelId));
      await db.delete(channels).where(eq(channels.id, testChannelId));
    }
    if (testUserId) {
      await db.delete(users).where(eq(users.id, testUserId));
    }
  });

  beforeEach(() => {
    mockRoom = {
      channelId: testChannelId,
      router: {
        id: 'router-1',
        rtpCapabilities: { codecs: [] },
        close: vi.fn(),
      },
      publisher: undefined,
      producers: new Map(),
      viewers: new Map(),
      transports: new Map(),
    };

    mockRoomManager = {
      getOrCreate: vi.fn(async () => mockRoom),
      get: vi.fn((id: string) => (id === testChannelId ? mockRoom : undefined)),
      close: vi.fn(),
    };

    vi.spyOn(mediaModule, 'getRoomManager').mockReturnValue(mockRoomManager as any);

    gateway = new WebSocketGateway({
      allowedOrigin: 'http://localhost:5173',
      heartbeatIntervalMs: 100000,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Reset state between tests
    await endStream(testChannelId, gateway, 'test_cleanup');
    await db.delete(streams).where(eq(streams.channelId, testChannelId));
  });

  it('1. Normal start and end: first video producer starts stream; end closes it', async () => {
    expect(getStreamState(testChannelId)).toBe('OFFLINE');

    // Start publisher session
    const { reconnected } = startPublisherSession(testChannelId, testUserId, 'conn-1');
    expect(reconnected).toBe(false);
    expect(getStreamState(testChannelId)).toBe('STARTING');

    // First video producer created
    await onVideoProducerCreated(testChannelId, 'conn-1');
    expect(getStreamState(testChannelId)).toBe('LIVE');

    // Verify channel is_live in DB
    const [chanRow] = await db
      .select({ isLive: channels.isLive })
      .from(channels)
      .where(eq(channels.id, testChannelId));
    expect(chanRow.isLive).toBe(true);

    // Verify active stream row in DB
    const streamRows = await db
      .select()
      .from(streams)
      .where(and(eq(streams.channelId, testChannelId), isNull(streams.endedAt)));
    expect(streamRows).toHaveLength(1);
    expect(streamRows[0].title).toBe('Epic Gaming Stream');

    // End stream manually
    await endStream(testChannelId, gateway, 'manual_end');
    expect(getStreamState(testChannelId)).toBe('OFFLINE');

    const [chanAfter] = await db
      .select({ isLive: channels.isLive })
      .from(channels)
      .where(eq(channels.id, testChannelId));
    expect(chanAfter.isLive).toBe(false);

    const endedStreams = await db
      .select()
      .from(streams)
      .where(eq(streams.channelId, testChannelId));
    expect(endedStreams).toHaveLength(1);
    expect(endedStreams[0].endedAt).not.toBeNull();
  });

  it('2. Publisher drop and return within 15s keeps single streams row and stays live', async () => {
    startPublisherSession(testChannelId, testUserId, 'conn-1');
    await onVideoProducerCreated(testChannelId, 'conn-1');
    expect(getStreamState(testChannelId)).toBe('LIVE');

    vi.useFakeTimers();

    // Publisher drops
    await onPublisherDisconnected(testChannelId, 'conn-1', gateway);

    // Advance 7 seconds (within 15s grace period)
    vi.advanceTimersByTime(7000);
    expect(getStreamState(testChannelId)).toBe('LIVE');

    // Publisher returns with new connection
    const session = startPublisherSession(testChannelId, testUserId, 'conn-2');
    expect(session.reconnected).toBe(true);

    // Re-produces video track
    await onVideoProducerCreated(testChannelId, 'conn-2');
    expect(getStreamState(testChannelId)).toBe('LIVE');

    // Advance past original 15s mark
    vi.advanceTimersByTime(10000);

    // Should still be live!
    expect(getStreamState(testChannelId)).toBe('LIVE');

    vi.useRealTimers();

    // Still only 1 stream row, not ended
    const liveStreams = await db
      .select()
      .from(streams)
      .where(and(eq(streams.channelId, testChannelId), isNull(streams.endedAt)));
    expect(liveStreams).toHaveLength(1);
  });

  it('3. Publisher drop beyond 15s expires grace period and ends the stream', async () => {
    startPublisherSession(testChannelId, testUserId, 'conn-1');
    await onVideoProducerCreated(testChannelId, 'conn-1');
    expect(getStreamState(testChannelId)).toBe('LIVE');

    vi.useFakeTimers();

    // Publisher drops
    await onPublisherDisconnected(testChannelId, 'conn-1', gateway);

    // Advance 16 seconds (grace expiry)
    await vi.advanceTimersByTimeAsync(16000);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 100));

    // State should now be OFFLINE
    expect(getStreamState(testChannelId)).toBe('OFFLINE');

    const [chanRow] = await db
      .select({ isLive: channels.isLive })
      .from(channels)
      .where(eq(channels.id, testChannelId));
    expect(chanRow.isLive).toBe(false);

    const openStreams = await db
      .select()
      .from(streams)
      .where(and(eq(streams.channelId, testChannelId), isNull(streams.endedAt)));
    expect(openStreams).toHaveLength(0);
  });

  it('4. Boot recovery: resets is_live and closes open streams rows', async () => {
    // Simulate crash: channel is_live = true, and open stream in DB
    await db.update(channels).set({ isLive: true }).where(eq(channels.id, testChannelId));
    await db.insert(streams).values({
      channelId: testChannelId,
      title: 'Crashed Stream',
      startedAt: new Date(Date.now() - 3600000),
    });

    await recoverCrashedStreamsOnBoot();

    const [chan] = await db
      .select({ isLive: channels.isLive })
      .from(channels)
      .where(eq(channels.id, testChannelId));
    expect(chan.isLive).toBe(false);

    const openStreams = await db
      .select()
      .from(streams)
      .where(and(eq(streams.channelId, testChannelId), isNull(streams.endedAt)));
    expect(openStreams).toHaveLength(0);
  });

  it('5. Double Go Live rejected: only one active stream per channel allowed', async () => {
    startPublisherSession(testChannelId, testUserId, 'conn-1');
    await onVideoProducerCreated(testChannelId, 'conn-1');
    expect(getStreamState(testChannelId)).toBe('LIVE');

    // Attempt second go live on same channel
    expect(() => {
      startPublisherSession(testChannelId, 'another-user-id', 'conn-2');
    }).toThrow('STREAM_ALREADY_LIVE');
  });

  it('6. Peak viewers persisted to streams.peak_viewers on stream end', async () => {
    startPublisherSession(testChannelId, testUserId, 'conn-1');
    await onVideoProducerCreated(testChannelId, 'conn-1');

    // Record peak viewers during stream
    await updatePeak(testChannelId, 85);

    await endStream(testChannelId, gateway, 'manual_end');

    const [endedStream] = await db
      .select()
      .from(streams)
      .where(eq(streams.channelId, testChannelId));

    expect(endedStream.peakViewers).toBe(85);
  });
});
