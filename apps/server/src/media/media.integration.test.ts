import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { config } from '../config/index.js';
import { closeDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { closeRedis } from '../lib/redis.js';
import {
  shutdownMedia,
  getRoomManager,
  getWorkerPool,
  type Room,
  type CreateWebRtcTransportResult,
} from './index.js';

describe('Task 11: mediasoup Foundation Integration Tests', () => {
  let app: FastifyInstance;
  let room: Room;
  let transportResult: CreateWebRtcTransportResult;

  beforeAll(async () => {
    await runMigrations();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await shutdownMedia();
    await closeDb();
    await closeRedis();
  });

  it('1. Initializes WorkerPool and creates workers with configured options', async () => {
    const workerPool = getWorkerPool();
    const workers = workerPool.getWorkers();

    expect(workers.length).toBeGreaterThanOrEqual(1);

    for (const worker of workers) {
      expect(worker.pid).toBeGreaterThan(0);
      expect(worker.closed).toBe(false);
    }
  });

  it('2. Creates a room on a worker and reuses existing room for same channel', async () => {
    const roomManager = getRoomManager();
    const channelId = 'channel-test-11';

    room = await roomManager.getOrCreate(channelId);
    expect(room).toBeDefined();
    expect(room.channelId).toBe(channelId);
    expect(room.router).toBeDefined();
    expect(room.router.closed).toBe(false);

    // Idempotent getOrCreate
    const sameRoom = await roomManager.getOrCreate(channelId);
    expect(sameRoom).toBe(room);
    expect(roomManager.get(channelId)).toBe(room);
  });

  it('3. Creates WebRtcTransport with configured PUBLIC_IP and RTC port range', async () => {
    const roomManager = getRoomManager();
    transportResult = await roomManager.createWebRtcTransport(room);

    expect(transportResult.transport).toBeDefined();
    expect(transportResult.id).toBeDefined();
    expect(transportResult.params.iceParameters).toBeDefined();
    expect(transportResult.params.dtlsParameters).toBeDefined();

    const candidates = transportResult.iceCandidates;
    expect(candidates.length).toBeGreaterThan(0);

    for (const candidate of candidates) {
      // Must contain the configured PUBLIC_IP
      expect(candidate.ip).toBe(config.PUBLIC_IP);
      // Port must fall within the configured RTC port range
      expect(candidate.port).toBeGreaterThanOrEqual(config.RTC_MIN_PORT);
      expect(candidate.port).toBeLessThanOrEqual(config.RTC_MAX_PORT);
    }

    // Transport tracked in room
    expect(room.transports.has(transportResult.transport.id)).toBe(true);
  });

  it('4. GET /api/debug/media returns workers and active room status in non-production', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/debug/media',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(Array.isArray(body.workers)).toBe(true);
    expect(body.workers.length).toBeGreaterThan(0);
    expect(body.workers[0]).toHaveProperty('pid');
    expect(body.workers[0]).toHaveProperty('routerCount');

    expect(Array.isArray(body.rooms)).toBe(true);
    const foundRoom = body.rooms.find((r: { channelId: string }) => r.channelId === room.channelId);
    expect(foundRoom).toBeDefined();
    expect(foundRoom.transports).toBeGreaterThanOrEqual(1);
    expect(foundRoom.producers).toBe(0);
    expect(foundRoom.viewers).toBe(0);
  });

  it('5. GET /api/debug/media returns 404 when NODE_ENV=production', async () => {
    const originalEnv = config.NODE_ENV;
    try {
      (config as { NODE_ENV: string }).NODE_ENV = 'production';
      const res = await app.inject({
        method: 'GET',
        url: '/api/debug/media',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toHaveProperty('error', 'Not Found');
    } finally {
      (config as { NODE_ENV: string }).NODE_ENV = originalEnv;
    }
  });

  it('6. Closes the room, closing router and associated transports', async () => {
    const roomManager = getRoomManager();
    const channelId = room.channelId;

    roomManager.close(channelId);

    expect(room.router.closed).toBe(true);
    expect(transportResult.transport.closed).toBe(true);
    expect(roomManager.get(channelId)).toBeUndefined();

    // Check debug endpoint reflects room removal
    const res = await app.inject({
      method: 'GET',
      url: '/api/debug/media',
    });
    const body = res.json();
    const foundRoom = body.rooms.find((r: { channelId: string }) => r.channelId === channelId);
    expect(foundRoom).toBeUndefined();
  });

  it('7. Shuts down cleanly with no open handles', async () => {
    const workerPool = getWorkerPool();
    await shutdownMedia();

    for (const worker of workerPool.getWorkers()) {
      expect(worker.closed).toBe(true);
    }
  });
});
