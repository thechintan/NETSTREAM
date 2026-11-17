import { FastifyReply, FastifyRequest } from 'fastify';
import { JwtUserPayload, verifyAccessToken } from './jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtUserPayload;
  }
}

export function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Missing or invalid Authorization header',
    });
  }

  const payload = await verifyAccessToken(token);
  if (!payload) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired access token',
    });
  }

  request.user = payload;
}

export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    return;
  }

  const payload = await verifyAccessToken(token);
  if (payload) {
    request.user = payload;
  }
}
