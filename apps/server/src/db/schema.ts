import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// 1. Users
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull().unique(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_username_lower_idx').on(sql`lower(${table.username})`),
  ]
);

// 2. Categories
export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  thumbnailUrl: text('thumbnail_url'),
});

// 3. Channels
export const channels = pgTable(
  'channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title').notNull().default('My Live Stream'),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    streamKeyHash: text('stream_key_hash').notNull(),
    isLive: boolean('is_live').notNull().default(false),
    slowSeconds: integer('slow_seconds').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('channels_name_lower_idx').on(sql`lower(${table.name})`),
    index('channels_is_live_category_id_idx').on(table.isLive, table.categoryId),
  ]
);

// 4. Follows
export const follows = pgTable(
  'follows',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.channelId] }),
    index('follows_channel_id_idx').on(table.channelId),
  ]
);

// 5. Channel Moderators
export const channelMods = pgTable(
  'channel_mods',
  {
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
  ]
);

// 6. Streams
export const streams = pgTable('streams', {
  id: uuid('id').defaultRandom().primaryKey(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  peakViewers: integer('peak_viewers').notNull().default(0),
});

// 7. Chat Messages
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(), // ULID
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    streamId: uuid('stream_id').references(() => streams.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('chat_messages_channel_id_id_idx').on(table.channelId, table.id),
  ]
);

// 8. Bans
export const bans = pgTable(
  'bans',
  {
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bannedBy: uuid('banned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    index('bans_channel_id_user_id_idx').on(table.channelId, table.userId),
  ]
);

// 9. Moderator Actions
export const modActions = pgTable('mod_actions', {
  id: uuid('id').defaultRandom().primaryKey(),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetUserId: uuid('target_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  action: text('action').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 10. VODs
export const vods = pgTable('vods', {
  id: uuid('id').defaultRandom().primaryKey(),
  streamId: uuid('stream_id')
    .notNull()
    .references(() => streams.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  durationS: integer('duration_s').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 11. Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('notifications_user_id_read_at_idx').on(table.userId, table.readAt),
  ]
);

// 12. Refresh Tokens
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  replacedBy: uuid('replaced_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
