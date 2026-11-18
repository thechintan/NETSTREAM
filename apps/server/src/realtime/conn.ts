import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  ServerAckMessage,
  ServerErrorMessage,
  ServerPushMessage,
  ServerToClientPushType,
  WsErrorCode,
} from '@netstream/shared';

export interface ConnUser {
  id: string;
  username: string;
  guest: boolean;
}

export class Conn {
  public readonly id: string;
  public readonly user: ConnUser;
  public alive: boolean;
  public readonly rooms: Set<string>;
  public readonly state: Map<string, unknown>;
  public readonly ws: WebSocket;
  public readonly ip: string;

  constructor(ws: WebSocket, user: ConnUser, id?: string, ip = '127.0.0.1') {
    this.ws = ws;
    this.user = user;
    this.id = id || crypto.randomUUID();
    this.ip = ip;
    this.alive = true;
    this.rooms = new Set<string>();
    this.state = new Map<string, unknown>();
  }

  /**
   * Send a push message or generic message to the client.
   */
  public send<T = unknown>(t: ServerToClientPushType | string, d?: T): void {
    if (this.ws.readyState === this.ws.OPEN) {
      const msg: ServerPushMessage<T> = {
        t: t as ServerToClientPushType,
        d: (d ?? {}) as T,
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Reply with an acknowledgment to a client request.
   */
  public ack<T = unknown>(id: string, d?: T): void {
    if (this.ws.readyState === this.ws.OPEN) {
      const msg: ServerAckMessage<T> = {
        t: 'ack',
        id,
        d,
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Reply with an error to a client request.
   */
  public fail(
    id: string | undefined,
    code: WsErrorCode,
    message: string,
    retryAfterMs?: number
  ): void {
    if (this.ws.readyState === this.ws.OPEN) {
      const msg: ServerErrorMessage = {
        t: 'error',
        id,
        d: {
          code,
          message,
          retryAfterMs,
        },
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Close connection with close code and reason.
   */
  public close(code: number, reason?: string): void {
    if (this.ws.readyState === this.ws.OPEN || this.ws.readyState === this.ws.CONNECTING) {
      this.ws.close(code, reason);
    }
  }
}
