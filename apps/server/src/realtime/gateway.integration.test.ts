import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WS_CLOSE_CODES } from '@netstream/shared';
import { buildApp } from '../app.js';
import { config } from '../config/index.js';
import { createWsTicket } from '../auth/ticket.js';

describe('WebSocket Gateway Integration Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let wsBaseUrl: string;

  beforeAll(async () => {
    // Start server with 200ms heartbeat interval for fast testing
    app = buildApp({
      allowedOrigin: config.WEB_ORIGIN,
      heartbeatIntervalMs: 200,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;
    wsBaseUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. rejects invalid ticket with 401', async () => {
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${wsBaseUrl}?ticket=non_existent_ticket_123`, {
        headers: { Origin: config.WEB_ORIGIN },
      });

      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(401);
        ws.close();
        resolve();
      });

      ws.on('error', () => {
        // May also emit error after unexpected response
        resolve();
      });
    });
  });

  it('2. rejects reused ticket with 401 on second attempt', async () => {
    const ticket = await createWsTicket({
      userId: '11111111-1111-1111-1111-111111111111',
      username: 'reuser',
      guest: false,
    });

    // 1st redemption: should succeed
    const ws1 = new WebSocket(`${wsBaseUrl}?ticket=${ticket}`, {
      headers: { Origin: config.WEB_ORIGIN },
    });

    await new Promise<void>((resolve, reject) => {
      ws1.on('open', () => resolve());
      ws1.on('error', reject);
    });

    // 2nd redemption: should fail with 401
    await new Promise<void>((resolve) => {
      const ws2 = new WebSocket(`${wsBaseUrl}?ticket=${ticket}`, {
        headers: { Origin: config.WEB_ORIGIN },
      });

      ws2.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(401);
        ws2.close();
        ws1.close();
        resolve();
      });

      ws2.on('error', () => {
        ws1.close();
        resolve();
      });
    });
  });

  it('3. rejects wrong Origin with 403', async () => {
    const ticket = await createWsTicket({
      guest: true,
      id: '22222222-2222-2222-2222-222222222222',
    });

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${wsBaseUrl}?ticket=${ticket}`, {
        headers: { Origin: 'http://malicious-attacker.com' },
      });

      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(403);
        ws.close();
        resolve();
      });

      ws.on('error', () => {
        resolve();
      });
    });
  });

  it('4. performs request/ack roundtrip with test echo handler', async () => {
    const ticket = await createWsTicket({
      userId: '33333333-3333-3333-3333-333333333333',
      username: 'echo_tester',
      guest: false,
    });

    const ws = new WebSocket(`${wsBaseUrl}?ticket=${ticket}`, {
      headers: { Origin: config.WEB_ORIGIN },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const reply = await new Promise<{ t: string; id: string; d: unknown }>((resolve, reject) => {
      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });

      ws.send(
        JSON.stringify({
          t: 'test.echo',
          id: 'req-echo-123',
          d: { hello: 'networking world', seq: 1 },
        })
      );
    });

    expect(reply.t).toBe('ack');
    expect(reply.id).toBe('req-echo-123');
    expect(reply.d).toEqual({ hello: 'networking world', seq: 1 });

    ws.close();
  });

  it('5. closes with 4400 on malformed JSON', async () => {
    const ticket = await createWsTicket({
      guest: true,
      id: '44444444-4444-4444-4444-444444444444',
    });

    const ws = new WebSocket(`${wsBaseUrl}?ticket=${ticket}`, {
      headers: { Origin: config.WEB_ORIGIN },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const closeCode = await new Promise<number>((resolve) => {
      ws.on('close', (code) => {
        resolve(code);
      });
      // Send malformed JSON
      ws.send('not valid json at all {');
    });

    expect(closeCode).toBe(WS_CLOSE_CODES.BAD_MESSAGE);
  });

  it('6. closes connection on oversized payload (> 16 KB)', async () => {
    const ticket = await createWsTicket({
      guest: true,
      id: '55555555-5555-5555-5555-555555555555',
    });

    const ws = new WebSocket(`${wsBaseUrl}?ticket=${ticket}`, {
      headers: { Origin: config.WEB_ORIGIN },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const closed = await new Promise<boolean>((resolve) => {
      ws.on('close', () => {
        resolve(true);
      });
      // Send > 16 KB payload (e.g. 20 KB)
      const bigString = 'X'.repeat(20 * 1024);
      ws.send(JSON.stringify({ t: 'test.echo', id: 'big-1', d: { data: bigString } }));
    });

    expect(closed).toBe(true);
  });

  it('7. heartbeat terminates a client that never pongs', async () => {
    const ticket = await createWsTicket({
      guest: true,
      id: '66666666-6666-6666-6666-666666666666',
    });

    const ws = new WebSocket(`${wsBaseUrl}?ticket=${ticket}`, {
      headers: { Origin: config.WEB_ORIGIN },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    // Prevent client from answering pings with pong
    (ws as unknown as { pong: () => void }).pong = () => {};

    const terminated = await new Promise<boolean>((resolve) => {
      ws.on('close', () => {
        resolve(true);
      });
    });

    expect(terminated).toBe(true);
  });

  it('8. runs registered cleanup hooks on connection close', async () => {
    const ticket = await createWsTicket({
      userId: '77777777-7777-7777-7777-777777777777',
      username: 'cleanup_user',
      guest: false,
    });

    let hookExecuted = false;
    let closedUsername = '';

    app.gateway.onCleanup((conn) => {
      if (conn.user.username === 'cleanup_user') {
        hookExecuted = true;
        closedUsername = conn.user.username;
      }
    });

    const ws = new WebSocket(`${wsBaseUrl}?ticket=${ticket}`, {
      headers: { Origin: config.WEB_ORIGIN },
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve());
      ws.close();
    });

    // Give a small tick for the server close listener to run
    await new Promise((r) => setTimeout(r, 50));

    expect(hookExecuted).toBe(true);
    expect(closedUsername).toBe('cleanup_user');
  });
});
