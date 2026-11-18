import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Look for .env in cwd and parent directories
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '../.env'),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
  PUBLIC_IP: z.string().min(1).default('127.0.0.1'),
  RTC_MIN_PORT: z.coerce.number().int().min(1024).max(65535).default(40000),
  RTC_MAX_PORT: z.coerce.number().int().min(1024).max(65535).default(40100),
  MEDIA_WORKERS: z.coerce.number().int().min(1).optional(),
  MEDIA_FORCE_TCP: z
    .union([z.boolean(), z.string()])
    .transform((val) => (typeof val === 'string' ? val.toLowerCase() === 'true' : Boolean(val)))
    .default(false),
  TURN_HOST: z.string().min(1).default('localhost'),
  TURN_SECRET: z.string().min(1).default('dev_turn_secret'),
  HLS_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((val) => (typeof val === 'string' ? val.toLowerCase() === 'true' : Boolean(val)))
    .default(true),
  HLS_DIR: z.string().default('./media/hls'),
  VOD_DIR: z.string().default('./media/vod'),
  VOD_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Config = z.infer<typeof envSchema>;

export const INSECURE_DEFAULT_SECRETS = [
  'dev_jwt_secret_must_be_at_least_32_characters_long_for_security',
  'dev_cookie_secret_must_be_at_least_32_characters_long_for_security',
  'dev_secret_change_me_in_production_12345678',
  'cookie_secret_change_me_in_production_12345678',
];

export function parseConfig(rawEnv: Record<string, unknown>): Config {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorMessages = result.error.errors
      .map((issue) => `  - ${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  // Refuse default development secrets in production mode
  if (result.data.NODE_ENV === 'production') {
    const jwtLower = result.data.JWT_SECRET.toLowerCase();
    const cookieLower = result.data.COOKIE_SECRET.toLowerCase();

    const isDefaultJwt =
      INSECURE_DEFAULT_SECRETS.includes(result.data.JWT_SECRET) ||
      jwtLower.includes('change_me') ||
      jwtLower.includes('dev_');

    const isDefaultCookie =
      INSECURE_DEFAULT_SECRETS.includes(result.data.COOKIE_SECRET) ||
      cookieLower.includes('change_me') ||
      cookieLower.includes('dev_');

    if (isDefaultJwt || isDefaultCookie) {
      throw new Error(
        'Insecure default secrets detected in production: JWT_SECRET and COOKIE_SECRET must be explicitly set to strong production values.'
      );
    }
  }

  return result.data;
}

export function loadConfig(rawEnv: Record<string, unknown> = process.env): Config {
  try {
    return parseConfig(rawEnv);
  } catch (error: unknown) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    throw error;
  }
}

export const config = loadConfig();
