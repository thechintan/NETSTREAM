import crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatJoinResponse, ChatMessageDto } from '@netstream/shared';
import { buildApp } from '../app.js';
import { config } from '../config/index.js';
import { redis } from '../lib/redis.js';
import { createWsTicket } from '../auth/ticket.js';
import { ChatPersistenceWorker, getChatPersistenceWorker } from './persistence.js';

describe('Task 8: Chat Rate Limiting, Slow Mode, Replay & Persistence Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let wsBaseUrl: string;

  async function connectClient(user: { id: string; username: string; guest: boolean }): Promise<WebSocket> {
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

  beforeAll(async () => {
    app = buildApp({
      allowedOrigin: config.WEB_ORIGIN,
      heartbeatIntervalMs: 10000,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    wsBaseUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. rejects 21st message within the 30-second window with RATE_LIMITED', async () => {
    const channelId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    const client = await connectClient({
      id: userId,
      username: 'speedy_sender',
      guest: false,
    });

    await request(client, 'chat.join', { channelId });

    // Send 20 messages successfully
    for (let i = 1; i <= 20; i++) {
      const ack = await request(client, 'chat.send', {
        channelId,
        text: `Message number ${i}`,
      });
      expect(ack.d).toBeDefined();
    }

    // 21st message must be rejected with RATE_LIMITED
    let errorThrown: { code?: string; message?: string; retryAfterMs?: number } | null = null;
    try {
      await request(client, 'chat.send', {
        channelId,
        text: 'Message number 21 should exceed limit',
      });
    } catch (err) {
      errorThrown = err as { code?: string; message?: string; retryAfterMs?: number };
    }

    expect(errorThrown).not.toBeNull();
    expect(errorThrown?.code).toBe('RATE_LIMITED');
    expect(errorThrown?.retryAfterMs).toBeGreaterThan(0);

    client.close();
  });

  it('2. slow mode blocks a second message and allows it after the interval', async () => {
    const channelId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    // Configure slow mode of 1 second in Redis hash
    await redis.hset(`chan:${channelId}:settings`, 'slow_seconds', '1');

    const client = await connectClient({
      id: userId,
      username: 'slow_mode_user',
      guest: false,
    });

    await request(client, 'chat.join', { channelId });

    // First message succeeds
    const firstAck = await request(client, 'chat.send', {
      channelId,
      text: 'First message under slow mode',
    });
    expect(firstAck.d).toBeDefined();

    // Immediate second message is blocked by slow mode
    let slowError: { code?: string; message?: string; retryAfterMs?: number } | null = null;
    try {
      await request(client, 'chat.send', {
        channelId,
        text: 'Immediate second message',
      });
    } catch (err) {
      slowError = err as { code?: string; message?: string; retryAfterMs?: number };
    }

    expect(slowError).not.toBeNull();
    expect(slowError?.code).toBe('SLOW_MODE');
    expect(slowError?.retryAfterMs).toBeGreaterThan(0);

    // Wait for the 1-second interval to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Third message succeeds after the slow mode window passes
    const thirdAck = await request(client, 'chat.send', {
      channelId,
      text: 'Third message after slow mode interval',
    });
    expect(thirdAck.d).toBeDefined();

    client.close();
  });

  it('3. replay after lastMid returns only messages newer than lastMid', async () => {
    const channelId = crypto.randomUUID();

    const sender = await connectClient({
      id: crypto.randomUUID(),
      username: 'replay_sender',
      guest: false,
    });

    await request(sender, 'chat.join', { channelId });

    const sentMids: string[] = [];

    // Send 4 messages and capture their mids from the push stream
    sender.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed.t === 'chat.message') {
          sentMids.push(parsed.d.mid);
        }
      } catch {
        // ignore
      }
    });

    await request(sender, 'chat.send', { channelId, text: 'Alpha' });
    await request(sender, 'chat.send', { channelId, text: 'Beta' });
    await request(sender, 'chat.send', { channelId, text: 'Gamma' });
    await request(sender, 'chat.send', { channelId, text: 'Delta' });

    // Allow Redis publish/push ticks
    await new Promise((r) => setTimeout(r, 60));

    expect(sentMids.length).toBe(4);
    const midBeta = sentMids[1]; // M2 (Beta)

    // Replay client joins providing lastMid = midBeta
    const replayingClient = await connectClient({
      id: crypto.randomUUID(),
      username: 'replayer',
      guest: false,
    });

    const joinAck = await request<ChatJoinResponse>(replayingClient, 'chat.join', {
      channelId,
      lastMid: midBeta,
    });

    // Should only receive Gamma and Delta (newer than Beta)
    expect(joinAck.d.messages.length).toBe(2);
    expect(joinAck.d.messages[0].text).toBe('Gamma');
    expect(joinAck.d.messages[1].text).toBe('Delta');

    sender.close();
    replayingClient.close();
  });

  it('4. batch writer flushes on count and on timer', async () => {
    // 4a. Flush on count (batchSize: 3)
    const countWorker = new ChatPersistenceWorker({ batchSize: 3, flushIntervalMs: 60000 });
    const dummyChanId = crypto.randomUUID();
    const dummyUserId = crypto.randomUUID();

    const dummyMsg = (text: string): ChatMessageDto => ({
      mid: `01H000000000000000000000${Math.random().toString(36).slice(2, 6)}`,
      channelId: dummyChanId,
      user: { id: dummyUserId, name: 'dummy', color: '#FFF', badges: [] },
      text,
      ts: Date.now(),
    });

    countWorker.enqueue(dummyMsg('Msg 1'));
    countWorker.enqueue(dummyMsg('Msg 2'));
    expect(countWorker.getQueueLength()).toBe(2);

    // Enqueueing 3rd message reaches batchSize=3 and triggers immediate flush
    countWorker.enqueue(dummyMsg('Msg 3'));
    await new Promise((r) => setTimeout(r, 20));
    expect(countWorker.getQueueLength()).toBe(0);

    await countWorker.close();

    // 4b. Flush on timer (flushIntervalMs: 80ms)
    const timerWorker = new ChatPersistenceWorker({ batchSize: 50, flushIntervalMs: 80 });
    timerWorker.enqueue(dummyMsg('Timer 1'));
    timerWorker.enqueue(dummyMsg('Timer 2'));
    expect(timerWorker.getQueueLength()).toBe(2);

    // Wait for timer to tick
    await new Promise((r) => setTimeout(r, 150));
    expect(timerWorker.getQueueLength()).toBe(0);

    await timerWorker.close();
  });

  it('5. cursor pagination by ULID (GET /api/channels/:id/chat/history)', async () => {
    // Register a test user to create a real channel in database
    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      payload: {
        email: `hist_user_${Date.now()}@netstream.live`,
        username: `hist_${Date.now().toString().slice(-6)}_${Math.random().toString(36).slice(2, 5)}`,
        password: 'Password123!',
      },
    });
    expect(registerRes.statusCode).toBe(201);
    const { user, accessToken } = JSON.parse(registerRes.body);

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const channelId = JSON.parse(meRes.body).channel.id;

    // Connect via WS as the channel owner and send 5 messages
    const client = await connectClient({
      id: user.id,
      username: user.username,
      guest: false,
    });
    await request(client, 'chat.join', { channelId });

    for (let i = 1; i <= 5; i++) {
      await request(client, 'chat.send', {
        channelId,
        text: `Persistent message ${i}`,
      });
    }

    // Explicitly flush persistence worker to DB
    await getChatPersistenceWorker().flush();

    // Page 1: Query 3 newest messages
    const page1Res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/chat/history?limit=3`,
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = JSON.parse(page1Res.body);
    expect(page1.messages.length).toBe(3);
    // Chronological order: [Message 3, Message 4, Message 5]
    expect(page1.messages[0].text).toBe('Persistent message 3');
    expect(page1.messages[1].text).toBe('Persistent message 4');
    expect(page1.messages[2].text).toBe('Persistent message 5');

    // Page 2: Query messages before the oldest of page 1 (Message 3)
    const oldestMidPage1 = page1.messages[0].mid;
    const page2Res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/chat/history?before=${oldestMidPage1}&limit=3`,
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = JSON.parse(page2Res.body);
    expect(page2.messages.length).toBe(2);
    expect(page2.messages[0].text).toBe('Persistent message 1');
    expect(page2.messages[1].text).toBe('Persistent message 2');

    client.close();
  });
});
