/**
 * Redis Streams Inbox Client
 *
 * Manages message inbox with consumer groups and lease-based claiming.
 * Supports session-aware namespacing for multi-tenant deployments.
 */

import Redis from 'ioredis';
import type { InboxMessage, InboxClientOptions } from './types.js';
import { getSessionId } from '../config/sessions.js';

const DEFAULT_LEASE_MS = 12 * 60 * 60 * 1000; // 12 hours

export class InboxClient {
  private redis: Redis;
  private streamKey: string;
  private consumerGroup: string;
  private consumerName: string;
  private leaseMs: number;
  private sessionId: string;

  constructor(options?: InboxClientOptions & { sessionId?: string }) {
    this.redis = new Redis(options?.redisUrl ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379');
    this.sessionId = options?.sessionId ?? getSessionId();

    // Use session-aware stream key: tg:inbox:{session_id}
    // Falls back to legacy key if sessionId is 'default' and no multi-session config
    const baseKey = options?.streamKey ?? process.env['INBOX_STREAM_KEY'] ?? 'tg:inbox';
    this.streamKey = this.sessionId !== 'default'
      ? `${baseKey}:${this.sessionId}`
      : baseKey;

    this.consumerGroup = options?.consumerGroup ?? process.env['INBOX_CONSUMER_GROUP'] ?? 'tg-consumer';
    // Use consistent consumer name per session (not timestamp-based)
    this.consumerName = `consumer-${this.sessionId}`;
    this.leaseMs = options?.leaseMs ?? Number(process.env['MESSAGE_LEASE_MS'] ?? String(DEFAULT_LEASE_MS));
  }

  /**
   * Setup consumer group (idempotent - safe to call multiple times)
   */
  async setupConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.streamKey, this.consumerGroup, '$', 'MKSTREAM');
    } catch (error) {
      if (error instanceof Error && error.message.includes('BUSYGROUP')) {
        // Consumer group already exists, that's fine
        return;
      }
      throw error;
    }
  }

  /**
   * Add a message to the inbox with deduplication
   * Uses message_id field for deduplication within a 24h window
   */
  async addMessage(message: Omit<InboxMessage, 'id'> & { tgMessageId?: number }): Promise<string> {
    const messageId = message.messageId ?? `${message.chatId}-${message.timestamp}`;

    // Build flat array for xadd
    const args: (string | number)[] = [
      'chat_id', message.chatId,
      'user_id', message.userId,
      'text', message.text,
      'timestamp', message.timestamp,
      'message_id', messageId,
    ];

    if (message.tgMessageId !== undefined) {
      args.push('tg_message_id', message.tgMessageId);
    }

    if (message.combinedContext !== undefined) {
      args.push('combined_context', message.combinedContext);
    }

    // XADD with * for auto-generated ID
    const result = await this.redis.xadd(this.streamKey, '*', ...args);

    if (result === null) {
      throw new Error('Failed to add message to inbox');
    }

    return result;
  }

  /**
   * Get messages from the inbox using consumer group
   * Implements long-polling and lease-based claiming
   */
  async getMessages(count: number = 10, timeout: number = 5000): Promise<InboxMessage[]> {
    // First, try to claim any expired messages (lease reclaim)
    await this.reclaimExpiredMessages();

    // Read from consumer group with long-polling
    const result = await this.redis.xreadgroup(
      'GROUP', this.consumerGroup, this.consumerName,
      'COUNT', String(count),
      'BLOCK', String(timeout),
      'STREAMS', this.streamKey, '>'
    );

    if (!result || result.length === 0) {
      return [];
    }

    const messages: InboxMessage[] = [];

    // Result format: [[streamKey, [[id, [field1, value1, ...]], ...]], ...]
    for (const streamResult of result) {
      if (!Array.isArray(streamResult) || streamResult.length < 2) {
        continue;
      }

      const entries = streamResult[1];
      if (!Array.isArray(entries)) {
        continue;
      }

      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length < 2) {
          continue;
        }

        const [id, fields] = entry;
        if (typeof id === 'string' && Array.isArray(fields)) {
          const message = this.parseMessage(id, fields as string[]);
          if (message) {
            messages.push(message);
          }
        }
      }
    }

    return messages;
  }

  /**
   * Acknowledge processed messages
   */
  async ackMessages(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    // XACK accepts multiple IDs
    const result = await this.redis.xack(this.streamKey, this.consumerGroup, ...ids);
    return typeof result === 'number' ? result : 0;
  }

  /**
   * Claim expired messages whose lease has passed
   * This enables recovery from consumer crashes
   */
  private async reclaimExpiredMessages(): Promise<void> {
    const minIdleTime = this.leaseMs;

    // XPENDING to find pending messages with idle time > lease
    const pending = await this.redis.xpending(
      this.streamKey,
      this.consumerGroup,
      'IDLE',
      minIdleTime,
      '+',
      '-',
      10
    );

    if (!pending || !Array.isArray(pending) || pending.length === 0) {
      return;
    }

    // Collect IDs to claim
    const idsToClaim: string[] = [];

    for (const item of pending) {
      if (Array.isArray(item) && item.length > 0) {
        const id = item[0];
        if (typeof id === 'string') {
          idsToClaim.push(id);
        } else if (Buffer.isBuffer(id)) {
          idsToClaim.push(id.toString());
        }
      }
    }

    if (idsToClaim.length > 0) {
      await this.redis.xclaim(
        this.streamKey,
        this.consumerGroup,
        this.consumerName,
        minIdleTime,
        ...idsToClaim
      );
    }
  }

  /**
   * Parse a Redis stream entry into an InboxMessage
   */
  private parseMessage(id: string, fields: string[]): InboxMessage | null {
    try {
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        const value = fields[i + 1];
        if (key !== undefined && value !== undefined) {
          data[key] = value;
        }
      }

      const chatId = Number(data['chat_id']);
      const userId = Number(data['user_id']);
      const timestamp = Number(data['timestamp']);

      if (Number.isNaN(chatId) || Number.isNaN(userId)) {
        return null;
      }

      const msg: InboxMessage = {
        id,
        chatId,
        userId,
        text: data['text'] ?? '',
        timestamp,
      };

      // Only add optional properties if they exist
      if (data['message_id']) {
        msg.messageId = data['message_id'];
      }
      if (data['tg_message_id']) {
        const tgMsgId = Number(data['tg_message_id']);
        if (!Number.isNaN(tgMsgId)) {
          msg.tgMessageId = tgMsgId;
        }
      }
      if (data['combined_context']) {
        msg.combinedContext = data['combined_context'];
      }

      return msg;
    } catch {
      return null;
    }
  }

  /**
   * Get pending message count for monitoring
   */
  async getPendingCount(): Promise<number> {
    const pending = await this.redis.xpending(this.streamKey, this.consumerGroup);
    if (typeof pending === 'number') {
      return pending;
    }
    if (Array.isArray(pending) && typeof pending[0] === 'number') {
      return pending[0];
    }
    return 0;
  }

  /**
   * Get messages by their Redis stream IDs
   * Used by telegram_reply to get specific messages for acking
   */
  async getMessagesByIds(ids: string[]): Promise<InboxMessage[]> {
    if (ids.length === 0) {
      return [];
    }

    // Use XRANGE to fetch specific messages
    const messages: InboxMessage[] = [];

    for (const id of ids) {
      const result = await this.redis.xrange(this.streamKey, id, id);
      if (result && result.length > 0) {
        const entry = result[0];
        if (entry && Array.isArray(entry) && entry.length >= 2) {
          const fields = entry[1];
          if (Array.isArray(fields)) {
            const message = this.parseMessage(id, fields as string[]);
            if (message) {
              messages.push(message);
            }
          }
        }
      }
    }

    return messages;
  }

  /**
   * Get the session ID for this client
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the stream key for this client
   */
  getStreamKey(): string {
    return this.streamKey;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
