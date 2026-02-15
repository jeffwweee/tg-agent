import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TelegramClient,
  verifyUser,
  isUserAllowed,
  getAllowedUsers,
  resetTelegramClient,
} from './client.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock environment
const originalEnv = process.env;

describe('Telegram Client', () => {
  let client: TelegramClient;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    process.env = { ...originalEnv, TELEGRAM_BOT_TOKEN: 'test-token' };
    client = new TelegramClient('test-token', {
      timeoutMs: 5000,
      maxRetries: 2,
      retryDelayMs: 100,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
    resetTelegramClient();
  });

  describe('constructor', () => {
    it('should throw if no token provided', () => {
      process.env.TELEGRAM_BOT_TOKEN = '';
      expect(() => new TelegramClient()).toThrow('TELEGRAM_BOT_TOKEN is required');
    });

    it('should use token from environment', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'env-token';
      const envClient = new TelegramClient();
      expect(envClient).toBeDefined();
    });
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          result: { message_id: 1, chat: { id: 123 }, date: 1234567890 },
        }),
      });

      const result = client.sendMessage(123, 'Hello');

      await vi.runAllTimersAsync();
      await expect(result).resolves.toEqual(
        expect.objectContaining({ message_id: 1 })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token/sendMessage',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"chat_id":123'),
        })
      );
    });

    it('should include options in request', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          result: { message_id: 1, chat: { id: 123 }, date: 1234567890 },
        }),
      });

      const result = client.sendMessage(123, 'Hello', {
        parse_mode: 'MarkdownV2',
      });

      await vi.runAllTimersAsync();
      await expect(result).resolves.toBeDefined();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"parse_mode":"MarkdownV2"'),
        })
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: false,
          error_code: 400,
          description: 'Bad Request',
        }),
      });

      const result = client.sendMessage(123, 'Hello');

      await vi.runAllTimersAsync();

      try {
        await result;
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('Telegram API error');
      }
    });
  });

  describe('sendChatAction', () => {
    it('should send typing action', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, result: true }),
      });

      const result = client.sendChatAction(123, 'typing');

      await vi.runAllTimersAsync();
      await expect(result).resolves.toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"action":"typing"'),
        })
      );
    });
  });

  describe('timeout handling', () => {
    it('should timeout long requests', async () => {
      // Create a mock that never resolves but can be aborted
      mockFetch.mockImplementation(
        (_url: string, options: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            if (signal) {
              signal.addEventListener('abort', () => {
                const error = new Error('The operation was aborted');
                error.name = 'AbortError';
                reject(error);
              });
            }
          });
        }
      );

      const result = client.sendMessage(123, 'Hello');

      await vi.runAllTimersAsync();

      try {
        await result;
        expect.fail('Should have thrown');
      } catch (e) {
        // Either timeout error or abort error is acceptable
        const message = (e as Error).message;
        expect(message).toMatch(/timed out|aborted/i);
      }
    });
  });
});

describe('User Verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getAllowedUsers', () => {
    it('should parse comma-separated user IDs', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '123,456,789';
      expect(getAllowedUsers()).toEqual([123, 456, 789]);
    });

    it('should handle empty string', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '';
      expect(getAllowedUsers()).toEqual([]);
    });

    it('should filter invalid IDs', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '123,invalid,456';
      expect(getAllowedUsers()).toEqual([123, 456]);
    });
  });

  describe('isUserAllowed', () => {
    it('should allow all users when no allowed list configured', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '';
      expect(isUserAllowed(999)).toBe(true);
    });

    it('should allow users in the list', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '123,456';
      expect(isUserAllowed(123)).toBe(true);
      expect(isUserAllowed(456)).toBe(true);
    });

    it('should deny users not in the list', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '123,456';
      expect(isUserAllowed(999)).toBe(false);
    });
  });

  describe('verifyUser', () => {
    it('should return allowed for authorized users', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '123';
      const user = { id: 123, is_bot: false, first_name: 'Test' };
      expect(verifyUser(user)).toEqual({ allowed: true });
    });

    it('should return error for unauthorized users', () => {
      process.env.TELEGRAM_ALLOWED_USERS = '123';
      const user = { id: 999, is_bot: false, first_name: 'Test' };
      const result = verifyUser(user);
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('not authorized');
    });
  });
});
