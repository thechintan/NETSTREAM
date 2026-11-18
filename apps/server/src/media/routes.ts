import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';
import { getWorkerPool, getRoomManager } from './index.js';
import type { DebugMediaResponse } from './types.js';

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/debug/media', async (_req, reply) => {
    if (config.NODE_ENV === 'production') {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Route GET:/api/debug/media not found',
      });
    }

    const workerPool = getWorkerPool();
    const roomManager = getRoomManager();

    const workers = workerPool.getWorkerInfos().map((w) => ({
      pid: w.pid,
      routerCount: roomManager.getRouterCountForWorker(w.pid),
      closed: w.closed,
    }));

    const rooms = roomManager.list().map((r) => ({
      channelId: r.channelId,
      producers: r.producers.size,
      viewers: r.viewers.size,
      transports: r.transports.size,
    }));

    const response: DebugMediaResponse = {
      workers,
      rooms,
    };

    return reply.status(200).send(response);
  });
}
