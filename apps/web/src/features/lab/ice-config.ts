import { api, getAccessToken } from '../../lib/api';

export interface IceConfigPayload {
  iceServers: RTCIceServer[];
  ttlSeconds: number;
  expiresAt: number;
}

const FORCE_RELAY_STORAGE_KEY = 'netstream_dev_force_relay';
const relayListeners = new Set<(enabled: boolean) => void>();

/**
 * Dev-only flag to force `iceTransportPolicy: 'relay'` on WebRTC transports
 * so TURN relay connectivity can be verified even on a local network.
 */
export function getForceRelay(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return sessionStorage.getItem(FORCE_RELAY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setForceRelay(enabled: boolean): void {
  if (!import.meta.env.DEV) return;
  try {
    sessionStorage.setItem(FORCE_RELAY_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
  for (const listener of relayListeners) {
    try {
      listener(enabled);
    } catch {
      // ignore listener errors
    }
  }
}

export function subscribeForceRelay(listener: (enabled: boolean) => void): () => void {
  relayListeners.add(listener);
  return () => {
    relayListeners.delete(listener);
  };
}

/**
 * Fetches STUN/TURN iceServers from GET /api/ice-config.
 * Authenticated users pass their Bearer token; guest viewers automatically
 * acquire a short-lived guest ticket from POST /api/ws-ticket.
 */
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    if (getAccessToken()) {
      const res = await api.get<IceConfigPayload>('/api/ice-config');
      return Array.isArray(res?.iceServers) ? res.iceServers : [];
    }

    const ticketRes = await api.post<{ ticket: string }>('/api/ws-ticket', undefined, {
      skipAuth: true,
    });
    const res = await api.get<IceConfigPayload>(
      `/api/ice-config?ticket=${encodeURIComponent(ticketRes.ticket)}`,
      { skipAuth: true }
    );
    return Array.isArray(res?.iceServers) ? res.iceServers : [];
  } catch {
    // Fallback gracefully to direct candidates if ICE config endpoint is unavailable
    return [];
  }
}
