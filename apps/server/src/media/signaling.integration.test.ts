import crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createWsTicket } from '../auth/ticket.js';
import { config } from '../config/index.js';
import { channels, closeDb, db, users } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { closeRedis } from '../lib/redis.js';
import { getRoomManager, shutdownMedia } from './index.js';

describe('Task 12: Broadcaster Signaling Integration Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let wsBaseUrl: string;

  const userA = {
    id: crypto.randomUUID(),
    email: `owner_${Date.now()}@netstream.live`,
    username: `owner_${Date.now()}`,
  };

  const userB = {
    id: crypto.randomUUID(),
    email: `other_${Date.now()}@netstream.live`,
    username: `other_${Date.now()}`,
  };

  let channelAId = '';

  beforeAll(async () => {
    await runMigrations();

    // Create user A and user B with channels
    await db.insert(users).values([
      {
        id: userA.id,
        email: userA.email,
        username: userA.username,
        passwordHash: 'dummy_hash',
      },
      {
        id: userB.id,
        email: userB.email,
        username: userB.username,
        passwordHash: 'dummy_hash',
      },
    ]);

    const [chanA] = await db
      .insert(channels)
      .values({
        ownerId: userA.id,
        name: userA.username,
        title: `${userA.username}'s Stream`,
        streamKeyHash: 'dummy_hash_a',
      })
      .returning();

    await db
      .insert(channels)
      .values({
        ownerId: userB.id,
        name: userB.username,
        title: `${userB.username}'s Stream`,
        streamKeyHash: 'dummy_hash_b',
      });

    channelAId = chanA.id;

    app = buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    wsBaseUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await shutdownMedia();
    await closeDb();
    await closeRedis();
  });

  async function connectClient(user: {
    id: string;
    username: string;
    guest: boolean;
  }): Promise<WebSocket> {
    const ticket = await createWsTicket(
      user.guest
        ? { guest: true, id: user.id }
        : { guest: false, userId: user.id, username: user.username }
    );

    const ws = new WebSocket(`${wsBaseUrl}?ticket=${ticket}`, {
      headers: { Origin: config.WEB_ORIGIN },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    return ws;
  }

  async function request<T = unknown>(
    ws: WebSocket,
    t: string,
    d: unknown
  ): Promise<{ id: string; d: T }> {
    const id = `req_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const onMessage = (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.t === 'ack' && msg.id === id) {
            ws.off('message', onMessage);
            resolve({ id, d: msg.d as T });
          } else if (msg.t === 'error' && msg.id === id) {
            ws.off('message', onMessage);
            reject(msg.d);
          }
        } catch {
          // ignore
        }
      };

      ws.on('message', onMessage);
      ws.send(JSON.stringify({ t, id, d }));
    });
  }

  it('1. Rejects non-owners and guests from joining as publisher', async () => {
    // Guest attempt
    const guestWs = await connectClient({
      id: crypto.randomUUID(),
      username: 'guest_user',
      guest: true,
    });

    await expect(
      request(guestWs, 'media.join', {
        channelId: channelAId,
        role: 'publisher',
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    guestWs.close();

    // Authenticated user B attempting to publish to Channel A (owned by User A)
    const otherWs = await connectClient({
      id: userB.id,
      username: userB.username,
      guest: false,
    });

    await expect(
      request(otherWs, 'media.join', {
        channelId: channelAId,
        role: 'publisher',
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    otherWs.close();
  });

  it('2. Channel owner can join as publisher and receives routerRtpCapabilities', async () => {
    const ownerWs = await connectClient({
      id: userA.id,
      username: userA.username,
      guest: false,
    });

    const res = await request<{ routerRtpCapabilities: { codecs: unknown[] } }>(
      ownerWs,
      'media.join',
      {
        channelId: channelAId,
        role: 'publisher',
      }
    );

    expect(res.d).toBeDefined();
    expect(res.d.routerRtpCapabilities).toBeDefined();
    expect(res.d.routerRtpCapabilities.codecs.length).toBeGreaterThan(0);

    const roomManager = getRoomManager();
    const room = roomManager.get(channelAId);
    expect(room).toBeDefined();
    expect(room?.publisher?.userId).toBe(userA.id);

    ownerWs.close();
  });

  it('3. Rejects second publisher with ALREADY_PUBLISHING', async () => {
    const ownerWs1 = await connectClient({
      id: userA.id,
      username: userA.username,
      guest: false,
    });

    await request(ownerWs1, 'media.join', {
      channelId: channelAId,
      role: 'publisher',
    });

    // Second connection attempting to publish simultaneously
    const ownerWs2 = await connectClient({
      id: userA.id,
      username: userA.username,
      guest: false,
    });

    await expect(
      request(ownerWs2, 'media.join', {
        channelId: channelAId,
        role: 'publisher',
      })
    ).rejects.toMatchObject({
      code: 'ALREADY_PUBLISHING',
    });

    ownerWs1.close();
    ownerWs2.close();
  });

  it('4. Enforces per-connection cap of 2 transports', async () => {
    const ownerWs = await connectClient({
      id: userA.id,
      username: userA.username,
      guest: false,
    });

    await request(ownerWs, 'media.join', {
      channelId: channelAId,
      role: 'publisher',
    });

    // 1st transport (send)
    const t1 = await request<{ id: string; iceParameters: unknown }>(
      ownerWs,
      'media.createTransport',
      { direction: 'send' }
    );
    expect(t1.d.id).toBeDefined();

    // 2nd transport (recv)
    const t2 = await request<{ id: string; iceParameters: unknown }>(
      ownerWs,
      'media.createTransport',
      { direction: 'recv' }
    );
    expect(t2.d.id).toBeDefined();

    // 3rd transport -> rejected
    await expect(
      request(ownerWs, 'media.createTransport', { direction: 'send' })
    ).rejects.toMatchObject({
      code: 'TOO_MANY_TRANSPORTS',
    });

    ownerWs.close();
  });

  it('5. Handles media.connectTransport and enforces producer constraints in media.produce', async () => {
    const ownerWs = await connectClient({
      id: userA.id,
      username: userA.username,
      guest: false,
    });

    await request(ownerWs, 'media.join', {
      channelId: channelAId,
      role: 'publisher',
    });

    const transportRes = await request<{ id: string; dtlsParameters: { fingerprints: unknown[] } }>(
      ownerWs,
      'media.createTransport',
      { direction: 'send' }
    );
    const transportId = transportRes.d.id;

    // Connect transport
    const dtlsParams = {
      role: 'client',
      fingerprints: [
        {
          algorithm: 'sha-256',
          value: '00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
        },
      ],
    };

    const connectRes = await request<{ connected: boolean }>(
      ownerWs,
      'media.connectTransport',
      {
        transportId,
        dtlsParameters: dtlsParams,
      }
    );
    expect(connectRes.d.connected).toBe(true);

    // Produce video track
    const videoRtpParams = {
      mid: '0',
      codecs: [
        {
          mimeType: 'video/VP8',
          payloadType: 96,
          clockRate: 90000,
          rtcpFeedback: [],
          parameters: {},
        },
      ],
      headerExtensions: [],
      encodings: [{ ssrc: 11111111 }],
      rtcp: { cname: 'test-cname', reducedSize: true },
    };

    const prod1 = await request<{ id: string }>(ownerWs, 'media.produce', {
      transportId,
      kind: 'video',
      rtpParameters: videoRtpParams,
    });
    expect(prod1.d.id).toBeDefined();

    const room = getRoomManager().get(channelAId);
    expect(room?.producers.has(prod1.d.id)).toBe(true);

    // Attempting a second video producer is rejected with PRODUCER_EXISTS
    await expect(
      request(ownerWs, 'media.produce', {
        transportId,
        kind: 'video',
        rtpParameters: videoRtpParams,
      })
    ).rejects.toMatchObject({
      code: 'PRODUCER_EXISTS',
    });

    // Audio producer succeeds
    const audioRtpParams = {
      mid: '1',
      codecs: [
        {
          mimeType: 'audio/opus',
          payloadType: 111,
          clockRate: 48000,
          channels: 2,
          rtcpFeedback: [],
          parameters: {},
        },
      ],
      headerExtensions: [],
      encodings: [{ ssrc: 22222222 }],
      rtcp: { cname: 'test-cname', reducedSize: true },
    };

    const prod2 = await request<{ id: string }>(ownerWs, 'media.produce', {
      transportId,
      kind: 'audio',
      rtpParameters: audioRtpParams,
    });
    expect(prod2.d.id).toBeDefined();
    expect(room?.producers.size).toBe(2);

    ownerWs.close();
  });

  it('6. Cleanup on close: closes transports, producers, and clears publisher', async () => {
    const ownerWs = await connectClient({
      id: userA.id,
      username: userA.username,
      guest: false,
    });

    await request(ownerWs, 'media.join', {
      channelId: channelAId,
      role: 'publisher',
    });

    await request<{ id: string }>(
      ownerWs,
      'media.createTransport',
      { direction: 'send' }
    );

    const roomManager = getRoomManager();
    const room = roomManager.get(channelAId)!;
    expect(room.publisher).toBeDefined();
    expect(room.transports.size).toBeGreaterThan(0);

    // Close owner socket
    ownerWs.close();

    // Wait briefly for disconnect cleanup hook to process
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Publisher should be cleared
    expect(room.publisher).toBeUndefined();

    // Now another connection for owner can join as publisher
    const newOwnerWs = await connectClient({
      id: userA.id,
      username: userA.username,
      guest: false,
    });

    const newJoin = await request(newOwnerWs, 'media.join', {
      channelId: channelAId,
      role: 'publisher',
    });
    expect(newJoin.d).toBeDefined();
    expect(room.publisher?.userId).toBe(userA.id);

    newOwnerWs.close();
  });
});
