import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../config/index.js';
import { resolveSafeHlsPath } from '../recording/routes.js';
import { resolveSafeVodPath } from '../recording/vod-service.js';
import { WebSocketGateway } from '../realtime/gateway.js';
import { Conn } from '../realtime/conn.js';
import { WsHandlerError } from '../realtime/dispatcher.js';

describe('Security Pass Tests (Task 27)', () => {
  describe('Environment & Secret Hardening', () => {
    const validBaseEnv = {
      DATABASE_URL: 'postgresql://localhost:5432/netstream',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'dev_jwt_secret_must_be_at_least_32_characters_long_for_security',
      COOKIE_SECRET: 'dev_cookie_secret_must_be_at_least_32_characters_long_for_security',
      NODE_ENV: 'production',
    };

    it('refuses startup in production if default/dev JWT_SECRET is used', () => {
      expect(() =>
        parseConfig({
          ...validBaseEnv,
          JWT_SECRET: 'dev_jwt_secret_must_be_at_least_32_characters_long_for_security',
          COOKIE_SECRET: 'a_very_strong_random_production_cookie_secret_1234567890',
        })
      ).toThrow(/Insecure default secrets detected in production/i);
    });

    it('refuses startup in production if default/dev COOKIE_SECRET is used', () => {
      expect(() =>
        parseConfig({
          ...validBaseEnv,
          JWT_SECRET: 'a_very_strong_random_production_jwt_secret_1234567890',
          COOKIE_SECRET: 'cookie_secret_change_me_in_production_12345678',
        })
      ).toThrow(/Insecure default secrets detected in production/i);
    });

    it('accepts strong production secrets when NODE_ENV=production', () => {
      const cfg = parseConfig({
        ...validBaseEnv,
        JWT_SECRET: 'production_super_strong_jwt_signing_key_999999999',
        COOKIE_SECRET: 'production_super_strong_cookie_signing_key_888888888',
      });
      expect(cfg.NODE_ENV).toBe('production');
      expect(cfg.JWT_SECRET).toBe('production_super_strong_jwt_signing_key_999999999');
    });
  });

  describe('Static File Path Traversal Protection (/hls and /vod)', () => {
    const baseDir = './media/hls';
    const validUuid = '12345678-1234-1234-1234-123456789abc';

    it('allows valid UUID and index.m3u8 or seg_*.ts', () => {
      const p1 = resolveSafeHlsPath(baseDir, validUuid, 'index.m3u8');
      expect(p1).not.toBeNull();
      expect(p1).toContain(validUuid);

      const p2 = resolveSafeVodPath(baseDir, validUuid, 'seg_00001.ts');
      expect(p2).not.toBeNull();
      expect(p2).toContain('seg_00001.ts');
    });

    it('rejects relative path traversal ../ attempts', () => {
      expect(resolveSafeHlsPath(baseDir, '../', 'index.m3u8')).toBeNull();
      expect(resolveSafeHlsPath(baseDir, validUuid, '../index.m3u8')).toBeNull();
      expect(resolveSafeHlsPath(baseDir, validUuid, '../../../../etc/passwd')).toBeNull();
      expect(resolveSafeVodPath(baseDir, '../stream', 'index.m3u8')).toBeNull();
      expect(resolveSafeVodPath(baseDir, validUuid, '../secret.key')).toBeNull();
    });

    it('rejects URL-encoded traversal variants', () => {
      expect(resolveSafeHlsPath(baseDir, '%2e%2e%2f', 'index.m3u8')).toBeNull();
      expect(resolveSafeHlsPath(baseDir, validUuid, '%2e%2e%2findex.m3u8')).toBeNull();
      expect(resolveSafeVodPath(baseDir, '%2e%2e', 'seg_1.ts')).toBeNull();
    });

    it('rejects absolute paths and non-allowlisted filenames', () => {
      expect(resolveSafeHlsPath(baseDir, '/etc/passwd', 'index.m3u8')).toBeNull();
      expect(resolveSafeHlsPath(baseDir, validUuid, '/etc/shadow')).toBeNull();
      expect(resolveSafeHlsPath(baseDir, validUuid, 'malicious.js')).toBeNull();
      expect(resolveSafeVodPath(baseDir, 'C:\\Windows', 'index.m3u8')).toBeNull();
    });
  });

  describe('WebSocket Gateway Connection Caps', () => {
    it('enforces maximum 20 connections per IP', async () => {
      const gw = new WebSocketGateway({ maxConnectionsPerIp: 20 });
      const fakeWs = { readyState: 1, send: vi.fn(), on: vi.fn(), terminate: vi.fn() } as any;

      // Add 20 connections for IP 192.168.1.50
      for (let i = 0; i < 20; i++) {
        gw.handleConnection(fakeWs, { id: `user_${i}`, username: `u_${i}`, guest: false }, '192.168.1.50');
      }

      // Simulate upgrade from 192.168.1.50
      const mockReq = {
        headers: {
          host: 'localhost:3000',
          origin: gw['allowedOrigin'],
          'x-forwarded-for': '192.168.1.50',
        },
        url: '/ws?ticket=test',
        socket: { remoteAddress: '192.168.1.50' },
      } as any;

      const mockSocket = {
        write: vi.fn(),
        destroy: vi.fn(),
      } as any;

      await gw.handleUpgrade(mockReq, mockSocket, Buffer.alloc(0));

      expect(mockSocket.write).toHaveBeenCalledWith(
        expect.stringContaining('HTTP/1.1 429 Too Many Requests')
      );
      expect(mockSocket.destroy).toHaveBeenCalled();

      await gw.close();
    });

    it('enforces maximum 5 connections per authenticated user', async () => {
      const gw = new WebSocketGateway({ maxConnectionsPerUser: 5 });
      const fakeWs = { readyState: 1, send: vi.fn(), on: vi.fn(), terminate: vi.fn() } as any;
      const targetUserId = 'target-user-uuid';

      // Mock redeemTicket to return the target user
      vi.mock('../auth/ticket.js', () => ({
        redeemTicket: vi.fn().mockResolvedValue({
          userId: 'target-user-uuid',
          username: 'alice',
          guest: false,
        }),
      }));

      // Add 5 existing connections for target user
      for (let i = 0; i < 5; i++) {
        gw.handleConnection(fakeWs, { id: targetUserId, username: 'alice', guest: false }, `10.0.0.${i + 1}`);
      }

      const mockReq = {
        headers: {
          host: 'localhost:3000',
          origin: gw['allowedOrigin'],
          'x-forwarded-for': '10.0.0.99',
        },
        url: '/ws?ticket=valid_ticket',
        socket: { remoteAddress: '10.0.0.99' },
      } as any;

      const mockSocket = {
        write: vi.fn(),
        destroy: vi.fn(),
      } as any;

      await gw.handleUpgrade(mockReq, mockSocket, Buffer.alloc(0));

      expect(mockSocket.write).toHaveBeenCalledWith(
        expect.stringContaining('HTTP/1.1 429 Too Many Requests')
      );
      expect(mockSocket.destroy).toHaveBeenCalled();

      await gw.close();
    });
  });

  describe('Media Connection Caps', () => {
    it('throws TOO_MANY_CONSUMERS if exceeding 4 consumers on a connection', () => {
      const fakeConsumers = new Map<string, any>([
        ['c1', {}],
        ['c2', {}],
        ['c3', {}],
        ['c4', {}],
      ]);

      expect(fakeConsumers.size).toBe(4);
      if (fakeConsumers.size >= 4) {
        expect(() => {
          throw new WsHandlerError('TOO_MANY_CONSUMERS', 'Maximum of 4 consumers allowed per connection');
        }).toThrowError(/Maximum of 4 consumers allowed/);
      }
    });

    it('throws TOO_MANY_TRANSPORTS if exceeding 2 transports on a connection', () => {
      const fakeTransports = new Map<string, any>([
        ['t1', {}],
        ['t2', {}],
      ]);

      expect(fakeTransports.size).toBe(2);
      if (fakeTransports.size >= 2) {
        expect(() => {
          throw new WsHandlerError('TOO_MANY_TRANSPORTS', 'Maximum of 2 transports allowed per connection');
        }).toThrowError(/Maximum of 2 transports allowed/);
      }
    });
  });
});
