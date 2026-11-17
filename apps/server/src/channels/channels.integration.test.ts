import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import {
  channels,
  closeDb,
  db,
  streams,
} from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { closeRedis, redis } from '../lib/redis.js';

describe('Channel, Category and Follow REST Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations();
    const rlKeys = await redis.keys('ratelimit:*');
    if (rlKeys.length > 0) {
      await redis.del(...rlKeys);
    }
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    await closeRedis();
  });

  const ts = Date.now();
  let userAToken = '';
  let userAChannelId = '';
  let userAUsername = '';

  let userBToken = '';
  let userBChannelId = '';
  let userBUsername = '';

  let gamingCategoryId = '';

  it('sets up test users, channels and retrieves categories', async () => {
    // 1. Get categories
    const catRes = await app.inject({
      method: 'GET',
      url: '/api/categories',
    });
    expect(catRes.statusCode).toBe(200);
    const catList = JSON.parse(catRes.body);
    expect(catList.length).toBeGreaterThan(0);
    const gaming = catList.find((c: { name: string }) => c.name === 'Gaming');
    gamingCategoryId = gaming?.id || catList[0].id;

    // 2. Register user A
    userAUsername = `usera_${ts}`;
    const resA = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `usera_${ts}@netstream.live`,
        username: userAUsername,
        password: 'Password123!',
      },
    });
    expect(resA.statusCode).toBe(201);
    const dataA = JSON.parse(resA.body);
    userAToken = dataA.accessToken;

    // Get user A channel
    const meA = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    userAChannelId = JSON.parse(meA.body).channel.id;

    // 3. Register user B
    userBUsername = `userb_${ts}`;
    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `userb_${ts}@netstream.live`,
        username: userBUsername,
        password: 'Password123!',
      },
    });
    expect(resB.statusCode).toBe(201);
    const dataB = JSON.parse(resB.body);
    userBToken = dataB.accessToken;

    // Get user B channel
    const meB = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${userBToken}` },
    });
    userBChannelId = JSON.parse(meB.body).channel.id;
  });

  it('1. owner-only PATCH: allows owner to update title and category, rejects unauthenticated and invalid payload', async () => {
    // 1a. Unauthenticated PATCH is rejected
    const unauthRes = await app.inject({
      method: 'PATCH',
      url: '/api/channels/me',
      payload: { title: 'Updated Without Auth' },
    });
    expect(unauthRes.statusCode).toBe(401);

    // 1b. Title longer than 100 chars is rejected
    const longTitleRes = await app.inject({
      method: 'PATCH',
      url: '/api/channels/me',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: { title: 'A'.repeat(101) },
    });
    expect(longTitleRes.statusCode).toBe(400);

    // 1c. Invalid category ID is rejected
    const badCatRes = await app.inject({
      method: 'PATCH',
      url: '/api/channels/me',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: { categoryId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(badCatRes.statusCode).toBe(400);

    // 1d. Owner updates title and category
    const validPatchRes = await app.inject({
      method: 'PATCH',
      url: '/api/channels/me',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        title: "User A's Updated Stream Title",
        categoryId: gamingCategoryId,
      },
    });
    expect(validPatchRes.statusCode).toBe(200);
    const patchedChannel = JSON.parse(validPatchRes.body);
    expect(patchedChannel.title).toBe("User A's Updated Stream Title");
    expect(patchedChannel.category.id).toBe(gamingCategoryId);

    // Verify User B channel was NOT modified
    const checkB = await app.inject({
      method: 'GET',
      url: `/api/channels/${userBUsername}`,
    });
    const channelBData = JSON.parse(checkB.body);
    expect(channelBData.title).not.toBe("User A's Updated Stream Title");
  });

  it('2. key shown once and hash stored: generates base64url key and stores SHA-256 hash', async () => {
    const rotateRes = await app.inject({
      method: 'POST',
      url: '/api/channels/me/stream-key/rotate',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(rotateRes.statusCode).toBe(200);
    const { streamKey } = JSON.parse(rotateRes.body);
    expect(streamKey).toBeDefined();
    expect(typeof streamKey).toBe('string');
    expect(streamKey.length).toBeGreaterThan(30);

    // Verify in database: only the SHA-256 hash is stored
    const [dbChannel] = await db
      .select({ streamKeyHash: channels.streamKeyHash })
      .from(channels)
      .where(eq(channels.id, userAChannelId));

    const expectedHash = crypto
      .createHash('sha256')
      .update(streamKey)
      .digest('hex');

    expect(dbChannel.streamKeyHash).toBe(expectedHash);
    expect(dbChannel.streamKeyHash).not.toBe(streamKey);

    // Ensure public endpoint does not leak stream key or hash
    const publicRes = await app.inject({
      method: 'GET',
      url: `/api/channels/${userAUsername}`,
    });
    const publicBody = JSON.parse(publicRes.body);
    expect(publicBody.streamKey).toBeUndefined();
    expect(publicBody.streamKeyHash).toBeUndefined();
  });

  it('3. follow idempotence: following twice does not error or duplicate, unfollowing works', async () => {
    // 3a. User A follows User B
    const follow1 = await app.inject({
      method: 'POST',
      url: `/api/channels/${userBChannelId}/follow`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(follow1.statusCode).toBe(200);
    expect(JSON.parse(follow1.body)).toEqual({ ok: true, isFollowing: true });

    // 3b. User A follows User B again (idempotent)
    const follow2 = await app.inject({
      method: 'POST',
      url: `/api/channels/${userBChannelId}/follow`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(follow2.statusCode).toBe(200);
    expect(JSON.parse(follow2.body)).toEqual({ ok: true, isFollowing: true });

    // 3c. Check followerCount and isFollowing via GET /api/channels/:name
    const channelB = await app.inject({
      method: 'GET',
      url: `/api/channels/${userBUsername}`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    const bodyB = JSON.parse(channelB.body);
    expect(bodyB.followerCount).toBe(1);
    expect(bodyB.isFollowing).toBe(true);

    // 3d. Unfollow User B
    const unfollow1 = await app.inject({
      method: 'DELETE',
      url: `/api/channels/${userBChannelId}/follow`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(unfollow1.statusCode).toBe(200);
    expect(JSON.parse(unfollow1.body)).toEqual({ ok: true, isFollowing: false });

    // 3e. Unfollow User B again (idempotent)
    const unfollow2 = await app.inject({
      method: 'DELETE',
      url: `/api/channels/${userBChannelId}/follow`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(unfollow2.statusCode).toBe(200);
    expect(JSON.parse(unfollow2.body)).toEqual({ ok: true, isFollowing: false });

    // Verify followerCount is back to 0
    const channelBAfter = await app.inject({
      method: 'GET',
      url: `/api/channels/${userBUsername}`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(JSON.parse(channelBAfter.body).followerCount).toBe(0);
    expect(JSON.parse(channelBAfter.body).isFollowing).toBe(false);
  });

  it('4. self-follow rejected: users cannot follow their own channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/channels/${userAChannelId}/follow`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('CANNOT_FOLLOW_SELF');
  });

  it('5. following list ordering: followed channels with isLive, newest live first', async () => {
    // Create Streamer 1 (live, older stream)
    const s1Res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `streamer1_${ts}@netstream.live`,
        username: `s1_${ts}`,
        password: 'Password123!',
      },
    });
    const s1Token = JSON.parse(s1Res.body).accessToken;
    const s1Me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${s1Token}` },
    });
    const s1ChanId = JSON.parse(s1Me.body).channel.id;

    // Create Streamer 2 (live, newer stream)
    const s2Res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `streamer2_${ts}@netstream.live`,
        username: `s2_${ts}`,
        password: 'Password123!',
      },
    });
    const s2Token = JSON.parse(s2Res.body).accessToken;
    const s2Me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${s2Token}` },
    });
    const s2ChanId = JSON.parse(s2Me.body).channel.id;

    // Create Streamer 3 (offline)
    const s3Res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `streamer3_${ts}@netstream.live`,
        username: `s3_${ts}`,
        password: 'Password123!',
      },
    });
    const s3Token = JSON.parse(s3Res.body).accessToken;
    const s3Me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${s3Token}` },
    });
    const s3ChanId = JSON.parse(s3Me.body).channel.id;

    // Set streamer 1 live with older stream
    await db.update(channels).set({ isLive: true }).where(eq(channels.id, s1ChanId));
    await db.insert(streams).values({
      channelId: s1ChanId,
      title: 'Older Live Stream',
      startedAt: new Date(Date.now() - 3600000), // 1 hour ago
    });

    // Set streamer 2 live with newer stream
    await db.update(channels).set({ isLive: true }).where(eq(channels.id, s2ChanId));
    await db.insert(streams).values({
      channelId: s2ChanId,
      title: 'Newer Live Stream',
      startedAt: new Date(Date.now() - 60000), // 1 minute ago
    });

    // User A follows s1, s2, and s3
    await app.inject({
      method: 'POST',
      url: `/api/channels/${s1ChanId}/follow`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    await app.inject({
      method: 'POST',
      url: `/api/channels/${s2ChanId}/follow`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    await app.inject({
      method: 'POST',
      url: `/api/channels/${s3ChanId}/follow`,
      headers: { authorization: `Bearer ${userAToken}` },
    });

    // Fetch following list
    const followingRes = await app.inject({
      method: 'GET',
      url: '/api/me/following',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(followingRes.statusCode).toBe(200);
    const following = JSON.parse(followingRes.body);

    expect(following.length).toBeGreaterThanOrEqual(3);

    // S2 (newer live) must come before S1 (older live)
    const indexS2 = following.findIndex((c: { id: string }) => c.id === s2ChanId);
    const indexS1 = following.findIndex((c: { id: string }) => c.id === s1ChanId);
    const indexS3 = following.findIndex((c: { id: string }) => c.id === s3ChanId);

    expect(indexS2).toBeLessThan(indexS1);
    // S1 (live) must come before S3 (offline)
    expect(indexS1).toBeLessThan(indexS3);
    expect(following[indexS3].isLive).toBe(false);
    expect(following[indexS2].isLive).toBe(true);
  });

  it('6. live list filtering: returns live channels and filters by category and q', async () => {
    // We already have s1 and s2 live from previous test
    const allLiveRes = await app.inject({
      method: 'GET',
      url: '/api/live',
    });
    expect(allLiveRes.statusCode).toBe(200);
    const allLive = JSON.parse(allLiveRes.body);
    expect(allLive.length).toBeGreaterThanOrEqual(2);
    expect(allLive.every((c: { viewerCount: number }) => c.viewerCount === 0)).toBe(true);

    // Set s2 category to Gaming
    await db.update(channels).set({ categoryId: gamingCategoryId, title: 'Epic Gaming Stream' }).where(eq(channels.name, `s2_${ts}`));

    // Filter by category
    const catFilterRes = await app.inject({
      method: 'GET',
      url: '/api/live?category=Gaming',
    });
    expect(catFilterRes.statusCode).toBe(200);
    const catFiltered = JSON.parse(catFilterRes.body);
    expect(catFiltered.some((c: { name: string }) => c.name === `s2_${ts}`)).toBe(true);

    // Filter by query q
    const qFilterRes = await app.inject({
      method: 'GET',
      url: '/api/live?q=Epic',
    });
    expect(qFilterRes.statusCode).toBe(200);
    const qFiltered = JSON.parse(qFilterRes.body);
    expect(qFiltered.length).toBeGreaterThanOrEqual(1);
    expect(qFiltered[0].name).toBe(`s2_${ts}`);

    // Filter non-existent
    const noneRes = await app.inject({
      method: 'GET',
      url: '/api/live?q=NonExistentQueryStringXYZ',
    });
    expect(noneRes.statusCode).toBe(200);
    expect(JSON.parse(noneRes.body)).toEqual([]);
  });
});
