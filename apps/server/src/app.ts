import fastifyCookie from '@fastify/cookie';
import Fastify, { FastifyInstance } from 'fastify';
import { VERSION } from '@netstream/shared';
import { registerAuthRoutes } from './auth/routes.js';
import { registerChannelRoutes } from './channels/routes.js';
import { registerChatHandlers } from './chat/index.js';
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
  app.server.on('upgrade', (req, socket, head) => {
    void gateway.handleUpgrade(req, socket, head);
  });

  app.addHook('onClose', async () => {
    await gateway.close();
  });

  // Register cookie support
  void app.register(fastifyCookie, {
    secret: config.COOKIE_SECRET,
  });

  // Register auth and session routes
  registerAuthRoutes(app);

  // Register channel, category, follow routes
  registerChannelRoutes(app);

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
