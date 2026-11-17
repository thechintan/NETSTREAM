import { ChatMessageDto } from '@netstream/shared';
import { db } from '../db/index.js';
import { chatMessages } from '../db/schema.js';

export interface PersistenceOptions {
  batchSize?: number;
  flushIntervalMs?: number;
}

export class ChatPersistenceWorker {
  private queue: ChatMessageDto[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private isFlushing = false;

  constructor(options: PersistenceOptions = {}) {
    this.batchSize = options.batchSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;

    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref();
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public enqueue(message: ChatMessageDto): void {
    this.queue.push(message);
    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    // Drain the current batch
    const batch = this.queue.splice(0, this.queue.length);

    if (batch.length === 0) {
      this.isFlushing = false;
      return;
    }

    const rows = batch.map((m) => ({
      id: m.mid,
      channelId: m.channelId,
      userId: m.user.id,
      text: m.text,
      createdAt: new Date(m.ts),
    }));

    try {
      await db.insert(chatMessages).values(rows).onConflictDoNothing();
    } catch {
      // Persistence failures must never block or break delivery; log and retry once
      try {
        await db.insert(chatMessages).values(rows).onConflictDoNothing();
      } catch (retryErr) {
        console.error('Chat persistence worker failed to write batch after retry:', retryErr);
      }
    } finally {
      this.isFlushing = false;
      if (this.queue.length >= this.batchSize) {
        void this.flush();
      }
    }
  }

  public async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

let defaultWorker: ChatPersistenceWorker | null = null;

export function getChatPersistenceWorker(options?: PersistenceOptions): ChatPersistenceWorker {
  if (!defaultWorker) {
    defaultWorker = new ChatPersistenceWorker(options);
  }
  return defaultWorker;
}
