import crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { config } from '../config/index.js';
import { createWsTicket } from '../auth/ticket.js';
import {
  addViewer,
  getPeak,
  getViewerCount,
  publishStreamLive,
  publishStreamOffline,
  PresenceWorker,
} from './index.js';

describe('Task 10: Viewer Counts and Live Directory Integration Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let wsBaseUrl: string;

  async function registerUser(prefix: string) {
    const username = `${prefix.slice(0, 4)}_${Date.now().toString().slice(-6)}_${Math.random().toString(36).slice(2, 6)}`;
    const email = `${username}@example.com`;
    const password = 'Password123!';
    const fakeIp = `10.111.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: fakeIp,
      payload: { email, username, password },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    const token = body.accessToken as string;

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.statusCode).toBe(200);

    return {
      id: body.user.id as string,
      username: body.user.username as string,
      token,
      channel: meRes.json().channel,
    };
  }

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

  it('1. counts with two connections', async () => {
    const channelId = crypto.randomUUID();

    const client1 = await connectClient({
      id: crypto.randomUUID(),
      username: 'viewer1',
      guest: false,
    });
    const client2 = await connectClient({
      id: crypto.randomUUID(),
      username: 'viewer2',
      guest: false,
    });

    await request(client1, 'chat.join', { channelId });
    await request(client2, 'chat.join', { channelId });

    const count = await getViewerCount(channelId);
    expect(count).toBe(2);

    client1.close();
    client2.close();
  });

  it('2. a duplicate user in two tabs counts as two connections', async () => {
    const channelId = crypto.randomUUID();
    const duplicateUserId = crypto.randomUUID();
    const duplicateUsername = 'multitab_user';

    // Tab 1
    const tab1 = await connectClient({
      id: duplicateUserId,
      username: duplicateUsername,
      guest: false,
    });
    // Tab 2
    const tab2 = await connectClient({
      id: duplicateUserId,
      username: duplicateUsername,
      guest: false,
    });

    await request(tab1, 'chat.join', { channelId });
    await request(tab2, 'chat.join', { channelId });

    // Both sockets have different connection IDs, so count is 2
    const count = await getViewerCount(channelId);
    expect(count).toBe(2);

    tab1.close();
    tab2.close();
  });

  it('3. stale entries expire after 60 seconds', async () => {
    const channelId = crypto.randomUUID();
    const freshConnId = crypto.randomUUID();
    const staleConnId = crypto.randomUUID();

    const now = Date.now();
    // Fresh connection: current time
    await addViewer(channelId, freshConnId, now);
    // Stale connection: 65 seconds ago (> 60s maxAge)
    await addViewer(channelId, staleConnId, now - 65000);

    // Initial count without pruning is 2, but getViewerCount prunes stale entries
    const count = await getViewerCount(channelId);
    expect(count).toBe(1);
  });

  it('4. count messages are coalesced: many joins produce one broadcast per interval', async () => {
    const channelId = crypto.randomUUID();
    const worker = new PresenceWorker(app.gateway, { intervalMs: 60000 }); // manual tick control
    worker.trackChannel(channelId);

    // Monitoring client listening for viewers.count
    const monitorWs = await connectClient({
      id: crypto.randomUUID(),
      username: 'monitor',
      guest: false,
    });
    await request(monitorWs, 'chat.join', { channelId });

    let countMessagesReceived = 0;
    let latestCount = 0;

    monitorWs.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.t === 'viewers.count' && parsed.d?.channelId === channelId) {
          countMessagesReceived++;
          latestCount = parsed.d.count;
        }
      } catch {
        // ignore
      }
    });

    // 5 separate clients join chat in rapid succession
    const joinClients: WebSocket[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await connectClient({
        id: crypto.randomUUID(),
        username: `rapid_join_${i}`,
        guest: false,
      });
      joinClients.push(c);
      await request(c, 'chat.join', { channelId });
    }

    // Give a brief tick to verify no per-join viewers.count messages were broadcast
    await new Promise((r) => setTimeout(r, 100));
    expect(countMessagesReceived).toBe(0);

    // Trigger one coalesced worker aggregation tick
    await worker.tick();

    // Verify exactly 1 broadcast was received with count = 6 (monitor + 5 joiners)
    await new Promise((r) => setTimeout(r, 100));
    expect(countMessagesReceived).toBe(1);
    expect(latestCount).toBe(6);

    // Verify peak viewer count was updated to 6
    const peak = await getPeak(channelId);
    expect(peak).toBe(6);

    await worker.close();
    monitorWs.close();
    for (const c of joinClients) {
      c.close();
    }
  });

  it('5. cleanup on close: closing a connection decreases viewer count', async () => {
    const channelId = crypto.randomUUID();

    const client1 = await connectClient({
      id: crypto.randomUUID(),
      username: 'c1',
      guest: false,
    });
    const client2 = await connectClient({
      id: crypto.randomUUID(),
      username: 'c2',
      guest: false,
    });

    await request(client1, 'chat.join', { channelId });
    await request(client2, 'chat.join', { channelId });

    expect(await getViewerCount(channelId)).toBe(2);

    // Close client1
    client1.close();
    await new Promise((r) => setTimeout(r, 150));

    // Cleanup hook removed client1
    const countAfterClose = await getViewerCount(channelId);
    expect(countAfterClose).toBe(1);

    client2.close();
  });

  it('6. user.subscribe { topics: ["live"] } receives stream.live and stream.offline events', async () => {
    const subscriberWs = await connectClient({
      id: crypto.randomUUID(),
      username: 'directory_sub',
      guest: false,
    });

    // Subscribe to live directory
    const subAck = await request<{ ok: boolean; subscribed: string[] }>(subscriberWs, 'user.subscribe', {
      topics: ['live'],
    });
    expect(subAck.d.ok).toBe(true);
    expect(subAck.d.subscribed).toContain('live');

    // Test stream.live event
    const livePromise = new Promise<{ channelId: string; title: string }>((resolve) => {
      const handler = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.t === 'stream.live') {
            subscriberWs.off('message', handler);
            resolve(parsed.d);
          }
        } catch {
          // ignore
        }
      };
      subscriberWs.on('message', handler);
    });

    const testChannelId = crypto.randomUUID();
    await publishStreamLive({
      channelId: testChannelId,
      channelName: 'livestreamer',
      title: 'Breaking news live!',
      ownerUsername: 'livestreamer',
      viewerCount: 42,
    });

    const receivedLive = await livePromise;
    expect(receivedLive.channelId).toBe(testChannelId);
    expect(receivedLive.title).toBe('Breaking news live!');

    // Test stream.offline event
    const offlinePromise = new Promise<{ channelId: string }>((resolve) => {
      const handler = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.t === 'stream.offline') {
            subscriberWs.off('message', handler);
            resolve(parsed.d);
          }
        } catch {
          // ignore
        }
      };
      subscriberWs.on('message', handler);
    });

    await publishStreamOffline({ channelId: testChannelId });
    const receivedOffline = await offlinePromise;
    expect(receivedOffline.channelId).toBe(testChannelId);

    subscriberWs.close();
  });

  it('7. REST endpoints return real-time viewerCount', async () => {
    const user = await registerUser('vcount');
    const channelId = user.channel.id;
    const channelName = user.channel.name;

    // Connect 2 viewers
    const v1 = await connectClient({ id: crypto.randomUUID(), username: 'v1', guest: false });
    const v2 = await connectClient({ id: crypto.randomUUID(), username: 'v2', guest: false });

    await request(v1, 'chat.join', { channelId });
    await request(v2, 'chat.join', { channelId });

    // GET /api/channels/:name includes viewerCount = 2
    const channelRes = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelName}`,
    });
    expect(channelRes.statusCode).toBe(200);
    const channelData = channelRes.json();
    expect(channelData.viewerCount).toBe(2);

    v1.close();
    v2.close();
  });
});
