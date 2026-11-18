import { MEDIA_CODECS } from './config.js';
import { createWebRtcTransport, type CreateTransportOptions } from './transport.js';
import type { Room, CreateWebRtcTransportResult } from './types.js';
import type { WorkerPool } from './worker-pool.js';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private routerWorkerMap = new Map<string, number>(); // routerId -> workerPid

  constructor(private readonly workerPool: WorkerPool) {}

  async getOrCreate(channelId: string): Promise<Room> {
    const existing = this.rooms.get(channelId);
    if (existing) {
      return existing;
    }

    const worker = this.workerPool.getNextWorker();
    const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });

    const room: Room = {
      channelId,
      router,
      producers: new Map(),
      viewers: new Map(),
      transports: new Map(),
    };

    this.rooms.set(channelId, room);
    this.routerWorkerMap.set(router.id, worker.pid);

    router.on('workerclose', () => {
      this.rooms.delete(channelId);
      this.routerWorkerMap.delete(router.id);
    });

    router.observer.on('close', () => {
      this.rooms.delete(channelId);
      this.routerWorkerMap.delete(router.id);
    });

    return room;
  }

  get(channelId: string): Room | undefined {
    return this.rooms.get(channelId);
  }

  close(channelId: string): void {
    const room = this.rooms.get(channelId);
    if (!room) {
      return;
    }

    // Close all transports tracked in the room
    for (const transport of room.transports.values()) {
      if (!transport.closed) {
        transport.close();
      }
    }

    // Close the router
    if (!room.router.closed) {
      room.router.close();
    }

    this.routerWorkerMap.delete(room.router.id);
    this.rooms.delete(channelId);
  }

  list(): Room[] {
    return Array.from(this.rooms.values());
  }

  async createWebRtcTransport(
    room: Room,
    options?: CreateTransportOptions
  ): Promise<CreateWebRtcTransportResult> {
    return createWebRtcTransport(room, options);
  }

  getRouterCountForWorker(workerPid: number): number {
    let count = 0;
    for (const pid of this.routerWorkerMap.values()) {
      if (pid === workerPid) {
        count++;
      }
    }
    return count;
  }

  closeAll(): void {
    for (const channelId of Array.from(this.rooms.keys())) {
      this.close(channelId);
    }
    this.rooms.clear();
    this.routerWorkerMap.clear();
  }
}
