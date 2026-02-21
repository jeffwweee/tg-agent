/**
 * Telegram Bot API Client
 *
 * Handles sending messages and chat actions with retry logic.
 */

export interface TelegramClientOptions {
  botToken?: string;
  apiUrl?: string;
  maxRetries?: number;
  retryDelay?: number;
}

export interface SendMessageOptions {
  chatId: number;
  text: string;
  parseMode?: 'MarkdownV2' | 'HTML';
  disableNotification?: boolean;
}

export interface SendMessageResult {
  ok: boolean;
  messageId?: number;
  chatId?: number;
  error?: string;
  chunksSent?: number;
}

export type ChatActionType =
  | 'typing'
  | 'upload_photo'
  | 'record_video'
  | 'upload_video'
  | 'record_voice'
  | 'upload_voice'
  | 'upload_document'
  | 'find_location'
  | 'record_video_note'
  | 'upload_video_note'
  | 'choose_sticker';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

export class TelegramClient {
  private botToken: string;
  private apiUrl: string;
  private maxRetries: number;
  private retryDelay: number;

  constructor(options?: TelegramClientOptions) {
    this.botToken = options?.botToken ?? process.env['TELEGRAM_BOT_TOKEN'] ?? '';
    this.apiUrl = options?.apiUrl ?? `https://api.telegram.org/bot${this.botToken}`;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelay = options?.retryDelay ?? DEFAULT_RETRY_DELAY;
  }

  /**
   * Send a message to a Telegram chat
   */
  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    const body: Record<string, unknown> = {
      chat_id: options.chatId,
      text: options.text,
    };

    if (options.parseMode !== undefined) {
      body['parse_mode'] = options.parseMode;
    }

    if (options.disableNotification === true) {
      body['disable_notification'] = true;
    }

    return this.request('sendMessage', body);
  }

  /**
   * Send a chat action (e.g., typing indicator)
   */
  async sendChatAction(chatId: number, action: ChatActionType): Promise<boolean> {
    const result = await this.request('sendChatAction', {
      chat_id: chatId,
      action,
    });

    return result.ok;
  }

  /**
   * Get bot information
   */
  async getMe(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    return this.request('getMe', {});
  }

  /**
   * Set webhook URL
   */
  async setWebhook(url: string, secret?: string): Promise<{ ok: boolean; error?: string }> {
    const body: Record<string, unknown> = { url };

    if (secret !== undefined) {
      body['secret_token'] = secret;
    }

    return this.request('setWebhook', body);
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(): Promise<{ ok: boolean; error?: string }> {
    return this.request('deleteWebhook', {});
  }

  /**
   * Make a request to the Telegram API with retry logic
   */
  private async request(
    method: string,
    body: Record<string, unknown>
  ): Promise<SendMessageResult & { result?: unknown }> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.apiUrl}/${method}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        const data = (await response.json()) as {
          ok: boolean;
          result?: { message_id?: number; chat?: { id?: number } };
          description?: string;
        };

        if (data.ok) {
          const result: SendMessageResult & { result?: unknown } = { ok: true };

          if (data.result?.message_id !== undefined) {
            result.messageId = data.result.message_id;
          }
          if (data.result?.chat?.id !== undefined) {
            result.chatId = data.result.chat.id;
          }
          result.result = data.result;

          return result;
        }

        // Non-retryable errors
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          return {
            ok: false,
            error: data.description ?? `HTTP ${response.status}`,
          };
        }

        lastError = data.description ?? `HTTP ${response.status}`;

        // Rate limiting - wait longer
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter !== null ? Number(retryAfter) * 1000 : this.retryDelay * 2;
          await this.sleep(delay);
          continue;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
      }

      // Wait before retry
      if (attempt < this.maxRetries - 1) {
        await this.sleep(this.retryDelay * (attempt + 1));
      }
    }

    return {
      ok: false,
      error: lastError ?? 'Max retries exceeded',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
