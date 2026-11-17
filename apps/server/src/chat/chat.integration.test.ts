import crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatJoinResponse, ChatMessageDto } from '@netstream/shared';
import { buildApp } from '../app.js';
import { config } from '../config/index.js';
import { createWsTicket } from '../auth/ticket.js';

describe('Live Chat Integration Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let wsBaseUrl: string;

  const channelA = crypto.randomUUID();
  const channelB = crypto.randomUUID();

  // Helper to create and connect a ws client with a ticket
  async function connectClient(
    user: { id: string; username: string; guest: boolean }
  ): Promise<WebSocket> {
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

  // Helper to send request and await ack
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

  it('1. delivers messages only to the right room', async () => {
    const clientA1 = await connectClient({
      id: crypto.randomUUID(),
      username: 'user_a1',
      guest: false,
    });
    const clientA2 = await connectClient({
      id: crypto.randomUUID(),
      username: 'user_a2',
      guest: false,
    });
    const clientB = await connectClient({
      id: crypto.randomUUID(),
      username: 'user_b',
      guest: false,
    });

    // Client A1 and A2 join channel A
    await request<ChatJoinResponse>(clientA1, 'chat.join', { channelId: channelA });
    await request<ChatJoinResponse>(clientA2, 'chat.join', { channelId: channelA });

    // Client B joins channel B
    await request<ChatJoinResponse>(clientB, 'chat.join', { channelId: channelB });

    const receivedA2: ChatMessageDto[] = [];
    const receivedB: ChatMessageDto[] = [];

    clientA2.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.t === 'chat.message') {
        receivedA2.push(msg.d);
      }
    });

    clientB.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.t === 'chat.message') {
        receivedB.push(msg.d);
      }
    });

    // Client A1 sends message to channel A
    await request(clientA1, 'chat.send', {
      channelId: channelA,
      text: 'Message for channel A only!',
    });

    // Allow event loop tick for Redis pub/sub delivery
    await new Promise((r) => setTimeout(r, 80));

    // Verify client A2 in room A received the message
    expect(receivedA2.length).toBe(1);
    expect(receivedA2[0].text).toBe('Message for channel A only!');
    expect(receivedA2[0].channelId).toBe(channelA);
    expect(receivedA2[0].user.name).toBe('user_a1');
    expect(receivedA2[0].user.color).toBeDefined();

    // Verify client B in room B did NOT receive the message
    expect(receivedB.length).toBe(0);

    clientA1.close();
    clientA2.close();
    clientB.close();
  });

  it('2. rejects chat.send from guests with FORBIDDEN', async () => {
    const guestClient = await connectClient({
      id: crypto.randomUUID(),
      username: 'guest_test',
      guest: true,
    });

    await request<ChatJoinResponse>(guestClient, 'chat.join', { channelId: channelA });

    let errorThrown: { code?: string; message?: string } | null = null;
    try {
      await request(guestClient, 'chat.send', {
        channelId: channelA,
        text: 'I should be rejected because I am a guest',
      });
    } catch (err) {
      errorThrown = err as { code?: string; message?: string };
    }

    expect(errorThrown).not.toBeNull();
    expect(errorThrown?.code).toBe('FORBIDDEN');
    expect(errorThrown?.message).toContain('Guests cannot send');

    guestClient.close();
  });

  it('3. returns chat history on chat.join', async () => {
    const channelHist = crypto.randomUUID();

    const sender = await connectClient({
      id: crypto.randomUUID(),
      username: 'history_sender',
      guest: false,
    });

    await request(sender, 'chat.join', { channelId: channelHist });

    // Send 3 distinct messages
    await request(sender, 'chat.send', { channelId: channelHist, text: 'First historic message' });
    await request(sender, 'chat.send', { channelId: channelHist, text: 'Second historic message' });
    await request(sender, 'chat.send', { channelId: channelHist, text: 'Third historic message' });

    // Small delay for Redis operations to finish
    await new Promise((r) => setTimeout(r, 50));

    // A brand new client joins channelHist
    const newViewer = await connectClient({
      id: crypto.randomUUID(),
      username: 'new_viewer',
      guest: true,
    });

    const joinAck = await request<ChatJoinResponse>(newViewer, 'chat.join', { channelId: channelHist });

    expect(joinAck.d.messages).toBeDefined();
    expect(joinAck.d.messages.length).toBe(3);
    // Messages must be in chronological order
    expect(joinAck.d.messages[0].text).toBe('First historic message');
    expect(joinAck.d.messages[1].text).toBe('Second historic message');
    expect(joinAck.d.messages[2].text).toBe('Third historic message');

    sender.close();
    newViewer.close();
  });

  it('4. rejects messages exceeding 500 characters', async () => {
    const client = await connectClient({
      id: crypto.randomUUID(),
      username: 'length_tester',
      guest: false,
    });

    await request(client, 'chat.join', { channelId: channelA });

    const longText = 'A'.repeat(501);

    let errorThrown: { code?: string; message?: string } | null = null;
    try {
      await request(client, 'chat.send', {
        channelId: channelA,
        text: longText,
      });
    } catch (err) {
      errorThrown = err as { code?: string; message?: string };
    }

    expect(errorThrown).not.toBeNull();
    expect(errorThrown?.code).toBe('BAD_REQUEST');

    client.close();
  });
});
