import { and, desc, eq, lt } from 'drizzle-orm';
import { ulid } from 'ulid';
import {
  ChatMessageDto,
  getUserColor,
} from '@netstream/shared';
import { db } from '../db/index.js';
import { chatMessages, users } from '../db/schema.js';
import { redis } from '../lib/redis.js';
import { ConnUser } from '../realtime/conn.js';

export function stripControlCharacters(text: string): string {
  // Strip C0 and C1 control codes (0x00-0x1F, 0x7F-0x9F)
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
}

export function formatChatMessage(
  channelId: string,
  user: ConnUser,
  rawText: string
): ChatMessageDto {
  const sanitizedText = stripControlCharacters(rawText).trim();

  return {
    mid: ulid(),
    channelId,
    user: {
      id: user.id,
      name: user.username,
      color: getUserColor(user.username),
      badges: [],
    },
    text: sanitizedText,
    ts: Date.now(),
  };
}

export async function publishChatMessage(message: ChatMessageDto): Promise<string> {
  const channelKey = `chat:${message.channelId}`;
  const recentKey = `chat:recent:${message.channelId}`;

  // Pre-serialize once as server push envelope { t: 'chat.message', d: message }
  const pushEnvelope = JSON.stringify({
    t: 'chat.message',
    d: message,
  });

  // Store in Redis recent messages list (max 100 items)
  await redis.lpush(recentKey, JSON.stringify(message));
  await redis.ltrim(recentKey, 0, 99);

  // Publish to Redis channel for cluster / gateway delivery
  await redis.publish(channelKey, pushEnvelope);

  return pushEnvelope;
}

export async function getRecentMessages(
  channelId: string,
  limit = 50,
  lastMid?: string
): Promise<ChatMessageDto[]> {
  const recentKey = `chat:recent:${channelId}`;
  const rawList = await redis.lrange(recentKey, 0, 99);

  const messages: ChatMessageDto[] = [];
  for (const raw of rawList) {
    try {
      messages.push(JSON.parse(raw) as ChatMessageDto);
    } catch {
      // Ignore unparseable entries
    }
  }

  // Reverse so the array is in chronological order (oldest -> newest)
  messages.reverse();

  // If lastMid is provided, return only messages newer than lastMid
  if (lastMid) {
    return messages.filter((m) => m.mid > lastMid);
  }

  return messages.slice(-limit);
}

export async function getPersistedChatHistory(
  channelId: string,
  before?: string,
  limit = 50
): Promise<ChatMessageDto[]> {
  const conditions = [eq(chatMessages.channelId, channelId)];
  if (before) {
    conditions.push(lt(chatMessages.id, before));
  }

  const rows = await db
    .select({
      id: chatMessages.id,
      channelId: chatMessages.channelId,
      text: chatMessages.text,
      createdAt: chatMessages.createdAt,
      userId: users.id,
      username: users.username,
    })
    .from(chatMessages)
    .innerJoin(users, eq(chatMessages.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(chatMessages.id))
    .limit(limit);

  // Return mapped messages sorted chronologically (oldest -> newest)
  return rows.reverse().map((r) => ({
    mid: r.id,
    channelId: r.channelId,
    user: {
      id: r.userId,
      name: r.username,
      color: getUserColor(r.username),
      badges: [],
    },
    text: r.text,
    ts: r.createdAt.getTime(),
  }));
}
