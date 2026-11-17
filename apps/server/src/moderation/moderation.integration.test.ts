import crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { config } from '../config/index.js';
import { bans, db, modActions } from '../db/index.js';
import { createWsTicket } from '../auth/ticket.js';
import {
  can,
  canModerateTarget,
  ModerationAction,
} from './service.js';

describe('Task 9: Roles and Moderation Integration Tests', () => {
  let app: ReturnType<typeof buildApp>;
  let wsBaseUrl: string;

  // Real test users
  let ownerUser: { id: string; username: string; token: string; channelId: string };
  let modUser: { id: string; username: string; token: string; channelId: string };
  let otherModUser: { id: string; username: string; token: string; channelId: string };
  let viewerUser: { id: string; username: string; token: string; channelId: string };

  async function registerUser(prefix: string) {
    const username = `${prefix.slice(0, 4)}_${Date.now().toString().slice(-6)}_${Math.random().toString(36).slice(2, 6)}`;
    const email = `${username}@example.com`;
    const password = 'Password123!';
    const fakeIp = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

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
    const meBody = meRes.json();

    return {
      id: body.user.id as string,
      username: body.user.username as string,
      token,
      channelId: meBody.channel.id as string,
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

    // Create real test accounts in DB
    ownerUser = await registerUser('owner');
    modUser = await registerUser('mod');
    otherModUser = await registerUser('othermod');
    viewerUser = await registerUser('viewer');

    // Add modUser as moderator to owner's channel via REST
    const addModRes = await app.inject({
      method: 'POST',
      url: `/api/channels/${ownerUser.channelId}/mods`,
      headers: { authorization: `Bearer ${ownerUser.token}` },
      payload: { username: modUser.username },
    });
    expect(addModRes.statusCode).toBe(201);

    // Add otherModUser as moderator as well
    const addOtherModRes = await app.inject({
      method: 'POST',
      url: `/api/channels/${ownerUser.channelId}/mods`,
      headers: { authorization: `Bearer ${ownerUser.token}` },
      payload: { username: otherModUser.username },
    });
    expect(addOtherModRes.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Permission matrix: validates can() for every role x every action', async () => {
    const channelId = ownerUser.channelId;

    const allActions: ModerationAction[] = [
      'chat:send',
      'chat:delete',
      'chat:timeout',
      'chat:ban',
      'chat:slow',
      'mod:manage',
    ];

    // Expected matrix:
    // owner: can do everything (6 true)
    // moderator: can do everything EXCEPT mod:manage
    // viewer: can only chat:send
    // guest: cannot do any action

    for (const action of allActions) {
      // Owner
      const ownerCan = await can(ownerUser, channelId, action);
      expect(ownerCan).toBe(true);

      // Moderator
      const modCan = await can(modUser, channelId, action);
      if (action === 'mod:manage') {
        expect(modCan).toBe(false);
      } else {
        expect(modCan).toBe(true);
      }

      // Viewer
      const viewerCan = await can(viewerUser, channelId, action);
      if (action === 'chat:send') {
        expect(viewerCan).toBe(true);
      } else {
        expect(viewerCan).toBe(false);
      }

      // Guest
      const guestCan = await can({ guest: true, id: crypto.randomUUID() }, channelId, action);
      expect(guestCan).toBe(false);
    }
  });

  it('2. Moderation immunity rules: mod cannot ban owner, mod cannot ban another mod', async () => {
    const channelId = ownerUser.channelId;

    // Mod targeting Owner -> forbidden
    const modVsOwner = await canModerateTarget(modUser.id, ownerUser.id, channelId);
    expect(modVsOwner.ok).toBe(false);
    expect(modVsOwner.reason).toContain('owner');

    // Mod targeting another Mod -> forbidden
    const modVsMod = await canModerateTarget(modUser.id, otherModUser.id, channelId);
    expect(modVsMod.ok).toBe(false);
    expect(modVsMod.reason).toContain('other moderators');

    // Mod targeting Viewer -> allowed
    const modVsViewer = await canModerateTarget(modUser.id, viewerUser.id, channelId);
    expect(modVsViewer.ok).toBe(true);

    // Owner targeting Mod -> allowed
    const ownerVsMod = await canModerateTarget(ownerUser.id, modUser.id, channelId);
    expect(ownerVsMod.ok).toBe(true);

    // Target self -> forbidden
    const modVsSelf = await canModerateTarget(modUser.id, modUser.id, channelId);
    expect(modVsSelf.ok).toBe(false);
  });

  it('3. REST moderation endpoints: owner adds/removes mods, viewer is rejected', async () => {
    const channelId = ownerUser.channelId;
    const tempUser = await registerUser('tempmod');

    // Non-owner (viewer) trying to add a mod -> 403 Forbidden
    const viewerAttempt = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/mods`,
      headers: { authorization: `Bearer ${viewerUser.token}` },
      payload: { username: tempUser.username },
    });
    expect(viewerAttempt.statusCode).toBe(403);

    // Owner adding tempUser -> 201 Created
    const addRes = await app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/mods`,
      headers: { authorization: `Bearer ${ownerUser.token}` },
      payload: { username: tempUser.username },
    });
    expect(addRes.statusCode).toBe(201);
    expect(addRes.json().username).toBe(tempUser.username);

    // GET /api/channels/:id/mods lists the new mod
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/mods`,
    });
    expect(listRes.statusCode).toBe(200);
    const modsList = listRes.json().mods as Array<{ userId: string; username: string }>;
    expect(modsList.some((m) => m.username === tempUser.username)).toBe(true);

    // Owner removing tempUser -> 200 OK
    const removeRes = await app.inject({
      method: 'DELETE',
      url: `/api/channels/${channelId}/mods`,
      headers: { authorization: `Bearer ${ownerUser.token}` },
      payload: { username: tempUser.username },
    });
    expect(removeRes.statusCode).toBe(200);

    // Confirm removed from list
    const listAfterRes = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}/mods`,
    });
    const modsListAfter = listAfterRes.json().mods as Array<{ userId: string; username: string }>;
    expect(modsListAfter.some((m) => m.username === tempUser.username)).toBe(false);
  });

  it('4. WebSocket mod.delete broadcasts chat.deleted to all connected clients in the room', async () => {
    const channelId = ownerUser.channelId;

    const modWs = await connectClient({ id: modUser.id, username: modUser.username, guest: false });
    const viewerWs = await connectClient({ id: viewerUser.id, username: viewerUser.username, guest: false });

    await request(modWs, 'chat.join', { channelId });
    await request(viewerWs, 'chat.join', { channelId });

    // Viewer sends a message
    const sendAck = await request<{ mid: string }>(viewerWs, 'chat.send', {
      channelId,
      text: 'This message will be deleted by a mod',
    });
    const messageMid = sendAck.d.mid;
    expect(messageMid).toBeDefined();

    // Set up listener on viewerWs for chat.deleted
    const deletedPromise = new Promise<{ mid: string }>((resolve) => {
      const handler = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.t === 'chat.deleted' && parsed.d?.mid === messageMid) {
            viewerWs.off('message', handler);
            resolve(parsed.d);
          }
        } catch {
          // ignore
        }
      };
      viewerWs.on('message', handler);
    });

    // Moderator deletes the message
    const deleteAck = await request<{ ok: boolean; mid: string }>(modWs, 'mod.delete', {
      channelId,
      mid: messageMid,
    });
    expect(deleteAck.d.ok).toBe(true);

    // Verify broadcast was received by viewer
    const receivedDeletion = await deletedPromise;
    expect(receivedDeletion.mid).toBe(messageMid);

    modWs.close();
    viewerWs.close();
  });

  it('5. Timeout expiry: viewer is rejected while timed out, allowed after TTL expires', async () => {
    const channelId = ownerUser.channelId;
    const modWs = await connectClient({ id: modUser.id, username: modUser.username, guest: false });
    const viewerWs = await connectClient({ id: viewerUser.id, username: viewerUser.username, guest: false });

    await request(modWs, 'chat.join', { channelId });
    await request(viewerWs, 'chat.join', { channelId });

    // Moderator times out viewer for 1 second
    const timeoutAck = await request<{ ok: boolean }>(modWs, 'mod.timeout', {
      channelId,
      userId: viewerUser.id,
      seconds: 1,
      reason: 'Spamming',
    });
    expect(timeoutAck.d.ok).toBe(true);

    // Viewer immediately attempts to send message -> fails with TIMED_OUT
    let errorCaught: { code?: string; message?: string } | null = null;
    try {
      await request(viewerWs, 'chat.send', {
        channelId,
        text: 'I am timed out right now',
      });
    } catch (err: unknown) {
      errorCaught = err as { code?: string; message?: string };
    }
    expect(errorCaught).not.toBeNull();
    expect(errorCaught?.code).toBe('TIMED_OUT');

    // Wait 1150ms for the 1-second timeout to expire in Redis
    await new Promise((resolve) => setTimeout(resolve, 1150));

    // Viewer attempts to send message again -> succeeds!
    const sendAfterTimeout = await request<{ ok: boolean; mid: string }>(viewerWs, 'chat.send', {
      channelId,
      text: 'Timeout is now over, I can chat again!',
    });
    expect(sendAfterTimeout.d.ok).toBe(true);

    modWs.close();
    viewerWs.close();
  });

  it('6. Ban enforcement & persistence: banned user is kicked, remains banned on reconnect, mod cannot ban owner', async () => {
    const channelId = ownerUser.channelId;
    const modWs = await connectClient({ id: modUser.id, username: modUser.username, guest: false });
    const viewerWs = await connectClient({ id: viewerUser.id, username: viewerUser.username, guest: false });

    await request(modWs, 'chat.join', { channelId });
    await request(viewerWs, 'chat.join', { channelId });

    // Mod attempts to ban channel owner -> rejected with FORBIDDEN
    let modBanOwnerError: { code?: string; message?: string } | null = null;
    try {
      await request(modWs, 'mod.ban', {
        channelId,
        userId: ownerUser.id,
      });
    } catch (err: unknown) {
      modBanOwnerError = err as { code?: string; message?: string };
    }
    expect(modBanOwnerError).not.toBeNull();
    expect(modBanOwnerError?.code).toBe('FORBIDDEN');
    expect(modBanOwnerError?.message).toContain('owner');

    // Mod bans the viewer
    const banAck = await request<{ ok: boolean; userId: string }>(modWs, 'mod.ban', {
      channelId,
      userId: viewerUser.id,
      reason: 'Toxic behavior',
    });
    expect(banAck.d.ok).toBe(true);

    // Give Redis pub/sub a tick to process kick
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Viewer closes connection and reconnects with a fresh ticket
    viewerWs.close();

    const reconnectedViewerWs = await connectClient({
      id: viewerUser.id,
      username: viewerUser.username,
      guest: false,
    });

    await request(reconnectedViewerWs, 'chat.join', { channelId });

    // Viewer attempts to send message -> rejected with BANNED
    let banCaught: { code?: string; message?: string } | null = null;
    try {
      await request(reconnectedViewerWs, 'chat.send', {
        channelId,
        text: 'Did the ban stick after reconnect?',
      });
    } catch (err: unknown) {
      banCaught = err as { code?: string; message?: string };
    }
    expect(banCaught).not.toBeNull();
    expect(banCaught?.code).toBe('BANNED');

    // Verify ban record exists in PostgreSQL bans table
    const dbBans = await db
      .select()
      .from(bans)
      .where(eq(bans.channelId, channelId));
    expect(dbBans.some((b) => b.userId === viewerUser.id)).toBe(true);

    // Verify mod_actions audit table has recorded the ban
    const actions = await db
      .select()
      .from(modActions)
      .where(eq(modActions.channelId, channelId));
    expect(actions.some((a) => a.action === 'ban' && a.targetUserId === viewerUser.id)).toBe(true);

    modWs.close();
    reconnectedViewerWs.close();
  });

  it('7. Chat badges: messages from owner carry owner badge, mod carry mod badge', async () => {
    const channelId = ownerUser.channelId;

    const ownerWs = await connectClient({ id: ownerUser.id, username: ownerUser.username, guest: false });
    const modWs = await connectClient({ id: modUser.id, username: modUser.username, guest: false });

    await request(ownerWs, 'chat.join', { channelId });
    await request(modWs, 'chat.join', { channelId });

    // Listen for owner message on modWs
    const ownerMsgPromise = new Promise<{ badges: string[] }>((resolve) => {
      const handler = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.t === 'chat.message' && parsed.d?.text === 'Hello from stream owner!') {
            modWs.off('message', handler);
            resolve(parsed.d.user);
          }
        } catch {
          // ignore
        }
      };
      modWs.on('message', handler);
    });

    await request(ownerWs, 'chat.send', {
      channelId,
      text: 'Hello from stream owner!',
    });

    const ownerMsgUser = await ownerMsgPromise;
    expect(ownerMsgUser.badges).toContain('owner');

    // Listen for mod message on ownerWs
    const modMsgPromise = new Promise<{ badges: string[] }>((resolve) => {
      const handler = (data: Buffer | string) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.t === 'chat.message' && parsed.d?.text === 'Hello from channel moderator!') {
            ownerWs.off('message', handler);
            resolve(parsed.d.user);
          }
        } catch {
          // ignore
        }
      };
      ownerWs.on('message', handler);
    });

    await request(modWs, 'chat.send', {
      channelId,
      text: 'Hello from channel moderator!',
    });

    const modMsgUser = await modMsgPromise;
    expect(modMsgUser.badges).toContain('mod');

    ownerWs.close();
    modWs.close();
  });
});
