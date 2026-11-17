import { FastifyInstance } from 'fastify';
import { chatHistoryQuerySchema, updateChannelSchema } from '@netstream/shared';
import { optionalAuth, requireAuth } from '../auth/middleware.js';
import { getPersistedChatHistory } from '../chat/service.js';
import {
  followChannel,
  getCategories,
  getChannelByName,
  getFollowedChannels,
  getLiveChannels,
  rotateStreamKey,
  unfollowChannel,
  updateMyChannel,
} from './service.js';

export function registerChannelRoutes(app: FastifyInstance) {
  // GET /api/categories
  app.get('/api/categories', async (_request, reply) => {
    const list = await getCategories();
    return reply.status(200).send(list);
  });

  // GET /api/channels/:name (public, optionalAuth for isFollowing)
  app.get<{ Params: { name: string } }>(
    '/api/channels/:name',
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      const { name } = request.params;
      const channel = await getChannelByName(name, request.user?.id);

      if (!channel) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Channel not found',
        });
      }

      return reply.status(200).send(channel);
    }
  );

  // PATCH /api/channels/me (owner updates title and categoryId)
  app.patch(
    '/api/channels/me',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parseResult = updateChannelSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: parseResult.error.errors[0]?.message || 'Invalid input',
        });
      }

      const result = await updateMyChannel(request.user!.id, parseResult.data);
      if (result.error) {
        return reply.status(result.status).send({
          error: result.error.code,
          message: result.error.message,
        });
      }

      return reply.status(200).send(result.data);
    }
  );

  // POST /api/channels/me/stream-key/rotate
  app.post(
    '/api/channels/me/stream-key/rotate',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const result = await rotateStreamKey(request.user!.id);
      if (result.error) {
        return reply.status(result.status).send({
          error: result.error.code,
          message: result.error.message,
        });
      }

      return reply.status(200).send(result.data);
    }
  );

  // POST /api/channels/:id/follow
  app.post<{ Params: { id: string } }>(
    '/api/channels/:id/follow',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const result = await followChannel(request.user!.id, id);

      if (result.error) {
        return reply.status(result.status).send({
          error: result.error.code,
          message: result.error.message,
        });
      }

      return reply.status(200).send(result.data);
    }
  );

  // DELETE /api/channels/:id/follow
  app.delete<{ Params: { id: string } }>(
    '/api/channels/:id/follow',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const result = await unfollowChannel(request.user!.id, id);

      if (result.error) {
        return reply.status(result.status).send({
          error: result.error.code,
          message: result.error.message,
        });
      }

      return reply.status(200).send(result.data);
    }
  );

  // GET /api/me/following
  app.get(
    '/api/me/following',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const list = await getFollowedChannels(request.user!.id);
      return reply.status(200).send(list);
    }
  );

  // GET /api/live
  app.get<{ Querystring: { category?: string; q?: string } }>(
    '/api/live',
    async (request, reply) => {
      const { category, q } = request.query;
      const list = await getLiveChannels({ category, q });
      return reply.status(200).send(list);
    }
  );

  // GET /api/channels/:id/chat/history?before=<mid>&limit=50
  app.get<{
    Params: { id: string };
    Querystring: { before?: string; limit?: string | number };
  }>('/api/channels/:id/chat/history', async (request, reply) => {
    const { id } = request.params;
    const queryResult = chatHistoryQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid query parameters',
      });
    }

    const { before, limit } = queryResult.data;
    const messages = await getPersistedChatHistory(id, before, limit);
    return reply.status(200).send({ messages });
  });
}
