/**
 * Telegram Client Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TelegramClient } from '../../src/telegram/client.js';
import { createMockTelegramServer, type MockTelegramServer } from '../helpers/mock-telegram.js';

describe('TelegramClient Integration', () => {
  let mockServer: MockTelegramServer;
  let client: TelegramClient;

  beforeAll(async () => {
    mockServer = createMockTelegramServer();
    await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  beforeEach(() => {
    mockServer.clear();
    mockServer.setSuccess(true);
    client = new TelegramClient({
      botToken: 'test-token',
      apiUrl: `http://localhost:${mockServer.port}`,
    });
  });

  describe('sendMessage', () => {
    it('should send a message successfully', async () => {
      const result = await client.sendMessage({
        chatId: 12345,
        text: 'Hello, world!',
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(mockServer.messages).toHaveLength(1);
    });

    it('should include parse mode', async () => {
      await client.sendMessage({
        chatId: 12345,
        text: '*bold*',
        parseMode: 'MarkdownV2',
      });

      expect(mockServer.messages[0]?.parse_mode).toBe('MarkdownV2');
    });

    it('should handle API errors', async () => {
      mockServer.setSuccess(false);

      const result = await client.sendMessage({
        chatId: 12345,
        text: 'Hello',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should send multiple messages', async () => {
      await client.sendMessage({ chatId: 12345, text: 'Message 1' });
      await client.sendMessage({ chatId: 12345, text: 'Message 2' });

      expect(mockServer.messages).toHaveLength(2);
    });
  });

  describe('sendChatAction', () => {
    it('should send typing action', async () => {
      const result = await client.sendChatAction(12345, 'typing');

      expect(result).toBe(true);
    });

    it('should handle errors', async () => {
      mockServer.setSuccess(false);

      const result = await client.sendChatAction(12345, 'typing');

      expect(result).toBe(false);
    });
  });
});
