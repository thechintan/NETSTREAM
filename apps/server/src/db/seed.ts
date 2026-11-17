import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { categories, channels, closeDb, db, users } from './index.js';

const __filename = fileURLToPath(import.meta.url);

export const SEED_CATEGORIES = [
  { name: 'Gaming', thumbnailUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e' },
  { name: 'Just Chatting', thumbnailUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9' },
  { name: 'Software & Tech', thumbnailUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5' },
  { name: 'Music', thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4' },
  { name: 'Science & Education', thumbnailUrl: 'https://images.unsplash.com/photo-1507668077129-56e32842fceb' },
  { name: 'Creative & Art', thumbnailUrl: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b' },
  { name: 'Esports', thumbnailUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420' },
  { name: 'Special Events', thumbnailUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30' },
];

export const DEMO_USERS = [
  {
    email: 'alice@netstream.live',
    username: 'alice',
    channelName: 'alice',
    channelTitle: "Alice's Gaming Haven",
    categoryName: 'Gaming',
    streamKey: 'live_alice_stream_key_secret_123',
  },
  {
    email: 'bob@netstream.live',
    username: 'bob',
    channelName: 'bob',
    channelTitle: 'Building Computer Networks & Distributed Systems',
    categoryName: 'Software & Tech',
    streamKey: 'live_bob_stream_key_secret_456',
  },
  {
    email: 'carol@netstream.live',
    username: 'carol',
    channelName: 'carol',
    channelTitle: 'Late Night Chat & Q&A',
    categoryName: 'Just Chatting',
    streamKey: 'live_carol_stream_key_secret_789',
  },
];

export async function seed() {
  console.log('Seeding database...');

  // 1. Seed categories
  for (const cat of SEED_CATEGORIES) {
    await db
      .insert(categories)
      .values(cat)
      .onConflictDoNothing({ target: categories.name });
  }

  const existingCategories = await db.select().from(categories);
  const categoryMap = new Map(existingCategories.map((c) => [c.name, c.id]));

  // 2. Hash demo password with argon2id
  const passwordHash = await argon2.hash('demo12345', {
    type: argon2.argon2id,
  });

  // 3. Seed demo users and channels
  for (const demo of DEMO_USERS) {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${demo.username})`);

    let userId = existingUser?.id;

    if (!userId) {
      const [newUser] = await db
        .insert(users)
        .values({
          email: demo.email,
          username: demo.username,
          passwordHash,
        })
        .returning();
      userId = newUser.id;
      console.log(`Created demo user: ${demo.username} (${demo.email})`);
    } else {
      console.log(`Demo user already exists: ${demo.username}`);
    }

    const [existingChannel] = await db
      .select()
      .from(channels)
      .where(eq(channels.ownerId, userId));

    if (!existingChannel) {
      const streamKeyHash = await argon2.hash(demo.streamKey, {
        type: argon2.argon2id,
      });

      await db.insert(channels).values({
        ownerId: userId,
        name: demo.channelName,
        title: demo.channelTitle,
        categoryId: categoryMap.get(demo.categoryName),
        streamKeyHash,
        isLive: false,
      });
      console.log(`Created channel for ${demo.username}: ${demo.channelName}`);
    } else {
      console.log(`Channel already exists for ${demo.username}`);
    }
  }

  console.log('Seeding completed successfully.');
}

if (process.argv[1] === __filename) {
  seed()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('Seed error:', error);
      await closeDb();
      process.exit(1);
    });
}
