/**
 * Telegram Bot API Client Module
 *
 * Provides functions for interacting with Telegram Bot API:
 * - Send messages
 * - Send chat actions (typing indicator)
 * - Verify user permissions
 * - Retry logic with exponential backoff
 * - Request timeout handling
 */

import { withRetry, isRetryableError } from '../utils/retry.js';

// Telegram Bot API types
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  date: number;
  chat: TelegramChat;
  text?: string;
  entities?: TelegramEntity[];
}

export interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

export interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

// Client configuration
interface ClientConfig {
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

const DEFAULT_CONFIG: ClientConfig = {
  timeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 1000,
};

// API client
class TelegramClient {
  private token: string;
  private baseUrl: string;
  private config: ClientConfig;

  constructor(token?: string, config?: Partial<ClientConfig>) {
    this.token = token || process.env.TELEGRAM_BOT_TOKEN || '';
    if (!this.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Make API request with retry and timeout
   */
  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}`;

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: params ? JSON.stringify(params) : undefined,
            signal: controller.signal,
          });

          const data = (await response.json()) as TelegramResponse<T>;

          if (!data.ok) {
            const error = new Error(
              `Telegram API error: ${data.error_code} - ${data.description || 'Unknown error'}`
            );
            (error as Error & { code?: number }).code = data.error_code;
            throw error;
          }

          return data.result as T;
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            throw new Error(`Request timed out after ${this.config.timeoutMs}ms`);
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        maxRetries: this.config.maxRetries,
        initialDelayMs: this.config.retryDelayMs,
        retryOn: isRetryableError,
        onRetry: (attempt, error, delayMs) => {
          console.error(`Telegram API retry ${attempt}/${this.config.maxRetries} after ${delayMs}ms: ${error.message}`);
        },
      }
    );
  }

  /**
   * Send a text message
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options?: {
      parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
      disable_notification?: boolean;
      reply_to_message_id?: number;
      reply_markup?: InlineKeyboardMarkup;
    }
  ): Promise<TelegramMessage> {
    return this.request<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      ...options,
    });
  }

  /**
   * Edit a message text
   */
  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    options?: {
      parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
      reply_markup?: InlineKeyboardMarkup;
    }
  ): Promise<TelegramMessage | boolean> {
    return this.request<TelegramMessage | boolean>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    });
  }

  /**
   * Answer a callback query
   */
  async answerCallbackQuery(
    callbackQueryId: string,
    options?: {
      text?: string;
      show_alert?: boolean;
      cache_time?: number;
    }
  ): Promise<boolean> {
    return this.request<boolean>('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...options,
    });
  }

  /**
   * Send chat action (typing, upload_photo, etc.)
   */
  async sendChatAction(
    chatId: number | string,
    action: 'typing' | 'upload_photo' | 'record_video' | 'upload_video' | 'record_voice' | 'upload_voice' | 'upload_document' | 'choose_sticker' | 'find_location' | 'record_video_note' | 'upload_video_note'
  ): Promise<boolean> {
    return this.request<boolean>('sendChatAction', {
      chat_id: chatId,
      action,
    });
  }

  /**
   * Set a reaction on a message
   */
  async setMessageReaction(
    chatId: number | string,
    messageId: number,
    reaction: string
  ): Promise<boolean> {
    return this.request<boolean>('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: 'emoji', emoji: reaction }],
    });
  }

  /**
   * Get bot info
   */
  async getMe(): Promise<TelegramUser> {
    return this.request<TelegramUser>('getMe');
  }

  /**
   * Set webhook URL
   */
  async setWebhook(url: string, options?: { secret_token?: string }): Promise<boolean> {
    return this.request<boolean>('setWebhook', {
      url,
      ...options,
    });
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(): Promise<boolean> {
    return this.request<boolean>('deleteWebhook');
  }

  /**
   * Get webhook info
   */
  async getWebhookInfo(): Promise<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
  }> {
    return this.request('getWebhookInfo');
  }
}

// Singleton instance
let clientInstance: TelegramClient | null = null;

/**
 * Get Telegram client instance
 */
export function getTelegramClient(): TelegramClient {
  if (!clientInstance) {
    clientInstance = new TelegramClient();
  }
  return clientInstance;
}

/**
 * Reset client (for testing)
 */
export function resetTelegramClient(): void {
  clientInstance = null;
}

// === User Verification ===

/**
 * Get allowed user IDs from environment
 */
export function getAllowedUsers(): number[] {
  const usersStr = process.env.TELEGRAM_ALLOWED_USERS || '';
  return usersStr
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));
}

/**
 * Check if a user is allowed to use the bot
 */
export function isUserAllowed(userId: number): boolean {
  const allowed = getAllowedUsers();
  // If no allowed users configured, allow all (dev mode)
  if (allowed.length === 0) {
    return true;
  }
  return allowed.includes(userId);
}

/**
 * Verify user and return error message if not allowed
 */
export function verifyUser(user: TelegramUser): { allowed: boolean; error?: string } {
  if (!isUserAllowed(user.id)) {
    return {
      allowed: false,
      error: `User ${user.id} (${user.first_name}) is not authorized`,
    };
  }
  return { allowed: true };
}

// Re-export types
export { TelegramClient };
