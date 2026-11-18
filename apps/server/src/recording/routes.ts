import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/index.js';

const CHANNEL_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_HLS_FILE_RE = /^(index\.m3u8|seg_\d{1,10}\.ts)$/;

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
}
