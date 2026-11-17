import { redis } from '../lib/redis.js';

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
}

export async function checkRateLimit(
  key: string,
  limit = 10,
  windowSeconds = 900
): Promise<RateLimitResult> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return {
    allowed: count <= limit,
    current: count,
    limit,
    remaining: Math.max(0, limit - count),
  };
}
