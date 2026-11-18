import crypto from 'node:crypto';
import { redis } from '../lib/redis.js';

export type AuthenticatedTicket = {
  userId: string;
  username: string;
  guest: false;
};

export type GuestTicket = {
  guest: true;
  id: string;
};

export type WsTicketData = AuthenticatedTicket | GuestTicket;

export async function createWsTicket(
  data: WsTicketData,
  ttlSeconds = 30
): Promise<string> {
  const ticket = crypto.randomBytes(24).toString('base64url');
  await redis.set(`ws:ticket:${ticket}`, JSON.stringify(data), 'EX', ttlSeconds);
  return ticket;
}

export async function redeemTicket(ticket: string): Promise<WsTicketData | null> {
  if (!ticket) return null;
  const raw = await redis.getdel(`ws:ticket:${ticket}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WsTicketData;
  } catch {
    return null;
  }
}

/**
 * Validates a ticket without consuming it (used by GET /api/ice-config for guest ticket holders).
 */
export async function peekWsTicket(ticket: string): Promise<WsTicketData | null> {
  if (!ticket) return null;
  const raw = await redis.get(`ws:ticket:${ticket}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WsTicketData;
  } catch {
    return null;
  }
}
