import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { desc, eq, lt } from 'drizzle-orm';
import type { VodDto } from '@netstream/shared';
import { config } from '../config/index.js';
import { channels, db, streams, users, vods } from '../db/index.js';

export const MIN_VOD_DURATION_SECONDS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_VOD_FILE_RE = /^(index\.m3u8|seg_\d{1,10}\.ts)$/;

/**
 * Safely resolves `<vodDir>/<streamId>/<fileName>` with strict UUID + filename allowlist
 * to prevent any path traversal.
 */
export function resolveSafeVodPath(
  baseDir: string,
  streamId: string,
  fileName: string
): string | null {
  if (!UUID_RE.test(streamId) || !ALLOWED_VOD_FILE_RE.test(fileName)) {
    return null;
  }
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, streamId, fileName);
  if (!resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

export function resolveSafeVodDir(baseDir: string, streamId: string): string | null {
  if (!UUID_RE.test(streamId)) {
    return null;
  }
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, streamId);
  if (!resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

/**
 * Measures duration in seconds using ffprobe, with a fallback that sums #EXTINF tags
 * from the HLS playlist if ffprobe returns N/A.
 */
export async function probeDurationSeconds(
  playlistPath: string,
  ffprobeBinary = 'ffprobe'
): Promise<number | null> {
  try {
    const res = spawnSync(
      ffprobeBinary,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        playlistPath,
      ],
      { encoding: 'utf8', timeout: 10_000 }
    );
    if (!res.error && res.status === 0) {
      const parsed = Number.parseFloat((res.stdout || '').trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  } catch {
    // Fallback to parsing EXTINF below
  }

  try {
    const content = await fs.readFile(playlistPath, 'utf8');
    let total = 0;
    const matches = content.matchAll(/#EXTINF:([0-9]+(?:\.[0-9]+)?)/g);
    for (const m of matches) {
      total += Number.parseFloat(m[1]);
    }
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

export interface FinalizeVodDeps {
  probeDuration?: (playlistPath: string) => Promise<number | null>;
  removeDir?: (dirPath: string) => Promise<void>;
  insertVodRow?: (row: {
    streamId: string;
    channelId: string;
    path: string;
    durationS: number;
  }) => Promise<{ id: string }>;
}

export interface FinalizeVodResult {
  saved: boolean;
  discarded: boolean;
  vodId?: string;
  durationS: number;
  reason?: string;
}

/**
 * Finalizes a completed VOD recording after FFmpeg exits cleanly:
 * - Measures duration via ffprobe
 * - Discards recordings shorter than 10 seconds (deletes files, no DB row)
 * - Persists a row in `vods` with path relative to VOD_DIR
 */
export async function finalizeVodRecording(params: {
  streamId: string;
  channelId: string;
  vodBaseDir?: string;
  deps?: FinalizeVodDeps;
}): Promise<FinalizeVodResult> {
  const baseDir = params.vodBaseDir ?? config.VOD_DIR;
  const vodStreamDir = resolveSafeVodDir(baseDir, params.streamId);
  const playlistPath = resolveSafeVodPath(baseDir, params.streamId, 'index.m3u8');

  if (!vodStreamDir || !playlistPath) {
    return { saved: false, discarded: true, durationS: 0, reason: 'INVALID_STREAM_ID' };
  }

  const probe = params.deps?.probeDuration ?? probeDurationSeconds;
  const removeDir =
    params.deps?.removeDir ?? ((dir) => fs.rm(dir, { recursive: true, force: true }));
  const insertVodRow =
    params.deps?.insertVodRow ??
    (async (row) => {
      const [inserted] = await db
        .insert(vods)
        .values(row)
        .returning({ id: vods.id });
      return inserted;
    });

  const rawDuration = await probe(playlistPath);
  const durationS = rawDuration !== null && Number.isFinite(rawDuration) ? Math.floor(rawDuration) : 0;

  if (durationS < MIN_VOD_DURATION_SECONDS) {
    await removeDir(vodStreamDir).catch(() => {});
    return {
      saved: false,
      discarded: true,
      durationS,
      reason: 'TOO_SHORT',
    };
  }

  const relativePath = `${params.streamId}/index.m3u8`;
  const inserted = await insertVodRow({
    streamId: params.streamId,
    channelId: params.channelId,
    path: relativePath,
    durationS,
  });

  return {
    saved: true,
    discarded: false,
    vodId: inserted.id,
    durationS,
  };
}

export async function listChannelVods(channelId: string): Promise<VodDto[]> {
  const rows = await db
    .select({
      id: vods.id,
      streamId: vods.streamId,
      channelId: vods.channelId,
      path: vods.path,
      durationS: vods.durationS,
      createdAt: vods.createdAt,
      title: streams.title,
      channelName: channels.name,
      ownerId: channels.ownerId,
      ownerUsername: users.username,
    })
    .from(vods)
    .innerJoin(streams, eq(vods.streamId, streams.id))
    .innerJoin(channels, eq(vods.channelId, channels.id))
    .innerJoin(users, eq(channels.ownerId, users.id))
    .where(eq(vods.channelId, channelId))
    .orderBy(desc(vods.createdAt));

  return rows.map((r) => ({
    id: r.id,
    streamId: r.streamId,
    channelId: r.channelId,
    channelName: r.channelName,
    ownerUsername: r.ownerUsername,
    ownerId: r.ownerId,
    title: r.title,
    path: r.path,
    playlistUrl: `/vod/${r.streamId}/index.m3u8`,
    durationS: r.durationS,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getVodById(vodId: string): Promise<VodDto | null> {
  const [r] = await db
    .select({
      id: vods.id,
      streamId: vods.streamId,
      channelId: vods.channelId,
      path: vods.path,
      durationS: vods.durationS,
      createdAt: vods.createdAt,
      title: streams.title,
      channelName: channels.name,
      ownerId: channels.ownerId,
      ownerUsername: users.username,
    })
    .from(vods)
    .innerJoin(streams, eq(vods.streamId, streams.id))
    .innerJoin(channels, eq(vods.channelId, channels.id))
    .innerJoin(users, eq(channels.ownerId, users.id))
    .where(eq(vods.id, vodId));

  if (!r) return null;

  return {
    id: r.id,
    streamId: r.streamId,
    channelId: r.channelId,
    channelName: r.channelName,
    ownerUsername: r.ownerUsername,
    ownerId: r.ownerId,
    title: r.title,
    path: r.path,
    playlistUrl: `/vod/${r.streamId}/index.m3u8`,
    durationS: r.durationS,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface DeleteVodDeps {
  findVodOwner?: (vodId: string) => Promise<{ id: string; streamId: string; ownerId: string } | null>;
  deleteVodRow?: (vodId: string) => Promise<void>;
  removeDir?: (dirPath: string) => Promise<void>;
}

export async function deleteVodById(
  vodId: string,
  requesterUserId: string,
  options?: { vodBaseDir?: string; deps?: DeleteVodDeps }
): Promise<{ status: number; ok?: boolean; error?: { code: string; message: string } }> {
  const baseDir = options?.vodBaseDir ?? config.VOD_DIR;
  const findVodOwner =
    options?.deps?.findVodOwner ??
    (async (id: string) => {
      const [row] = await db
        .select({
          id: vods.id,
          streamId: vods.streamId,
          ownerId: channels.ownerId,
        })
        .from(vods)
        .innerJoin(channels, eq(vods.channelId, channels.id))
        .where(eq(vods.id, id));
      return row ?? null;
    });

  const deleteVodRow =
    options?.deps?.deleteVodRow ??
    (async (id: string) => {
      await db.delete(vods).where(eq(vods.id, id));
    });

  const removeDir =
    options?.deps?.removeDir ?? ((dir) => fs.rm(dir, { recursive: true, force: true }));

  const record = await findVodOwner(vodId);
  if (!record) {
    return {
      status: 404,
      error: { code: 'NOT_FOUND', message: 'VOD not found' },
    };
  }

  if (record.ownerId !== requesterUserId) {
    return {
      status: 403,
      error: { code: 'FORBIDDEN', message: 'Only the channel owner can delete this VOD' },
    };
  }

  await deleteVodRow(record.id);

  const dir = resolveSafeVodDir(baseDir, record.streamId);
  if (dir) {
    await removeDir(dir).catch(() => {});
  }

  return { status: 200, ok: true };
}

export interface RetentionCleanupDeps {
  findExpiredVods?: (cutoff: Date) => Promise<Array<{ id: string; streamId: string }>>;
  deleteVodRow?: (vodId: string) => Promise<void>;
  removeDir?: (dirPath: string) => Promise<void>;
}

/**
 * Removes VOD rows and files older than retentionDays (default 7 days).
 */
export async function cleanupExpiredVods(options?: {
  retentionDays?: number;
  now?: Date;
  vodBaseDir?: string;
  deps?: RetentionCleanupDeps;
}): Promise<{ removedCount: number; removedIds: string[] }> {
  const retentionDays = options?.retentionDays ?? config.VOD_RETENTION_DAYS;
  const now = options?.now ?? new Date();
  const baseDir = options?.vodBaseDir ?? config.VOD_DIR;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const findExpiredVods =
    options?.deps?.findExpiredVods ??
    (async (c: Date) =>
      db
        .select({ id: vods.id, streamId: vods.streamId })
        .from(vods)
        .where(lt(vods.createdAt, c)));

  const deleteVodRow =
    options?.deps?.deleteVodRow ??
    (async (id: string) => {
      await db.delete(vods).where(eq(vods.id, id));
    });

  const removeDir =
    options?.deps?.removeDir ?? ((dir) => fs.rm(dir, { recursive: true, force: true }));

  const expired = await findExpiredVods(cutoff);
  const removedIds: string[] = [];

  for (const item of expired) {
    const dir = resolveSafeVodDir(baseDir, item.streamId);
    if (dir) {
      await removeDir(dir).catch(() => {});
    }
    await deleteVodRow(item.id);
    removedIds.push(item.id);
  }

  return {
    removedCount: removedIds.length,
    removedIds,
  };
}

export function startVodRetentionScheduler(retentionDays = config.VOD_RETENTION_DAYS): {
  stop: () => void;
} {
  // Run once on startup (non-blocking)
  void cleanupExpiredVods({ retentionDays }).catch(() => {});

  // Run daily (every 24h)
  const DAILY_MS = 24 * 60 * 60 * 1000;
  const timer = setInterval(() => {
    void cleanupExpiredVods({ retentionDays }).catch(() => {});
  }, DAILY_MS);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
