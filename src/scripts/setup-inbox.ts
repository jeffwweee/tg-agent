/**
 * Setup Inbox Script
 *
 * One-time setup to create the Redis Streams consumer group.
 */

import { config } from 'dotenv';
config();

import Redis from 'ioredis';

async function setupInbox(): Promise<void> {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const streamKey = process.env['INBOX_STREAM_KEY'] ?? 'tg:inbox';
  const consumerGroup = process.env['INBOX_CONSUMER_GROUP'] ?? 'tg-consumer';

  const redis = new Redis(redisUrl);

  try {
    // Create consumer group (fails if already exists, which is fine)
    await redis.xgroup('CREATE', streamKey, consumerGroup, '$', 'MKSTREAM');
    console.log(`Created consumer group "${consumerGroup}" for stream "${streamKey}"`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('BUSYGROUP')) {
      console.log(`Consumer group "${consumerGroup}" already exists`);
    } else {
      throw error;
    }
  } finally {
    await redis.quit();
  }
}

setupInbox().catch((error) => {
  console.error('Failed to setup inbox:', error);
  process.exit(1);
});
