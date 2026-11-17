import { ulid } from 'ulid';
import {
  ChatMessageDto,
  getUserColor,
} from '@netstream/shared';
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
  limit = 50
): Promise<ChatMessageDto[]> {
  const recentKey = `chat:recent:${channelId}`;
  const rawList = await redis.lrange(recentKey, 0, limit - 1);

  const messages: ChatMessageDto[] = [];
  for (const raw of rawList) {
    try {
      messages.push(JSON.parse(raw) as ChatMessageDto);
    } catch {
      // Ignore unparseable entries
    }
  }

  // Reverse so the array is in chronological order (oldest -> newest)
  return messages.reverse();
}
