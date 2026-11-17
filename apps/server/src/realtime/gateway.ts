import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config/index.js';
import { redeemTicket } from '../auth/ticket.js';
import { Conn, ConnUser } from './conn.js';
import { Dispatcher } from './dispatcher.js';

export type CleanupHook = (conn: Conn) => void | Promise<void>;

export interface GatewayOptions {
  allowedOrigin?: string;
  heartbeatIntervalMs?: number;
  maxPayload?: number;
  maxPerSecond?: number;
}

export class WebSocketGateway {
  public readonly wss: WebSocketServer;
  public readonly dispatcher: Dispatcher;
  public readonly conns = new Map<string, Conn>();
  public readonly rooms = new Map<string, Set<Conn>>();
  private cleanupHooks: CleanupHook[] = [];
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly allowedOrigin: string;
  private readonly heartbeatIntervalMs: number;

  constructor(options: GatewayOptions = {}) {
    this.allowedOrigin = options.allowedOrigin ?? config.WEB_ORIGIN;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25000;

    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: options.maxPayload ?? 16 * 1024, // 16 KB
    });

    this.dispatcher = new Dispatcher(options.maxPerSecond ?? 50);

    this.startHeartbeat();
  }

  /**
   * Register a cleanup hook to be executed whenever any connection closes.
   */
  public onCleanup(hook: CleanupHook): void {
    this.cleanupHooks.push(hook);
  }

  /**
   * HTTP upgrade handler to authenticate and establish WebSocket connection.
   */
  public async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      const host = req.headers.host || 'localhost';
      const url = new URL(req.url || '', `http://${host}`);

      if (url.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      // 1. Verify Origin
      const origin = req.headers.origin;
      if (!origin || origin !== this.allowedOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      // 2. Extract and redeem ticket
      const ticket = url.searchParams.get('ticket');
      if (!ticket) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const ticketData = await redeemTicket(ticket);
      if (!ticketData) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const user: ConnUser = ticketData.guest
        ? {
            id: ticketData.id,
            username: `guest_${ticketData.id.slice(0, 8)}`,
            guest: true,
          }
        : {
            id: ticketData.userId,
            username: ticketData.username,
            guest: false,
          };

      // 3. Upgrade socket
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.handleConnection(ws, user);
      });
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  }

  private handleConnection(ws: WebSocket, user: ConnUser): void {
    const conn = new Conn(ws, user);
    this.conns.set(conn.id, conn);

    // Heartbeat pong tracking
    ws.on('pong', () => {
      conn.alive = true;
    });

    // Inbound messages
    ws.on('message', async (data) => {
      await this.dispatcher.dispatch(conn, data as string | Buffer);
    });

    // Connection termination and cleanup
    const handleClose = async () => {
      this.conns.delete(conn.id);

      // Leave all rooms
      for (const room of conn.rooms) {
        this.leaveRoom(conn, room);
      }

      // Run cleanup hooks
      for (const hook of this.cleanupHooks) {
        try {
          await hook(conn);
        } catch {
          // Ignore errors in cleanup hooks to prevent crashing other hooks
        }
      }
    };

    ws.on('close', () => {
      void handleClose();
    });

    ws.on('error', () => {
      // ws close event will also fire following an error
    });
  }

  /**
   * Heartbeat runner pinging connections every interval.
   */
  private startHeartbeat(): void {
    if (this.heartbeatIntervalMs <= 0) return;

    this.heartbeatTimer = setInterval(() => {
      for (const conn of this.conns.values()) {
        if (!conn.alive) {
          conn.ws.terminate();
          continue;
        }
        conn.alive = false;
        conn.ws.ping();
      }
    }, this.heartbeatIntervalMs);

    // Unref timer so it doesn't hold open node process
    this.heartbeatTimer.unref();
  }

  /**
   * Add a connection to a room.
   */
  public joinRoom(conn: Conn, room: string): void {
    conn.rooms.add(room);
    let set = this.rooms.get(room);
    if (!set) {
      set = new Set<Conn>();
      this.rooms.set(room, set);
    }
    set.add(conn);
  }

  /**
   * Remove a connection from a room.
   */
  public leaveRoom(conn: Conn, room: string): void {
    conn.rooms.delete(room);
    const set = this.rooms.get(room);
    if (set) {
      set.delete(conn);
      if (set.size === 0) {
        this.rooms.delete(room);
      }
    }
  }

  /**
   * Broadcast a push message to all members in a room.
   */
  public broadcastToRoom<T = unknown>(
    room: string,
    t: string,
    d?: T,
    excludeConnId?: string
  ): void {
    const set = this.rooms.get(room);
    if (!set) return;

    for (const conn of set) {
      if (excludeConnId && conn.id === excludeConnId) continue;
      conn.send(t, d);
    }
  }

  /**
   * Broadcast a push message to all connected clients.
   */
  public broadcast<T = unknown>(t: string, d?: T): void {
    for (const conn of this.conns.values()) {
      conn.send(t, d);
    }
  }

  /**
   * Shut down the gateway and terminate all active connections.
   */
  public close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const conn of this.conns.values()) {
      conn.ws.terminate();
    }
    this.conns.clear();
    this.rooms.clear();

    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }
}

// Singleton gateway instance
let defaultGateway: WebSocketGateway | null = null;

export function getWebSocketGateway(options?: GatewayOptions): WebSocketGateway {
  if (!defaultGateway) {
    defaultGateway = new WebSocketGateway(options);
  }
  return defaultGateway;
}
