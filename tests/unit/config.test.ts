/**
 * Configuration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, validateConfig, type Config } from '../../src/config/index.js';

describe('Config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['TELEGRAM_WEBHOOK_SECRET'];
    delete process.env['TELEGRAM_ALLOWED_USERS'];
    delete process.env['REDIS_URL'];
    delete process.env['GATEWAY_PORT'];
    delete process.env['LOG_LEVEL'];
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe('loadConfig', () => {
    it('should load config from environment', () => {
      process.env['TELEGRAM_BOT_TOKEN'] = 'test-token';
      process.env['TELEGRAM_ALLOWED_USERS'] = '123,456';
      process.env['GATEWAY_PORT'] = '8080';

      const config = loadConfig();

      expect(config.telegram.botToken).toBe('test-token');
      expect(config.telegram.allowedUsers).toEqual([123, 456]);
      expect(config.gateway.port).toBe(8080);
    });

    it('should use defaults for missing values', () => {
      const config = loadConfig();

      expect(config.redis.url).toBe('redis://localhost:6379');
      expect(config.gateway.port).toBe(3000);
      expect(config.message.leaseMs).toBe(43200000);
    });

    it('should parse allowed users correctly', () => {
      process.env['TELEGRAM_ALLOWED_USERS'] = '123, 456 , 789 ';

      const config = loadConfig();

      expect(config.telegram.allowedUsers).toEqual([123, 456, 789]);
    });

    it('should handle empty allowed users', () => {
      const config = loadConfig();

      expect(config.telegram.allowedUsers).toEqual([]);
    });
  });

  describe('validateConfig', () => {
    it('should throw if bot token is missing', () => {
      const config: Config = {
        telegram: {
          botToken: '',
          allowedUsers: [123],
        },
        redis: {
          url: 'redis://localhost',
          inboxStreamKey: 'tg:inbox',
          consumerGroup: 'tg-consumer',
        },
        message: { leaseMs: 43200000 },
        gateway: { port: 3000, host: '0.0.0.0' },
        mcp: { serverName: 'tg-agent', serverVersion: '2.0.0' },
        log: { level: 'info' },
      };

      expect(() => validateConfig(config)).toThrow('TELEGRAM_BOT_TOKEN is required');
    });

    it('should throw if allowed users is empty', () => {
      const config: Config = {
        telegram: {
          botToken: 'test-token',
          allowedUsers: [],
        },
        redis: {
          url: 'redis://localhost',
          inboxStreamKey: 'tg:inbox',
          consumerGroup: 'tg-consumer',
        },
        message: { leaseMs: 43200000 },
        gateway: { port: 3000, host: '0.0.0.0' },
        mcp: { serverName: 'tg-agent', serverVersion: '2.0.0' },
        log: { level: 'info' },
      };

      expect(() => validateConfig(config)).toThrow('TELEGRAM_ALLOWED_USERS is required');
    });

    it('should pass with valid config', () => {
      const config: Config = {
        telegram: {
          botToken: 'test-token',
          allowedUsers: [123],
        },
        redis: {
          url: 'redis://localhost',
          inboxStreamKey: 'tg:inbox',
          consumerGroup: 'tg-consumer',
        },
        message: { leaseMs: 43200000 },
        gateway: { port: 3000, host: '0.0.0.0' },
        mcp: { serverName: 'tg-agent', serverVersion: '2.0.0' },
        log: { level: 'info' },
      };

      expect(() => validateConfig(config)).not.toThrow();
    });
  });
});
