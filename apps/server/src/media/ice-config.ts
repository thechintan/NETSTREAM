import crypto from 'node:crypto';
import { config } from '../config/index.js';

export const ICE_CREDENTIAL_TTL_SECONDS = 3600; // 1 hour

export interface IceServerEntry {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceConfigResponse {
  iceServers: IceServerEntry[];
  ttlSeconds: number;
  expiresAt: number;
}

export interface TurnCredentials {
  username: string;
  credential: string;
  expiresAt: number;
}

/**
 * Generates coturn TURN REST API time-limited HMAC-SHA1 credentials.
 * - username = `<expiryUnixSeconds>:<userId>`
 * - credential = base64(HMAC-SHA1(secret, username))
 */
export function generateTurnCredentials(
  userId: string,
  secret: string,
  options?: { nowSec?: number; ttlSeconds?: number }
): TurnCredentials {
  const ttlSeconds = options?.ttlSeconds ?? ICE_CREDENTIAL_TTL_SECONDS;
  const nowSec = Math.floor(options?.nowSec ?? Date.now() / 1000);
  const expiresAt = nowSec + ttlSeconds;
  const username = `${expiresAt}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');

  return { username, credential, expiresAt };
}

/**
 * Verifies TURN credentials using the exact algorithm coturn's `use-auth-secret` uses:
 * 1. Parse `<expiry>:<userId>`
 * 2. Ensure `expiry > nowSec`
 * 3. Recompute base64 HMAC-SHA1(secret, username) and compare in constant time
 */
export function verifyTurnCredentials(
  username: string,
  credential: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): { valid: boolean; reason?: string; userId?: string; expiresAt?: number } {
  const sepIdx = username.indexOf(':');
  if (sepIdx <= 0 || sepIdx === username.length - 1) {
    return { valid: false, reason: 'MALFORMED_USERNAME' };
  }

  const expiryStr = username.slice(0, sepIdx);
  const userId = username.slice(sepIdx + 1);
  if (!/^\d+$/.test(expiryStr)) {
    return { valid: false, reason: 'INVALID_EXPIRY' };
  }

  const expiresAt = Number.parseInt(expiryStr, 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSec) {
    return { valid: false, reason: 'EXPIRED', userId, expiresAt };
  }

  const expected = crypto.createHmac('sha1', secret).update(username).digest('base64');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(credential, 'utf8');

  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return { valid: false, reason: 'INVALID_SIGNATURE', userId, expiresAt };
  }

  return { valid: true, userId, expiresAt };
}

export function buildIceConfig(
  userId: string,
  options?: {
    turnHost?: string;
    turnSecret?: string;
    nowSec?: number;
    ttlSeconds?: number;
  }
): IceConfigResponse {
  const turnHost = options?.turnHost ?? config.TURN_HOST;
  const turnSecret = options?.turnSecret ?? config.TURN_SECRET;
  const ttlSeconds = options?.ttlSeconds ?? ICE_CREDENTIAL_TTL_SECONDS;
  const creds = generateTurnCredentials(userId, turnSecret, {
    nowSec: options?.nowSec,
    ttlSeconds,
  });

  return {
    iceServers: [
      {
        urls: [`stun:${turnHost}:3478`],
      },
      {
        urls: [
          `turn:${turnHost}:3478?transport=udp`,
          `turn:${turnHost}:3478?transport=tcp`,
        ],
        username: creds.username,
        credential: creds.credential,
      },
    ],
    ttlSeconds,
    expiresAt: creds.expiresAt,
  };
}
