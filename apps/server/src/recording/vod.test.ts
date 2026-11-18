import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildHlsFfmpegArgs } from './ffmpeg-manager.js';
import { registerHlsRoutes } from './routes.js';
import {
  MIN_VOD_DURATION_SECONDS,
  cleanupExpiredVods,
  deleteVodById,
  finalizeVodRecording,
  resolveSafeVodDir,
  resolveSafeVodPath,
} from './vod-service.js';

const STREAM_ID_1 = '11111111-2222-3333-4444-555555555555';
const STREAM_ID_2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CHANNEL_ID = '99999999-8888-7777-6666-555555555555';

describe('VOD recording, REST security, and retention (Task 23)', () => {
  it('enforces owner-only delete and deletes both DB row and files on disk for the owner', async () => {
    const deleteVodRow = vi.fn<(id: string) => Promise<void>>(async () => {});
    const removeDir = vi.fn<(dir: string) => Promise<void>>(async () => {});
    const findVodOwner = vi.fn(async () => ({
      id: 'vod-1',
      streamId: STREAM_ID_1,
      ownerId: 'owner-user-1',
    }));

    // Non-owner attempt -> 403 FORBIDDEN, no deletion
    const forbidden = await deleteVodById('vod-1', 'other-user-2', {
      vodBaseDir: './media/vod',
      deps: { findVodOwner, deleteVodRow, removeDir },
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.error?.code).toBe('FORBIDDEN');
    expect(deleteVodRow).not.toHaveBeenCalled();
    expect(removeDir).not.toHaveBeenCalled();

    // Owner attempt -> 200 OK, deletes row and disk files
    const allowed = await deleteVodById('vod-1', 'owner-user-1', {
      vodBaseDir: './media/vod',
      deps: { findVodOwner, deleteVodRow, removeDir },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.ok).toBe(true);
    expect(deleteVodRow).toHaveBeenCalledWith('vod-1');
    expect(removeDir).toHaveBeenCalledTimes(1);
    expect(removeDir.mock.calls[0][0]).toContain(STREAM_ID_1);
  });

  it('discards recordings shorter than 10 seconds and persists recordings >= 10 seconds', async () => {
    expect(MIN_VOD_DURATION_SECONDS).toBe(10);

    const removeDir = vi.fn(async () => {});
    const insertVodRow = vi.fn(async () => ({ id: 'vod-saved-1' }));

    // 7-second clip -> discarded & deleted, never inserted
    const shortRes = await finalizeVodRecording({
      streamId: STREAM_ID_1,
      channelId: CHANNEL_ID,
      vodBaseDir: './media/vod',
      deps: {
        probeDuration: vi.fn(async () => 7.4),
        removeDir,
        insertVodRow,
      },
    });
    expect(shortRes.saved).toBe(false);
    expect(shortRes.discarded).toBe(true);
    expect(shortRes.reason).toBe('TOO_SHORT');
    expect(removeDir).toHaveBeenCalledTimes(1);
    expect(insertVodRow).not.toHaveBeenCalled();

    // 32-second recording -> saved with relative path and durationS
    removeDir.mockClear();
    const validRes = await finalizeVodRecording({
      streamId: STREAM_ID_2,
      channelId: CHANNEL_ID,
      vodBaseDir: './media/vod',
      deps: {
        probeDuration: vi.fn(async () => 32.8),
        removeDir,
        insertVodRow,
      },
    });
    expect(validRes.saved).toBe(true);
    expect(validRes.discarded).toBe(false);
    expect(validRes.vodId).toBe('vod-saved-1');
    expect(validRes.durationS).toBe(32);
    expect(removeDir).not.toHaveBeenCalled();
    expect(insertVodRow).toHaveBeenCalledWith({
      streamId: STREAM_ID_2,
      channelId: CHANNEL_ID,
      path: `${STREAM_ID_2}/index.m3u8`,
      durationS: 32,
    });
  });

  it('blocks path traversal attempts (../) in VOD stream IDs and filenames', async () => {
    expect(resolveSafeVodPath('./media/vod', STREAM_ID_1, 'index.m3u8')).not.toBeNull();
    expect(resolveSafeVodPath('./media/vod', STREAM_ID_1, 'seg_00012.ts')).not.toBeNull();

    // Traversal & invalid inputs rejected
    expect(resolveSafeVodPath('./media/vod', '../etc', 'passwd')).toBeNull();
    expect(resolveSafeVodPath('./media/vod', STREAM_ID_1, '../index.m3u8')).toBeNull();
    expect(resolveSafeVodPath('./media/vod', `${STREAM_ID_1}/..`, 'index.m3u8')).toBeNull();
    expect(resolveSafeVodPath('./media/vod', STREAM_ID_1, 'secret.env')).toBeNull();
    expect(resolveSafeVodDir('./media/vod', '../../windows')).toBeNull();

    const app = Fastify();
    registerHlsRoutes(app);
    await app.ready();

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/vod/..%2Fetc/index.m3u8',
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('retention job deletes VOD rows and files older than configured retention days (default 7d)', async () => {
    const now = new Date('2026-11-18T12:00:00.000Z');
    const capturedCutoffs: Date[] = [];
    const deleteVodRow = vi.fn(async () => {});
    const removeDir = vi.fn(async () => {});

    const findExpiredVods = vi.fn(async (cutoff: Date) => {
      capturedCutoffs.push(cutoff);
      return [
        { id: 'vod-old-1', streamId: STREAM_ID_1 },
        { id: 'vod-old-2', streamId: STREAM_ID_2 },
      ];
    });

    const result = await cleanupExpiredVods({
      retentionDays: 7,
      now,
      vodBaseDir: './media/vod',
      deps: { findExpiredVods, deleteVodRow, removeDir },
    });

    expect(capturedCutoffs[0].toISOString()).toBe('2026-11-11T12:00:00.000Z');
    expect(result.removedCount).toBe(2);
    expect(result.removedIds).toEqual(['vod-old-1', 'vod-old-2']);
    expect(deleteVodRow).toHaveBeenCalledTimes(2);
    expect(removeDir).toHaveBeenCalledTimes(2);
  });

  it('builds dual FFmpeg outputs with event playlist and hls_list_size 0 when VOD recording is enabled', () => {
    const args = buildHlsFfmpegArgs({
      sdpPath: '/tmp/hls/stream.sdp',
      outputDir: '/tmp/hls/chan1',
      vodOutputDir: `/tmp/vod/${STREAM_ID_1}`,
      hasVideo: true,
      hasAudio: true,
    });

    expect(args).toContain('-hls_playlist_type');
    expect(args[args.indexOf('-hls_playlist_type') + 1]).toBe('event');
    expect(args).toContain('0');
    expect(args.some((a) => a.includes(STREAM_ID_1) && a.endsWith('index.m3u8'))).toBe(true);
  });
});
