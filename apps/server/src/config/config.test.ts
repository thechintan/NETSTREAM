import { describe, expect, it } from 'vitest';
import { parseConfig } from './index.js';

describe('Config Module', () => {
  const validEnv = {
    PORT: '3000',
    WEB_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/netstream',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'super_secret_jwt_key_at_least_32_characters_long',
    COOKIE_SECRET: 'super_secret_cookie_key_at_least_32_characters_long',
    PUBLIC_IP: '127.0.0.1',
    RTC_MIN_PORT: '40000',
    RTC_MAX_PORT: '40100',
    TURN_HOST: 'localhost',
    TURN_SECRET: 'dev_turn_secret',
    HLS_ENABLED: 'true',
    HLS_DIR: './media/hls',
    VOD_DIR: './media/vod',
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
  };

  it('correctly parses and coerces valid environment variables', () => {
    const config = parseConfig(validEnv);
    expect(config.PORT).toBe(3000);
    expect(config.WEB_ORIGIN).toBe('http://localhost:5173');
    expect(config.HLS_ENABLED).toBe(true);
    expect(config.RTC_MIN_PORT).toBe(40000);
    expect(config.RTC_MAX_PORT).toBe(40100);
  });

  it('fails fast when required variables are missing or invalid', () => {
    const invalidEnv = { ...validEnv, JWT_SECRET: 'too_short' };
    expect(() => parseConfig(invalidEnv)).toThrowError(
      /Environment validation failed/
    );
  });
});
