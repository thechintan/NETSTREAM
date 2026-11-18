import os from 'node:os';
import * as mediasoup from 'mediasoup';
import type { Worker, WorkerLogLevel } from 'mediasoup/node/lib/WorkerTypes.js';
import { config } from '../config/index.js';

export interface WorkerInfo {
  pid: number;
  closed: boolean;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;

  constructor(
    private readonly options?: {
      numWorkers?: number;
      rtcMinPort?: number;
      rtcMaxPort?: number;
      logLevel?: WorkerLogLevel;
      onDied?: (worker: Worker) => void;
    }
  ) {}

  async init(): Promise<void> {
    if (this.workers.length > 0) {
      return;
    }

    const count =
      this.options?.numWorkers ??
      config.MEDIA_WORKERS ??
      Math.max(1, os.cpus().length - 1);

    const rtcMinPort = this.options?.rtcMinPort ?? config.RTC_MIN_PORT;
    const rtcMaxPort = this.options?.rtcMaxPort ?? config.RTC_MAX_PORT;
    const logLevel: WorkerLogLevel = this.options?.logLevel ?? 'warn';

    for (let i = 0; i < count; i++) {
      const worker = await mediasoup.createWorker({
        logLevel,
        rtcMinPort,
        rtcMaxPort,
      });

      worker.on('died', () => {
        console.error(`[WorkerPool] mediasoup worker (pid=${worker.pid}) died unexpectedly! Exiting process.`);
        if (this.options?.onDied) {
          this.options.onDied(worker);
        } else {
          process.exit(1);
        }
      });

      this.workers.push(worker);
    }
  }

  getNextWorker(): Worker {
    if (this.workers.length === 0) {
      throw new Error('WorkerPool is not initialized or has no active workers');
    }

    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  getWorkers(): Worker[] {
    return [...this.workers];
  }

  getWorkerInfos(): WorkerInfo[] {
    return this.workers.map((w) => ({
      pid: w.pid,
      closed: w.closed,
    }));
  }

  async close(): Promise<void> {
    for (const worker of this.workers) {
      if (!worker.closed) {
        worker.close();
      }
    }
    this.workers = [];
    this.nextWorkerIndex = 0;
  }
}
