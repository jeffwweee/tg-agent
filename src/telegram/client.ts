/**
 * Telegram Bot API Client Module
 *
 * Provides functions for interacting with Telegram Bot API:
 * - Send messages
 * - Send chat actions (typing indicator)
 * - Verify user permissions
 */

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

// API client
class TelegramClient {
  private token: string;
  private baseUrl: string;

  constructor(token?: string) {
    this.token = token || process.env.TELEGRAM_BOT_TOKEN || '';
    if (!this.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  /**
   * Make API request
   */
  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: params ? JSON.stringify(params) : undefined,
    });

    const data = await response.json() as TelegramResponse<T>;

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
    }

    return data.result as T;
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
    }
  ): Promise<TelegramMessage> {
    return this.request<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
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
