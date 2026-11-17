import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  channels,
  closeDb,
  db,
  follows,
  users,
} from './index.js';
import { runMigrations } from './migrate.js';

describe('Database Layer Integration Tests', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('rejects duplicate username in different case', async () => {
    const passwordHash = await argon2.hash('testpass123', {
      type: argon2.argon2id,
    });
    const baseUsername = `TestUser_${Date.now()}`;

    // Insert first user with mixed case
    const [user1] = await db
      .insert(users)
      .values({
        email: `email1_${Date.now()}@example.com`,
        username: baseUsername,
        passwordHash,
      })
      .returning();
    expect(user1).toBeDefined();

    // Attempt to insert second user with lowercase version of same username
    const lowerUsername = baseUsername.toLowerCase();
    await expect(
      db.insert(users).values({
        email: `email2_${Date.now()}@example.com`,
        username: lowerUsername,
        passwordHash,
      })
    ).rejects.toThrow();

    // Clean up
    await db.delete(users).where(eq(users.id, user1.id));
  });

  it('composite primary key on follows prevents duplicate follows', async () => {
    const passwordHash = await argon2.hash('testpass123', {
      type: argon2.argon2id,
    });

    // Create userA (viewer)
    const [viewer] = await db
      .insert(users)
      .values({
        email: `viewer_${Date.now()}@example.com`,
        username: `viewer_${Date.now()}`,
        passwordHash,
      })
      .returning();

    // Create streamer and channel
    const [streamer] = await db
      .insert(users)
      .values({
        email: `streamer_${Date.now()}@example.com`,
        username: `streamer_${Date.now()}`,
        passwordHash,
      })
      .returning();

    const [channel] = await db
      .insert(channels)
      .values({
        ownerId: streamer.id,
        name: `channel_${Date.now()}`,
        title: 'Test Stream',
        streamKeyHash: 'dummy_hash',
      })
      .returning();

    // First follow succeeds
    await db.insert(follows).values({
      userId: viewer.id,
      channelId: channel.id,
    });

    // Duplicate follow must be rejected
    await expect(
      db.insert(follows).values({
        userId: viewer.id,
        channelId: channel.id,
      })
    ).rejects.toThrow();

    // Clean up
    await db.delete(users).where(eq(users.id, viewer.id));
    await db.delete(users).where(eq(users.id, streamer.id));
  });

  it('cascades deletion correctly when a user is deleted', async () => {
    const passwordHash = await argon2.hash('testpass123', {
      type: argon2.argon2id,
    });

    // Create user with channel and follow
    const [user] = await db
      .insert(users)
      .values({
        email: `cascade_${Date.now()}@example.com`,
        username: `cascade_${Date.now()}`,
        passwordHash,
      })
      .returning();

    const [channel] = await db
      .insert(channels)
      .values({
        ownerId: user.id,
        name: `cascade_chan_${Date.now()}`,
        title: 'Cascade Channel',
        streamKeyHash: 'dummy_hash',
      })
      .returning();

    await db.insert(follows).values({
      userId: user.id,
      channelId: channel.id,
    });

    // Verify channel and follow exist
    const foundChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.ownerId, user.id));
    expect(foundChannels.length).toBe(1);

    const foundFollows = await db
      .select()
      .from(follows)
      .where(eq(follows.userId, user.id));
    expect(foundFollows.length).toBe(1);

    // Delete user
    await db.delete(users).where(eq(users.id, user.id));

    // Verify user is gone
    const deletedUsers = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(deletedUsers.length).toBe(0);

    // Verify channel was cascade deleted
    const deletedChannels = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channel.id));
    expect(deletedChannels.length).toBe(0);

    // Verify follow was cascade deleted
    const deletedFollows = await db
      .select()
      .from(follows)
      .where(eq(follows.userId, user.id));
    expect(deletedFollows.length).toBe(0);
  });
});
