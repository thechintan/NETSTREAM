import {
  clientMessageSchema,
  ClientMessage,
  ClientMessageType,
  WS_CLOSE_CODES,
  WsErrorCode,
  wsEnvelopeSchema,
} from '@netstream/shared';
import { Conn } from './conn.js';

export type MessageHandler<T extends ClientMessage = ClientMessage, R = unknown> = (
  conn: Conn,
  msg: T
) => Promise<R> | R;

export class RateLimiter {
  private windowStart = Date.now();
  private count = 0;
  private readonly maxPerSecond: number;

  constructor(maxPerSecond = 50) {
    this.maxPerSecond = maxPerSecond;
  }

  public check(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.maxPerSecond;
  }
}

export class WsHandlerError extends Error {
  constructor(
    public readonly code: WsErrorCode,
    message: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'WsHandlerError';
  }
}

export type GenericMessageHandler = (conn: Conn, msg: ClientMessage) => Promise<unknown> | unknown;

export class Dispatcher {
  private handlers = new Map<string, GenericMessageHandler>();
  private rateLimiters = new WeakMap<Conn, RateLimiter>();
  private readonly maxPerSecond: number;

  constructor(maxPerSecond = 50) {
    this.maxPerSecond = maxPerSecond;

    // Register built-in test.echo handler
    this.register('test.echo', (_conn, msg) => {
      return msg.d ?? {};
    });
  }

  /**
   * Register a handler for a client-to-server message type.
   */
  public register<T extends ClientMessageType>(
    type: T,
    handler: MessageHandler<Extract<ClientMessage, { t: T }>>
  ): void {
    this.handlers.set(type, handler as unknown as GenericMessageHandler);
  }

  /**
   * Remove a registered handler.
   */
  public unregister(type: string): void {
    this.handlers.delete(type);
  }

  /**
   * Dispatch an incoming raw message buffer or string from a connection.
   */
  public async dispatch(conn: Conn, rawData: string | Buffer): Promise<void> {
    // 1. Check rate limit
    let limiter = this.rateLimiters.get(conn);
    if (!limiter) {
      limiter = new RateLimiter(this.maxPerSecond);
      this.rateLimiters.set(conn, limiter);
    }

    if (!limiter.check()) {
      conn.close(WS_CLOSE_CODES.TOO_MANY_MESSAGES, 'Too many messages');
      return;
    }

    // 2. Parse JSON
    let parsedJson: unknown;
    try {
      const text = typeof rawData === 'string' ? rawData : rawData.toString('utf-8');
      parsedJson = JSON.parse(text);
    } catch {
      conn.close(WS_CLOSE_CODES.BAD_MESSAGE, 'Malformed JSON');
      return;
    }

    // 3. Inspect envelope
    const envelopeResult = wsEnvelopeSchema.safeParse(parsedJson);
    if (!envelopeResult.success) {
      // If not even a valid envelope with t: string, return bad request or close
      conn.fail(undefined, 'BAD_REQUEST', 'Invalid message envelope format');
      return;
    }

    const { t, id } = envelopeResult.data;

    // 4. Validate with clientMessageSchema
    const validationResult = clientMessageSchema.safeParse(parsedJson);
    if (!validationResult.success) {
      // Check if the type is completely unknown or the payload schema was invalid
      const handlerExists = this.handlers.has(t);
      if (!handlerExists) {
        conn.fail(id, 'UNKNOWN_TYPE', `Unknown message type: ${t}`);
      } else {
        const issues = validationResult.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(', ');
        conn.fail(id, 'BAD_REQUEST', `Message validation error: ${issues}`);
      }
      return;
    }

    const validMsg = validationResult.data;
    const handler = this.handlers.get(t);
    if (!handler) {
      conn.fail(id, 'UNKNOWN_TYPE', `No handler registered for message type: ${t}`);
      return;
    }

    // 5. Execute handler
    try {
      const result = await handler(conn, validMsg);
      if (id && result !== undefined) {
        conn.ack(id, result ?? {});
      }
    } catch (err: unknown) {
      if (err instanceof WsHandlerError) {
        if (id) {
          conn.fail(id, err.code, err.message, err.retryAfterMs);
        }
        return;
      }
      if (err && typeof err === 'object' && 'code' in err) {
        const custom = err as { code: WsErrorCode; message: string; retryAfterMs?: number };
        if (id) {
          conn.fail(id, custom.code, custom.message, custom.retryAfterMs);
        }
        return;
      }
      const message = err instanceof Error ? err.message : 'Internal server error';
      if (id) {
        conn.fail(id, 'INTERNAL_ERROR', message);
      }
    }
  }
}
