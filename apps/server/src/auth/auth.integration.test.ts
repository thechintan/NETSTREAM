import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { closeRedis, redis } from '../lib/redis.js';
import { redeemTicket } from './ticket.js';

describe('Authentication & Sessions Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations();
    // Clear residual rate limit keys from prior test runs
    const ratelimitKeys = await redis.keys('ratelimit:*');
    if (ratelimitKeys.length > 0) {
      await redis.del(...ratelimitKeys);
    }
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    await closeRedis();
  });

  const timestamp = Date.now();
  const testUser = {
    email: `auth_test_${timestamp}@netstream.live`,
    username: `user_${timestamp}`,
    password: 'Password123!',
  };

  let userAccessToken = '';
  let userRefreshToken = '';

  it('1. registers a new user, creates their channel, and returns access token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: testUser,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(testUser.email.toLowerCase());
    expect(body.user.username).toBe(testUser.username);
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.accessToken).toBeDefined();

    // Check refresh token cookie
    const cookie = res.cookies.find((c) => c.name === 'refreshToken');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);

    userAccessToken = body.accessToken;
    userRefreshToken = cookie!.value;
  });

  it('2. rejects registration with duplicate email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: testUser.email,
        username: `diff_${Date.now()}`,
        password: 'Password123!',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('EMAIL_EXISTS');
  });

  it('3. rejects registration with duplicate username (case-insensitive)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `new_email_${Date.now()}@netstream.live`,
        username: testUser.username.toUpperCase(),
        password: 'Password123!',
      },
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('USERNAME_EXISTS');
  });

  it('4. login success and failure with identical error for unknown user vs bad password', async () => {
    // 4a. Failure with wrong password
    const resBadPass = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: testUser.username,
        password: 'WrongPassword999!',
      },
    });
    expect(resBadPass.statusCode).toBe(401);
    const badPassBody = JSON.parse(resBadPass.body);
    expect(badPassBody.error).toBe('INVALID_CREDENTIALS');

    // 4b. Failure with unknown user
    const resUnknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'nonexistent_user_99999',
        password: 'WrongPassword999!',
      },
    });
    expect(resUnknown.statusCode).toBe(401);
    const unknownBody = JSON.parse(resUnknown.body);
    expect(unknownBody.error).toBe('INVALID_CREDENTIALS');
    // Error message must be identical
    expect(badPassBody.message).toBe(unknownBody.message);

    // 4c. Successful login
    const resSuccess = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identifier: testUser.username,
        password: testUser.password,
      },
    });
    expect(resSuccess.statusCode).toBe(200);
    const successBody = JSON.parse(resSuccess.body);
    expect(successBody.accessToken).toBeDefined();
    expect(successBody.user.username).toBe(testUser.username);

    const cookie = resSuccess.cookies.find((c) => c.name === 'refreshToken');
    expect(cookie).toBeDefined();
    userRefreshToken = cookie!.value;
    userAccessToken = successBody.accessToken;
  });

  it('5. refresh token rotation: old token is invalidated and new token works', async () => {
    const oldToken = userRefreshToken;

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refreshToken: oldToken },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessToken).toBeDefined();

    const newCookie = res.cookies.find((c) => c.name === 'refreshToken');
    expect(newCookie).toBeDefined();
    expect(newCookie!.value).not.toBe(oldToken);

    userRefreshToken = newCookie!.value;
    userAccessToken = body.accessToken;
  });

  it('6. reuse of an old refresh token revokes the entire token family', async () => {
    // Create a dedicated user for this test to isolate
    const resRegister = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `reuse_test_${Date.now()}@netstream.live`,
        username: `reuse_${Date.now()}`,
        password: 'Password123!',
      },
    });
    expect(resRegister.statusCode).toBe(201);
    const token1 = resRegister.cookies.find((c) => c.name === 'refreshToken')!.value;

    // Normal refresh: token1 -> token2
    const resRefresh1 = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refreshToken: token1 },
    });
    expect(resRefresh1.statusCode).toBe(200);
    const token2 = resRefresh1.cookies.find((c) => c.name === 'refreshToken')!.value;

    // Attacker tries to reuse token1
    const resReuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refreshToken: token1 },
    });
    expect(resReuse.statusCode).toBe(401);
    const reuseBody = JSON.parse(resReuse.body);
    expect(reuseBody.error).toBe('TOKEN_REUSED');

    // Token2 must now also be revoked
    const resToken2 = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refreshToken: token2 },
    });
    expect(resToken2.statusCode).toBe(401);
  });

  it('7. logout clears cookies and invalidates refresh token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { refreshToken: userRefreshToken },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);

    const clearedCookie = res.cookies.find((c) => c.name === 'refreshToken');
    expect(clearedCookie?.value).toBe('');

    // Calling refresh with the logged out token must fail
    const resRefresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refreshToken: userRefreshToken },
    });
    expect(resRefresh.statusCode).toBe(401);
  });

  it('8. /api/me works with valid token and fails without token', async () => {
    // 8a. Without token
    const resNoToken = await app.inject({
      method: 'GET',
      url: '/api/me',
    });
    expect(resNoToken.statusCode).toBe(401);

    // 8b. With token
    const resWithToken = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${userAccessToken}` },
    });
    expect(resWithToken.statusCode).toBe(200);
    const body = JSON.parse(resWithToken.body);
    expect(body.user).toBeDefined();
    expect(body.user.username).toBe(testUser.username);
    expect(body.channel).toBeDefined();
    expect(body.channel.name).toBe(testUser.username);
  });

  it('9. ws-ticket: redeemed once, rejected on 2nd attempt, rejected after TTL', async () => {
    // 9a. Authenticated ticket redeemed once
    const resAuth = await app.inject({
      method: 'POST',
      url: '/api/ws-ticket',
      headers: { authorization: `Bearer ${userAccessToken}` },
    });
    expect(resAuth.statusCode).toBe(200);
    const { ticket: authTicket } = JSON.parse(resAuth.body);
    expect(authTicket).toBeDefined();

    const data1 = await redeemTicket(authTicket);
    expect(data1).toBeDefined();
    expect(data1?.guest).toBe(false);
    if (!data1?.guest) {
      expect(data1?.username).toBe(testUser.username);
    }

    // 9b. Second attempt to redeem same ticket must fail (atomic getdel)
    const data2 = await redeemTicket(authTicket);
    expect(data2).toBeNull();

    // 9c. Guest ticket
    const resGuest = await app.inject({
      method: 'POST',
      url: '/api/ws-ticket',
    });
    expect(resGuest.statusCode).toBe(200);
    const { ticket: guestTicket } = JSON.parse(resGuest.body);
    const guestData = await redeemTicket(guestTicket);
    expect(guestData).toBeDefined();
    expect(guestData?.guest).toBe(true);

    // 9d. Expiration after TTL
    const resShortTtl = await app.inject({
      method: 'POST',
      url: '/api/ws-ticket',
      headers: { 'x-ticket-ttl': '1' }, // 1 second TTL override
    });
    const { ticket: expiringTicket } = JSON.parse(resShortTtl.body);

    // Wait 1.2s for Redis key to expire
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const expiredData = await redeemTicket(expiringTicket);
    expect(expiredData).toBeNull();
  });

  it('10. triggers rate limiting after exceeding threshold', async () => {
    const rateLimitedUser = `ratelimit_${Date.now()}`;
    const rateLimitedIp = '192.168.1.100';

    // 10 attempts allowed
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: rateLimitedIp,
        payload: {
          username: rateLimitedUser,
          password: 'WrongPassword!',
        },
      });
      expect(res.statusCode).toBe(401);
    }

    // 11th attempt must trigger rate limit 429
    const resBlocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: rateLimitedIp,
      payload: {
        username: rateLimitedUser,
        password: 'WrongPassword!',
      },
    });
    expect(resBlocked.statusCode).toBe(429);
    const body = JSON.parse(resBlocked.body);
    expect(body.error).toBe('RATE_LIMITED');
  });
});
