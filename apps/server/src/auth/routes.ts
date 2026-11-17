import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import {
  loginSchema,
  registerSchema,
} from '@netstream/shared';
import { config } from '../config/index.js';
import { optionalAuth, requireAuth } from './middleware.js';
import { checkRateLimit } from './ratelimit.js';
import {
  getMe,
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
} from './service.js';
import { createWsTicket } from './ticket.js';

export function registerAuthRoutes(app: FastifyInstance) {
  const isProd = config.NODE_ENV === 'production';

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
  };

  // POST /api/auth/register
  app.post('/api/auth/register', async (request, reply) => {
    const parseResult = registerSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0]?.message || 'Invalid input',
        details: parseResult.error.format(),
      });
    }

    const { email, username, password } = parseResult.data;
    const ip = request.ip || '127.0.0.1';

    // Rate limiting by IP and username
    const ipCheck = await checkRateLimit(`ratelimit:register:ip:${ip}`);
    if (!ipCheck.allowed) {
      return reply.status(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many registration attempts. Please try again later.',
      });
    }

    const userCheck = await checkRateLimit(
      `ratelimit:register:user:${username.toLowerCase()}`
    );
    if (!userCheck.allowed) {
      return reply.status(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many registration attempts. Please try again later.',
      });
    }

    const authResult = await registerUser({ email, username, password });
    if (authResult.error) {
      return reply.status(authResult.status).send({
        error: authResult.error.code,
        message: authResult.error.message,
      });
    }

    const { user, accessToken, rawRefreshToken, refreshTokenExpiresAt } =
      authResult.result!;

    reply.setCookie('refreshToken', rawRefreshToken, {
      ...cookieOptions,
      expires: refreshTokenExpiresAt,
    });

    return reply.status(201).send({
      user,
      accessToken,
    });
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (request, reply) => {
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: parseResult.error.errors[0]?.message || 'Invalid input',
      });
    }

    const ip = request.ip || '127.0.0.1';
    const identifier = (
      parseResult.data.identifier ||
      parseResult.data.username ||
      parseResult.data.email
    )!.trim();

    // Rate limiting by IP and identifier
    const ipCheck = await checkRateLimit(`ratelimit:login:ip:${ip}`);
    if (!ipCheck.allowed) {
      return reply.status(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many login attempts. Please try again later.',
      });
    }

    const userCheck = await checkRateLimit(
      `ratelimit:login:user:${identifier.toLowerCase()}`
    );
    if (!userCheck.allowed) {
      return reply.status(429).send({
        error: 'RATE_LIMITED',
        message: 'Too many login attempts. Please try again later.',
      });
    }

    const authResult = await loginUser(parseResult.data);
    if (authResult.error) {
      return reply.status(authResult.status).send({
        error: authResult.error.code,
        message: authResult.error.message,
      });
    }

    const { user, accessToken, rawRefreshToken, refreshTokenExpiresAt } =
      authResult.result!;

    reply.setCookie('refreshToken', rawRefreshToken, {
      ...cookieOptions,
      expires: refreshTokenExpiresAt,
    });

    return reply.status(200).send({
      user,
      accessToken,
    });
  });

  // POST /api/auth/refresh
  app.post('/api/auth/refresh', async (request, reply) => {
    const rawRefreshToken = request.cookies.refreshToken;
    const authResult = await refreshSession(rawRefreshToken);

    if (authResult.error) {
      reply.clearCookie('refreshToken', cookieOptions);
      return reply.status(authResult.status).send({
        error: authResult.error.code,
        message: authResult.error.message,
      });
    }

    const { user, accessToken, rawRefreshToken: newRaw, refreshTokenExpiresAt } =
      authResult.result!;

    reply.setCookie('refreshToken', newRaw, {
      ...cookieOptions,
      expires: refreshTokenExpiresAt,
    });

    return reply.status(200).send({
      user,
      accessToken,
    });
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', async (request, reply) => {
    const rawRefreshToken = request.cookies.refreshToken;
    await logoutSession(rawRefreshToken);
    reply.clearCookie('refreshToken', cookieOptions);
    return reply.status(200).send({ ok: true });
  });

  // GET /api/me
  app.get('/api/me', { preHandler: [requireAuth] }, async (request, reply) => {
    const result = await getMe(request.user!.id);
    if (!result) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'User not found',
      });
    }
    return reply.status(200).send(result);
  });

  // POST /api/ws-ticket
  app.post('/api/ws-ticket', { preHandler: [optionalAuth] }, async (request, reply) => {
    const ttlHeader = request.headers['x-ticket-ttl'];
    const ttl = ttlHeader ? Number(ttlHeader) : 30;

    const ticket = await createWsTicket(
      request.user
        ? {
            userId: request.user.id,
            username: request.user.username,
            guest: false,
          }
        : {
            guest: true,
            id: crypto.randomUUID(),
          },
      ttl
    );

    return reply.status(200).send({ ticket });
  });
}
