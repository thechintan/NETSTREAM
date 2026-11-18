import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config/index.js';
import {
  deleteVodById,
  getVodById,
  listChannelVods,
  resolveSafeVodPath,
} from './vod-service.js';

const CHANNEL_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_HLS_FILE_RE = /^(index\.m3u8|seg_\d{1,10}\.ts)$/;
const uuidSchema = z.string().uuid();

/**
 * Validates HLS URL parameters to strictly allow `<uuid>/index.m3u8` and `<uuid>/seg_XXXXX.ts`
 * with zero path traversal possibility.
 */
export function resolveSafeHlsPath(
  baseDir: string,
  channelId: string,
  fileName: string
): string | null {
  if (!CHANNEL_ID_UUID_RE.test(channelId) || !ALLOWED_HLS_FILE_RE.test(fileName)) {
    return null;
  }

  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, channelId, fileName);

  // Double-check containment inside baseDir
  if (!resolved.startsWith(root + path.sep)) {
    return null;
  }

  return resolved;
}

export function registerHlsRoutes(app: FastifyInstance): void {
  const applyCors = (reply: { header: (k: string, v: string) => unknown }) => {
    reply.header('Access-Control-Allow-Origin', config.WEB_ORIGIN);
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    reply.header('Vary', 'Origin');
  };

  // --- Live HLS serving (/hls/:channelId/:file) ---
  app.options('/hls/:channelId/:file', async (_request, reply) => {
    applyCors(reply);
    return reply.status(204).send();
  });

  app.get<{ Params: { channelId: string; file: string } }>(
    '/hls/:channelId/:file',
    async (request, reply) => {
      applyCors(reply);

      const { channelId, file } = request.params;
      const safePath = resolveSafeHlsPath(config.HLS_DIR, channelId, file);
      if (!safePath) {
        return reply.status(400).send({
          error: 'INVALID_HLS_PATH',
          message: 'Invalid channel ID or HLS asset name',
        });
      }

      try {
        await fsp.access(safePath, fs.constants.R_OK);
      } catch {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'HLS resource not available',
        });
      }

      if (file.endsWith('.m3u8')) {
        reply.header('Content-Type', 'application/vnd.apple.mpegurl');
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        reply.header('Content-Type', 'video/mp2t');
        reply.header('Cache-Control', 'public, max-age=15');
      }

      return reply.send(fs.createReadStream(safePath));
    }
  );

  // --- VOD HLS serving (/vod/:streamId/:file) ---
  app.options('/vod/:streamId/:file', async (_request, reply) => {
    applyCors(reply);
    return reply.status(204).send();
  });

  app.get<{ Params: { streamId: string; file: string } }>(
    '/vod/:streamId/:file',
    async (request, reply) => {
      applyCors(reply);

      const { streamId, file } = request.params;
      const safePath = resolveSafeVodPath(config.VOD_DIR, streamId, file);
      if (!safePath) {
        return reply.status(400).send({
          error: 'INVALID_VOD_PATH',
          message: 'Invalid stream ID or VOD asset name',
        });
      }

      try {
        await fsp.access(safePath, fs.constants.R_OK);
      } catch {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'VOD resource not available',
        });
      }

      if (file.endsWith('.m3u8')) {
        reply.header('Content-Type', 'application/vnd.apple.mpegurl');
        reply.header('Cache-Control', 'public, max-age=60');
      } else {
        reply.header('Content-Type', 'video/mp2t');
        reply.header('Cache-Control', 'public, max-age=3600, immutable');
      }

      return reply.send(fs.createReadStream(safePath));
    }
  );

  // --- VOD REST Endpoints ---

  // GET /api/channels/:id/vods (public, newest first)
  app.get<{ Params: { id: string } }>(
    '/api/channels/:id/vods',
    async (request, reply) => {
      const { id } = request.params;
      if (!uuidSchema.safeParse(id).success) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Invalid channel ID',
        });
      }
      const list = await listChannelVods(id);
      return reply.status(200).send(list);
    }
  );

  // GET /api/vods/:id (public)
  app.get<{ Params: { id: string } }>(
    '/api/vods/:id',
    async (request, reply) => {
      const { id } = request.params;
      if (!uuidSchema.safeParse(id).success) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'VOD not found',
        });
      }
      const vod = await getVodById(id);
      if (!vod) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'VOD not found',
        });
      }
      return reply.status(200).send(vod);
    }
  );

  // DELETE /api/vods/:id (owner only; also deletes files on disk)
  app.delete<{ Params: { id: string } }>(
    '/api/vods/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      if (!uuidSchema.safeParse(id).success) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'VOD not found',
        });
      }

      const result = await deleteVodById(id, request.user!.id);
      if (result.error) {
        return reply.status(result.status).send({
          error: result.error.code,
          message: result.error.message,
        });
      }

      return reply.status(200).send({ ok: true });
    }
  );
}
