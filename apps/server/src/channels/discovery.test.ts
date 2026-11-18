import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { categories, channels, db, users } from '../db/index.js';
import { getLiveChannelsByCategory, searchDiscovery } from './service.js';

describe('Discovery search & category live (Task 19)', () => {
  const prefix = `disc_${crypto.randomBytes(4).toString('hex')}`;
  const createdUserIds: string[] = [];
  const createdCategoryIds: string[] = [];

  beforeAll(async () => {
    // Seed 2 distinct test categories
    const [catPrimary] = await db
      .insert(categories)
      .values({ name: `${prefix}_QuantumNetworking` })
      .returning({ id: categories.id });
    const [catSecondary] = await db
      .insert(categories)
      .values({ name: `${prefix}_QuantumOther` })
      .returning({ id: categories.id });
    createdCategoryIds.push(catPrimary.id, catSecondary.id);

    // Seed 3 users + channels:
    // 1. Offline exact name match
    // 2. Live partial match (must rank ABOVE offline exact match due to live-first rule!)
    // 3. Offline weaker match
    const userSpecs = [
      {
        username: `${prefix}_exact`,
        chanName: `${prefix}_alpha`,
        title: 'Offline exact channel',
        isLive: false,
        categoryId: catPrimary.id,
      },
      {
        username: `${prefix}_live`,
        chanName: `${prefix}_alpha_stream`,
        title: 'Live partial match',
        isLive: true,
        categoryId: catPrimary.id,
      },
      {
        username: `${prefix}_loose`,
        chanName: `${prefix}_other_zz`,
        title: `Talking about ${prefix}_alpha networks`,
        isLive: false,
        categoryId: catSecondary.id,
      },
    ];

    for (const spec of userSpecs) {
      const [u] = await db
        .insert(users)
        .values({
          email: `${spec.username}@example.test`,
          username: spec.username,
          passwordHash: 'not-used-in-test',
        })
        .returning({ id: users.id });
      createdUserIds.push(u.id);

      await db.insert(channels).values({
        ownerId: u.id,
        name: spec.chanName,
        title: spec.title,
        isLive: spec.isLive,
        categoryId: spec.categoryId,
        streamKeyHash: crypto.randomBytes(16).toString('hex'),
      });
    }
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(categories).where(inArray(categories.id, createdCategoryIds));
    }
  });

  it('ranks live channels above offline channels even when offline has an exact name match', async () => {
    const res = await searchDiscovery(`${prefix}_alpha`);

    expect(res.channels.length).toBeGreaterThanOrEqual(3);
    // Live channel MUST come first despite lower exact similarity than offline exact match
    expect(res.channels[0].name).toBe(`${prefix}_alpha_stream`);
    expect(res.channels[0].isLive).toBe(true);

    // Among offline channels, closer trigram similarity ranks before looser title match
    const offlineNames = res.channels.filter((c) => !c.isLive).map((c) => c.name);
    expect(offlineNames.indexOf(`${prefix}_alpha`)).toBeLessThan(
      offlineNames.indexOf(`${prefix}_other_zz`)
    );
  });

  it('ranks matching categories by trigram similarity', async () => {
    const res = await searchDiscovery(`${prefix}_QuantumNetworking`);

    expect(res.categories.length).toBeGreaterThanOrEqual(1);
    expect(res.categories[0].name).toBe(`${prefix}_QuantumNetworking`);
  });

  it('lists only live channels in a category via getLiveChannelsByCategory', async () => {
    const res = await getLiveChannelsByCategory(createdCategoryIds[0]);

    expect(res).not.toBeNull();
    expect(res?.category.id).toBe(createdCategoryIds[0]);
    expect(res?.channels).toHaveLength(1);
    expect(res?.channels[0].name).toBe(`${prefix}_alpha_stream`);
  });
});
