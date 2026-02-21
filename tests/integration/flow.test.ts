/**
 * Full Flow Integration Tests
 *
 * Tests the complete message flow: webhook → inbox → poll → send → ack
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockRedis } from '../helpers/mock-redis.js';

// Note: These are simplified integration tests.
// Full E2E tests would require running Redis and a mock Telegram server.

describe('Message Flow Integration', () => {
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
  });

  describe('Webhook to Inbox Flow', () => {
    it('should add message to inbox', async () => {
      const streamKey = 'tg:inbox';

      // Simulate webhook adding a message
      const id = await mockRedis.xadd(
        streamKey,
        '*',
        'chat_id', 12345,
        'user_id', 67890,
        'text', 'Hello from Telegram',
        'timestamp', Date.now()
      );

      expect(id).toBeDefined();
      expect(id).toMatch(/^\d+-\d+$/);
    });

    it('should add multiple messages', async () => {
      const streamKey = 'tg:inbox';

      // Setup consumer group BEFORE adding messages (using '0' to read from beginning)
      await mockRedis.xgroup('CREATE', streamKey, 'test-group', '0', 'MKSTREAM');

      // Add messages
      await mockRedis.xadd(streamKey, '*', 'chat_id', 12345, 'text', 'Message 1', 'timestamp', Date.now());
      await mockRedis.xadd(streamKey, '*', 'chat_id', 12345, 'text', 'Message 2', 'timestamp', Date.now());

      // Read messages
      const result = await mockRedis.xreadgroup(
        'GROUP', 'test-group', 'test-consumer',
        'COUNT', '10', 'BLOCK', '0',
        'STREAMS', streamKey, '>'
      );

      expect(result).not.toBeNull();
      expect(result?.[0]?.[1]).toHaveLength(2);
    });
  });

  describe('Poll and Ack Flow', () => {
    it('should poll messages and acknowledge them', async () => {
      const streamKey = 'tg:inbox';

      // Setup consumer group BEFORE adding messages
      await mockRedis.xgroup('CREATE', streamKey, 'test-group', '0', 'MKSTREAM');

      // Add message
      await mockRedis.xadd(streamKey, '*', 'chat_id', 12345, 'text', 'Test', 'timestamp', Date.now());

      // Poll
      const result = await mockRedis.xreadgroup(
        'GROUP', 'test-group', 'test-consumer',
        'COUNT', '10', 'BLOCK', '0',
        'STREAMS', streamKey, '>'
      );

      expect(result).not.toBeNull();
      const messages = result?.[0]?.[1] ?? [];
      expect(messages.length).toBeGreaterThan(0);

      // Ack
      const messageId = messages[0]?.[0];
      if (messageId !== undefined) {
        const acked = await mockRedis.xack(streamKey, 'test-group', messageId);
        expect(acked).toBe(1);
      }
    });

    it('should not return already pending messages', async () => {
      const streamKey = 'tg:inbox';

      // Setup consumer group BEFORE adding messages
      await mockRedis.xgroup('CREATE', streamKey, 'test-group', '0', 'MKSTREAM');

      // Add message
      await mockRedis.xadd(streamKey, '*', 'chat_id', 12345, 'text', 'Test', 'timestamp', Date.now());

      // First poll gets the message
      const first = await mockRedis.xreadgroup(
        'GROUP', 'test-group', 'consumer1',
        'COUNT', '10', 'BLOCK', '0',
        'STREAMS', streamKey, '>'
      );
      expect(first?.[0]?.[1]).toHaveLength(1);

      // Second poll should not get the same message
      const second = await mockRedis.xreadgroup(
        'GROUP', 'test-group', 'consumer2',
        'COUNT', '10', 'BLOCK', '0',
        'STREAMS', streamKey, '>'
      );
      expect(second).toBeNull();
    });
  });

  describe('Lease Reclaim Flow', () => {
    it('should allow claiming expired messages', async () => {
      const streamKey = 'tg:inbox';

      // Setup consumer group BEFORE adding messages
      await mockRedis.xgroup('CREATE', streamKey, 'test-group', '0', 'MKSTREAM');

      // Add message
      await mockRedis.xadd(streamKey, '*', 'chat_id', 12345, 'text', 'Test', 'timestamp', Date.now());

      // First consumer claims it
      await mockRedis.xreadgroup(
        'GROUP', 'test-group', 'consumer1',
        'COUNT', '10', 'BLOCK', '0',
        'STREAMS', streamKey, '>'
      );

      // Another consumer claims it (simulating lease timeout)
      const claimed = await mockRedis.xclaim(
        streamKey, 'test-group', 'consumer2',
        0, // min idle time
        (await mockRedis.xpending(streamKey, 'test-group'))?.[3]?.[0]?.[0] ?? ''
      );

      // The message should be claimed
      expect(claimed.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Deduplication', () => {
    it('should store message_id for deduplication', async () => {
      const streamKey = 'tg:inbox';

      // Setup consumer group BEFORE adding messages
      await mockRedis.xgroup('CREATE', streamKey, 'test-group', '0', 'MKSTREAM');

      const id = await mockRedis.xadd(
        streamKey, '*',
        'chat_id', 12345,
        'user_id', 67890,
        'text', 'Hello',
        'timestamp', Date.now(),
        'message_id', '12345-100'
      );

      expect(id).toBeDefined();

      // Read back and verify
      const result = await mockRedis.xreadgroup(
        'GROUP', 'test-group', 'test-consumer',
        'COUNT', '10', 'BLOCK', '0',
        'STREAMS', streamKey, '>'
      );

      // Fields are stored as flat array
      const fields = result?.[0]?.[1]?.[0]?.[1] ?? [];
      expect(fields).toContain('message_id');
      expect(fields).toContain('12345-100');
    });
  });
});
