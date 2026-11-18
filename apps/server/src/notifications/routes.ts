import type { FastifyInstance } from 'fastify';
import { markNotificationsReadSchema } from '@netstream/shared';
import { requireAuth } from '../auth/middleware.js';
import { getUserNotifications, markNotificationsRead } from './service.js';

export function registerNotificationRoutes(app: FastifyInstance): void {
  // GET /api/notifications?unread=true
  app.get<{ Querystring: { unread?: string } }>(
    '/api/notifications',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const unreadOnly = request.query.unread === 'true' || request.query.unread === '1';
      const result = await getUserNotifications(request.user!.id, { unreadOnly });
      return reply.status(200).send(result);
    }
  );

  // POST /api/notifications/read { ids?: string[], all?: boolean }
  app.post(
    '/api/notifications/read',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parseResult = markNotificationsReadSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: parseResult.error.errors[0]?.message || 'Invalid input',
        });
      }

      const result = await markNotificationsRead(request.user!.id, parseResult.data);
      return reply.status(200).send(result);
    }
  );
}
