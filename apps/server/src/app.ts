import Fastify, { FastifyInstance } from 'fastify';
import { VERSION } from '@netstream/shared';
import { config } from './config/index.js';
import { pingDb } from './db/index.js';
import { pingRedis } from './lib/redis.js';

export function buildApp(): FastifyInstance {
  const isDev = config.NODE_ENV === 'development';

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  });

  app.get('/api/health', async (_request, reply) => {
    const [dbHealthy, redisHealthy] = await Promise.all([
      pingDb(),
      pingRedis(),
    ]);

    const isOk = dbHealthy && redisHealthy;

    return reply.status(isOk ? 200 : 503).send({
      ok: isOk,
      db: dbHealthy,
      redis: redisHealthy,
      version: VERSION,
    });
  });

  return app;
}
