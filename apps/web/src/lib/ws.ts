import {
  ClientMessageType,
  ServerAckMessage,
  ServerErrorMessage,
  ServerPushMessage,
  WsErrorCode,
} from '@netstream/shared';
import { api } from './api';

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type WsEventHandler<T = unknown> = (data: T) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private status: WsStatus = 'closed';
  private listeners = new Map<string, Set<WsEventHandler>>();
  private onOpenHooks = new Set<() => void>();
  private pendingRequests = new Map<string, PendingRequest>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isManuallyClosed = false;

  private readonly baseDelay = 500;
  private readonly maxDelay = 30000;
  private readonly requestTimeoutMs = 10000;

  public getStatus(): WsStatus {
    return this.status;
  }

  private setStatus(status: WsStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status', status);
    }
  }

  /**
   * Connect to WebSocket server by first obtaining a one-time ticket.
   */
  public async connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isManuallyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    try {
      // 1. Obtain one-time ticket from REST API
      const res = await api.post<{ ticket: string }>('/api/ws-ticket');
      const ticket = res.ticket;

      if (this.isManuallyClosed) return;

      // 2. Form WebSocket URL with ticket
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`;

      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.setStatus('open');
        this.reconnectAttempt = 0;

        // Run all registered onOpen hooks (resubscribe rooms, etc.)
        for (const hook of this.onOpenHooks) {
          try {
            hook();
          } catch {
            // Ignore hook errors
          }
        }
      };

      socket.onmessage = (event: MessageEvent) => {
        if (this.ws !== socket) return;
        this.handleMessage(event.data);
      };

      socket.onerror = () => {
        // Will trigger onclose
      };

      socket.onclose = () => {
        if (this.ws !== socket) return;
        this.cleanupPendingRequests(new Error('WebSocket connection closed'));
        this.ws = null;

        if (!this.isManuallyClosed) {
          this.scheduleReconnect();
        } else {
          this.setStatus('closed');
        }
      };
    } catch {
      if (!this.isManuallyClosed) {
        this.scheduleReconnect();
      } else {
        this.setStatus('closed');
      }
    }
  }

  /**
   * Send a request and wait for matching ack or error reply (10-second timeout).
   */
  public request<T = unknown>(t: ClientMessageType | string, d?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not connected'));
    }

    const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`WebSocket request '${t}' timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, {
        resolve: (val: unknown) => resolve(val as T),
        reject,
        timer,
      });

      try {
        const payload = JSON.stringify({ t, id, d: d ?? {} });
        this.ws?.send(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Fire-and-forget send without awaiting an ack.
   */
  public send(t: ClientMessageType | string, d?: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t, d: d ?? {} }));
    }
  }

  /**
   * Subscribe to incoming messages of type `t`, or internal status events.
   */
  public on<T = unknown>(t: string, handler: WsEventHandler<T>): () => void {
    let set = this.listeners.get(t);
    if (!set) {
      set = new Set();
      this.listeners.set(t, set);
    }
    set.add(handler as WsEventHandler);

    return () => {
      this.off(t, handler);
    };
  }

  /**
   * Unsubscribe from events.
   */
  public off<T = unknown>(t: string, handler: WsEventHandler<T>): void {
    const set = this.listeners.get(t);
    if (set) {
      set.delete(handler as WsEventHandler);
      if (set.size === 0) {
        this.listeners.delete(t);
      }
    }
  }

  /**
   * Register a hook that is executed on every successful connection or reconnection.
   */
  public onOpen(hook: () => void): () => void {
    this.onOpenHooks.add(hook);
    if (this.status === 'open') {
      try {
        hook();
      } catch {
        // Ignore hook errors
      }
    }
    return () => {
      this.onOpenHooks.delete(hook);
    };
  }

  /**
   * Disconnect and cancel any scheduled reconnection.
   */
  public disconnect(): void {
    this.isManuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.cleanupPendingRequests(new Error('WebSocket disconnected by client'));
    this.setStatus('closed');
  }

  /**
   * Dev helper: abruptly close the underlying socket without disabling auto-reconnect,
   * simulating a transient network drop to test recovery.
   */
  public simulateDisconnect(): void {
    if (this.ws) {
      this.isManuallyClosed = false;
      this.ws.close(4000, 'Dev simulated disconnect');
    }
  }

  private emit(t: string, data: unknown): void {
    const set = this.listeners.get(t);
    if (set) {
      for (const handler of set) {
        try {
          handler(data);
        } catch {
          // Ignore handler exceptions
        }
      }
    }
  }

  private handleMessage(raw: unknown): void {
    try {
      const msg = JSON.parse(String(raw)) as
        | ServerAckMessage
        | ServerErrorMessage
        | ServerPushMessage;

      if (!msg || typeof msg !== 'object' || !msg.t) return;

      // Handle request/response pairs
      if (msg.t === 'ack' && 'id' in msg && msg.id) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg.d);
        }
        return;
      }

      if (msg.t === 'error' && 'id' in msg && msg.id) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.id);
          const errData = msg.d as { code: WsErrorCode; message: string };
          const err = new Error(errData?.message || 'WebSocket request failed');
          Object.assign(err, { code: errData?.code });
          pending.reject(err);
        }
        return;
      }

      // Dispatch to event subscribers
      this.emit(msg.t, (msg as ServerPushMessage).d);
    } catch {
      // Ignore unparseable frames
    }
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    this.reconnectAttempt += 1;

    // Full jitter exponential backoff: random_between(0, min(maxDelay, base * 2^attempt))
    const cap = Math.min(this.maxDelay, this.baseDelay * Math.pow(2, this.reconnectAttempt));
    const delay = Math.floor(Math.random() * cap);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private cleanupPendingRequests(reason: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pendingRequests.clear();
  }
}

export * from './WsContext';
