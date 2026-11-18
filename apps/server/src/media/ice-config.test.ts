import crypto from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  ICE_CREDENTIAL_TTL_SECONDS,
  buildIceConfig,
  generateTurnCredentials,
  verifyTurnCredentials,
} from './ice-config.js';
import { createWsTicket } from '../auth/ticket.js';
import { registerMediaRoutes } from './routes.js';
import { config } from '../config/index.js';

describe('STUN/TURN ICE config and HMAC credentials (Task 21)', () => {
  it('generates credentials matching coturn HMAC-SHA1 algorithm and valid for 1 hour', () => {
    const secret = 'super-secret-turn-key';
    const userId = 'user-42';
    const nowSec = 1_700_000_000;

    const creds = generateTurnCredentials(userId, secret, { nowSec });

    expect(creds.expiresAt).toBe(nowSec + ICE_CREDENTIAL_TTL_SECONDS);
    expect(ICE_CREDENTIAL_TTL_SECONDS).toBe(3600);
    expect(creds.username).toBe(`${nowSec + 3600}:${userId}`);

    // Independently compute expected coturn credential using raw Node crypto HMAC-SHA1
    const expectedBase64 = crypto
      .createHmac('sha1', secret)
      .update(creds.username)
      .digest('base64');
    expect(creds.credential).toBe(expectedBase64);

    // Valid right at issuance and 1 second before expiry
    expect(verifyTurnCredentials(creds.username, creds.credential, secret, nowSec)).toMatchObject({
      valid: true,
      userId,
      expiresAt: nowSec + 3600,
    });
    expect(
      verifyTurnCredentials(creds.username, creds.credential, secret, nowSec + 3599)
    ).toMatchObject({ valid: true });
  });

  it('rejects credentials once 1 hour expires, or if secret/username is tampered', () => {
    const secret = 'turn-secret-abc';
    const nowSec = 1_700_000_000;
    const creds = generateTurnCredentials('alice', secret, { nowSec });

    // Expired exactly at +3600s and beyond
    expect(
      verifyTurnCredentials(creds.username, creds.credential, secret, nowSec + 3600)
    ).toMatchObject({ valid: false, reason: 'EXPIRED' });
    expect(
      verifyTurnCredentials(creds.username, creds.credential, secret, nowSec + 3601)
    ).toMatchObject({ valid: false, reason: 'EXPIRED' });

    // Wrong secret
    expect(
      verifyTurnCredentials(creds.username, creds.credential, 'wrong-secret', nowSec + 10)
    ).toMatchObject({ valid: false, reason: 'INVALID_SIGNATURE' });

    // Tampered username
    expect(
      verifyTurnCredentials(`${nowSec + 7200}:alice`, creds.credential, secret, nowSec + 10)
    ).toMatchObject({ valid: false, reason: 'INVALID_SIGNATURE' });
  });

  it('builds STUN and TURN (UDP + TCP) iceServers payload with time-limited credentials', () => {
    const nowSec = 1_700_000_000;
    const res = buildIceConfig('viewer-99', {
      turnHost: 'turn.example.com',
      turnSecret: 'test-secret',
      nowSec,
    });

    expect(res.ttlSeconds).toBe(3600);
    expect(res.expiresAt).toBe(nowSec + 3600);
    expect(res.iceServers).toHaveLength(2);
    expect(res.iceServers[0]).toEqual({ urls: ['stun:turn.example.com:3478'] });
    expect(res.iceServers[1].urls).toEqual([
      'turn:turn.example.com:3478?transport=udp',
      'turn:turn.example.com:3478?transport=tcp',
    ]);
    expect(res.iceServers[1].username).toBe(`${nowSec + 3600}:viewer-99`);
    expect(
      verifyTurnCredentials(
        res.iceServers[1].username!,
        res.iceServers[1].credential!,
        'test-secret',
        nowSec
      ).valid
    ).toBe(true);
  });

  it('GET /api/ice-config rejects anonymous requests without a ticket and serves valid ICE config to guest ticket holders', async () => {
    const app = Fastify();
    await registerMediaRoutes(app);
    await app.ready();

    try {
      // 1. Unauthenticated & no ticket -> 401
      const unauthRes = await app.inject({
        method: 'GET',
        url: '/api/ice-config',
      });
      expect(unauthRes.statusCode).toBe(401);

      // 2. Valid guest ticket -> 200 with valid HMAC credentials
      const guestTicket = await createWsTicket({ guest: true, id: 'guest-test-1' }, 30);
      const guestRes = await app.inject({
        method: 'GET',
        url: `/api/ice-config?ticket=${encodeURIComponent(guestTicket)}`,
      });
      expect(guestRes.statusCode).toBe(200);
      const body = guestRes.json<{
        iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
        ttlSeconds: number;
      }>();

      expect(body.ttlSeconds).toBe(3600);
      const turnEntry = body.iceServers.find((s) => s.username && s.credential);
      expect(turnEntry).toBeDefined();
      expect(
        verifyTurnCredentials(turnEntry!.username!, turnEntry!.credential!, config.TURN_SECRET)
          .valid
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
});
