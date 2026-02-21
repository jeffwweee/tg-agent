/**
 * Express Gateway Server
 *
 * Receives Telegram webhooks and writes to inbox.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { InboxClient } from '../inbox/client.js';
import { TelegramClient } from '../telegram/client.js';
import { TmuxInjector } from './tmux-injector.js';
import { logger } from '../utils/logger.js';

export interface GatewayOptions {
  port?: number;
  host?: string;
  allowedUsers?: number[];
  webhookSecret?: string;
  tmuxSessionName?: string;
  tmuxWakeUpCommand?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
    caption?: string;
  };
  edited_message?: TelegramUpdate['message'];
  callback_query?: {
    id: string;
    from: NonNullable<TelegramUpdate['message']>['from'];
    message?: TelegramUpdate['message'];
    data?: string;
  };
}

function createInboxClient(): InboxClient {
  return new InboxClient();
}

export function createGateway(options?: GatewayOptions): Express {
  const app = express();
  const inbox = createInboxClient();
  const telegram = new TelegramClient();

  // Tmux injector (optional)
  const tmuxSessionName = options?.tmuxSessionName ?? process.env['TMUX_SESSION_NAME'];
  const tmuxWakeUpCommand = options?.tmuxWakeUpCommand ?? process.env['TMUX_WAKEUP_COMMAND'];
  const tmuxInjector = tmuxSessionName
    ? new TmuxInjector({
        sessionName: tmuxSessionName,
        ...(tmuxWakeUpCommand ? { command: tmuxWakeUpCommand } : {}),
      })
    : null;

  const allowedUsers = options?.allowedUsers ??
    (process.env['TELEGRAM_ALLOWED_USERS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Number(s))
      .filter((n) => !Number.isNaN(n));

  const webhookSecret = options?.webhookSecret ?? process.env['TELEGRAM_WEBHOOK_SECRET'];

  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Webhook endpoint
  app.post('/telegram/webhook', async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate webhook secret if configured
      if (webhookSecret !== undefined) {
        const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
        if (headerSecret !== webhookSecret) {
          logger.warn('Invalid webhook secret');
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }

      const update = req.body as TelegramUpdate;

      // Extract message
      const message = update.message ?? update.edited_message;
      if (!message) {
        // Not a message update (could be callback_query, etc.)
        res.json({ ok: true, processed: false });
        return;
      }

      // Extract user ID
      const userId = message.from?.id;
      if (userId === undefined) {
        res.json({ ok: true, processed: false, reason: 'no_user' });
        return;
      }

      // Validate against allowlist
      if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
        logger.warn(`User ${userId} not in allowlist`);
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      // Extract text
      const text = message.text ?? message.caption ?? '';
      if (text.length === 0) {
        res.json({ ok: true, processed: false, reason: 'no_text' });
        return;
      }

      // Add to inbox
      await inbox.setupConsumerGroup(); // Ensure group exists

      const inboxId = await inbox.addMessage({
        chatId: message.chat.id,
        userId,
        text,
        timestamp: message.date * 1000, // Convert to milliseconds
        messageId: `${message.chat.id}-${message.message_id}`,
      });

      logger.info(`Message added to inbox`, {
        inboxId,
        chatId: message.chat.id,
        userId,
        textLength: text.length,
      });

      // Tmux wake-up injection (non-blocking)
      if (tmuxInjector) {
        tmuxInjector.inject().then(async (result) => {
          if (!result.success) {
            logger.warn(`Tmux injection failed, sending Telegram notification`, {
              error: result.error,
              chatId: message.chat.id,
            });

            // Send error notification to Telegram
            const errorMessage = `⚠️ Tmux wake-up failed: ${result.error}\n\nThe message was saved to inbox. Claude Code will process it on next poll.`;
            await telegram.sendMessage({
              chatId: message.chat.id,
              text: errorMessage,
            });
          }
        }).catch((error) => {
          logger.error('Tmux injection error', { error: error instanceof Error ? error.message : 'Unknown' });
        });
      }

      res.json({ ok: true, processed: true, inboxId });
    } catch (error) {
      logger.error('Webhook error', { error: error instanceof Error ? error.message : 'Unknown' });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Graceful shutdown helper
  app.locals['inbox'] = inbox;

  return app;
}

export async function shutdownGateway(app: Express): Promise<void> {
  const inbox = app.locals['inbox'] as InboxClient | undefined;
  if (inbox !== undefined) {
    await inbox.disconnect();
  }
}
