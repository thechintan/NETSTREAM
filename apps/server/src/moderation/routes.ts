import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addModSchema } from '@netstream/shared';
import { requireAuth } from '../auth/middleware.js';
import {
  addChannelMod,
  getChannelMods,
  removeChannelMod,
} from './service.js';

const channelIdParamSchema = z.object({
  id: z.string().uuid('Invalid channel ID'),
});

export function registerModerationRoutes(app: FastifyInstance): void {
  // GET /api/channels/:id/mods - List moderators for a channel
  app.get('/api/channels/:id/mods', async (request, reply) => {
    const paramsParsed = channelIdParamSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: paramsParsed.error.issues[0]?.message || 'Invalid channel ID',
      });
    }

    const mods = await getChannelMods(paramsParsed.data.id);
    return reply.status(200).send({ mods });
  });

  // POST /api/channels/:id/mods - Add a moderator (owner only)
  app.post(
    '/api/channels/:id/mods',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const paramsParsed = channelIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: paramsParsed.error.issues[0]?.message || 'Invalid channel ID',
        });
      }

      const bodyParsed = addModSchema.safeParse(request.body || request.query);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: bodyParsed.error.issues[0]?.message || 'Invalid request body or query parameter',
        });
      }

      const result = await addChannelMod(
        paramsParsed.data.id,
        request.user!.id,
        bodyParsed.data.username
      );

      if (result.error) {
        return reply.status(result.status).send(result.error);
      }

      return reply.status(result.status).send(result.data);
    }
  );

  // DELETE /api/channels/:id/mods - Remove a moderator (owner only)
  app.delete(
    '/api/channels/:id/mods',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const paramsParsed = channelIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: paramsParsed.error.issues[0]?.message || 'Invalid channel ID',
        });
      }

      const bodyParsed = addModSchema.safeParse(request.body || request.query);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: bodyParsed.error.issues[0]?.message || 'Invalid request body or query parameter',
        });
      }

      const result = await removeChannelMod(
        paramsParsed.data.id,
        request.user!.id,
        bodyParsed.data.username
      );

      if (result.error) {
        return reply.status(result.status).send(result.error);
      }

      return reply.status(result.status).send({ ok: true });
    }
  );
}
