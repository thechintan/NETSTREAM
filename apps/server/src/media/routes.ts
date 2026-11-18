import type { FastifyInstance } from 'fastify';
import { optionalAuth } from '../auth/middleware.js';
import { peekWsTicket } from '../auth/ticket.js';
import { config } from '../config/index.js';
import type { WebSocketGateway } from '../realtime/gateway.js';
import { buildIceConfig } from './ice-config.js';
import { getWorkerPool, getRoomManager } from './index.js';
import type { DebugMediaResponse } from './types.js';

let lastCpuUsage = process.cpuUsage();
let lastCpuHrNs = process.hrtime.bigint();

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/debug/stats (dev-only CPU, memory, and connection telemetry for load experiments)
  app.get('/api/debug/stats', async (_req, reply) => {
    if (config.NODE_ENV === 'production') {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Route GET:/api/debug/stats not found',
      });
    }

    const nowHrNs = process.hrtime.bigint();
    const elapsedUs = Number(nowHrNs - lastCpuHrNs) / 1000;
    const cpuDelta = process.cpuUsage(lastCpuUsage);
    lastCpuUsage = process.cpuUsage();
    lastCpuHrNs = nowHrNs;

    const totalCpuUs = cpuDelta.user + cpuDelta.system;
    const cpuPercent = elapsedUs > 0 ? Math.round((totalCpuUs / elapsedUs) * 1000) / 10 : 0;
    const mem = process.memoryUsage();
    const gateway = (app as FastifyInstance & { gateway?: WebSocketGateway }).gateway;
    let activeRooms = 0;
    try {
      activeRooms = getRoomManager().list().length;
    } catch {
      activeRooms = 0;
    }

    return reply.status(200).send({
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime() * 10) / 10,
      cpuPercent,
      cpuUsageUs: { user: cpuDelta.user, system: cpuDelta.system },
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
        rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
      },
      activeWsConnections: gateway ? gateway.conns.size : 0,
      activeRooms,
      mediaForceTcp: config.MEDIA_FORCE_TCP,
    });
  });

  // GET /api/ice-config (authenticated users or guest WS ticket holders)
  app.get<{ Querystring: { ticket?: string } }>(
    '/api/ice-config',
    { preHandler: [optionalAuth] },
    async (request, reply) => {
      let subjectId: string | null = request.user?.id ?? null;

      if (!subjectId) {
        const headerTicket = request.headers['x-ws-ticket'];
        const ticket =
          request.query.ticket ??
          (typeof headerTicket === 'string' ? headerTicket : undefined);

        if (ticket) {
          const ticketData = await peekWsTicket(ticket);
          if (ticketData) {
            subjectId = ticketData.guest ? `guest_${ticketData.id}` : ticketData.userId;
          }
        }
      }

      if (!subjectId) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication or valid guest ticket required for ICE configuration',
        });
      }

      const iceConfig = buildIceConfig(subjectId);
      return reply.status(200).send(iceConfig);
    }
  );

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
