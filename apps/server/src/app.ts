import fastifyCookie from '@fastify/cookie';
import Fastify, { FastifyInstance } from 'fastify';
import { VERSION } from '@netstream/shared';
import { registerAuthRoutes } from './auth/routes.js';
import { registerChannelRoutes } from './channels/routes.js';
import { getChatPersistenceWorker, registerChatHandlers } from './chat/index.js';
import { registerModerationHandlers, registerModerationRoutes } from './moderation/index.js';
import { initPresenceWorker, registerPresenceHandlers } from './presence/index.js';
import { initMedia, registerMediaHandlers, shutdownMedia } from './media/index.js';
import { registerMediaRoutes } from './media/routes.js';
import { config } from './config/index.js';
import { pingDb } from './db/index.js';
import { pingRedis } from './lib/redis.js';
import { GatewayOptions, WebSocketGateway } from './realtime/index.js';

export function buildApp(gatewayOptions?: GatewayOptions): FastifyInstance & { gateway: WebSocketGateway } {
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

  // Attach WebSocket gateway
  const gateway = new WebSocketGateway(gatewayOptions);
  registerChatHandlers(gateway);
  registerModerationHandlers(gateway);
  registerPresenceHandlers(gateway);
  registerMediaHandlers(gateway);
  const presenceWorker = initPresenceWorker(gateway);
  app.server.on('upgrade', (req, socket, head) => {
    void gateway.handleUpgrade(req, socket, head);
  });

  app.addHook('onReady', async () => {
    await initMedia();
  });

  app.addHook('onClose', async () => {
    await gateway.close();
    await getChatPersistenceWorker().close();
    await presenceWorker.close();
    await shutdownMedia();
  });

  // Register cookie support
  void app.register(fastifyCookie, {
    secret: config.COOKIE_SECRET,
  });

  // Support empty JSON bodies without throwing FST_ERR_CTP_EMPTY_JSON_BODY
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim().length === 0)) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Register auth and session routes
  registerAuthRoutes(app);

  // Register channel, category, follow routes
  registerChannelRoutes(app);

  // Register moderation routes
  registerModerationRoutes(app);

  // Register media routes
  registerMediaRoutes(app);

  // Health check endpoint
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

  return Object.assign(app, { gateway });
}
