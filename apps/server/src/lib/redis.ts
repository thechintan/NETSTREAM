import { Redis } from 'ioredis';
import { config } from '../config/index.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  retryStrategy(times) {
    // Retry up to 3 times with 200ms delay, then stop retrying
    if (times > 3) {
      return null;
    }
    return Math.min(times * 100, 500);
  },
});

// Suppress unhandled crash if redis emits error
redis.on('error', () => {
  // Ignored / logged by monitoring
});

export async function pingRedis(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  try {
    if (redis.status !== 'end') {
      redis.disconnect();
    }
  } catch {
    // Ignore close errors during shutdown
  }
}
