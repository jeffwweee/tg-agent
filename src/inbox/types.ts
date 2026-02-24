/**
 * Inbox Types
 */

export interface InboxMessage {
  /** Redis stream entry ID */
  id: string;
  /** Telegram chat ID */
  chatId: number;
  /** Telegram user ID */
  userId: number;
  /** Message text */
  text: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Original Telegram message ID (for deduplication) */
  messageId?: string;
  /** Telegram message ID (for reactions) */
  tgMessageId?: number;
  /** Combined context from multiple messages (if applicable) */
  combinedContext?: string;
}

export interface InboxClientOptions {
  /** Redis connection URL */
  redisUrl?: string;
  /** Redis stream key for inbox */
  streamKey?: string;
  /** Consumer group name */
  consumerGroup?: string;
  /** Message lease duration in milliseconds */
  leaseMs?: number;
}
