import { RoomManager } from './room-manager.js';
import { WorkerPool } from './worker-pool.js';

export * from './config.js';
export * from './types.js';
export * from './worker-pool.js';
export * from './room-manager.js';
export * from './transport.js';
export * from './handlers.js';
export * from './lifecycle.js';
export { recoverCrashedStreamsOnBoot, hasStreamLifecycle } from './lifecycle.js';

let workerPool: WorkerPool | null = null;
let roomManager: RoomManager | null = null;

export async function initMedia(options?: {
  numWorkers?: number;
  rtcMinPort?: number;
  rtcMaxPort?: number;
}): Promise<{ workerPool: WorkerPool; roomManager: RoomManager }> {
  if (!workerPool) {
    workerPool = new WorkerPool(options);
    await workerPool.init();
  }
  if (!roomManager) {
    roomManager = new RoomManager(workerPool);
  }
  return { workerPool, roomManager };
}

export function getWorkerPool(): WorkerPool {
  if (!workerPool) {
    throw new Error('Media worker pool is not initialized. Call initMedia() first.');
  }
  return workerPool;
}

export function getRoomManager(): RoomManager {
  if (!roomManager) {
    throw new Error('RoomManager is not initialized. Call initMedia() first.');
  }
  return roomManager;
}

export async function shutdownMedia(): Promise<void> {
  if (roomManager) {
    roomManager.closeAll();
    roomManager = null;
  }
  if (workerPool) {
    await workerPool.close();
    workerPool = null;
  }
}
