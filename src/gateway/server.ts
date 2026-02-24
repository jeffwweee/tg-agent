/**
 * Express Gateway Server
 *
 * Receives Telegram webhooks and writes to inbox.
 * Supports multi-tenant routing based on bot token.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { InboxClient } from '../inbox/client.js';
import { TelegramClient } from '../telegram/client.js';
import { TmuxInjector } from './tmux-injector.js';
import { logger } from '../utils/logger.js';
import {
  loadSessionsConfig,
  getSessionConfig,
  findSessionByBotToken,
  isChatAllowed,
  isUserAllowed,
  getSessionBotToken,
  type SessionConfig,
} from '../config/sessions.js';

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

// Per-session resources
interface SessionResources {
  inbox: InboxClient;
  telegram: TelegramClient;
  tmuxInjector: TmuxInjector | null;
  config: SessionConfig;
}

// Cache for per-session clients
const sessionResources: Map<string, SessionResources> = new Map();

// Track notification status to prevent spam (key: sessionId, value: true if already notified)
const sessionNotificationSent: Map<string, boolean> = new Map();

function getSessionResources(sessionId: string): SessionResources | null {
  // Check cache
  const cached = sessionResources.get(sessionId);
  if (cached) {
    return cached;
  }

  // Get session config
  const config = getSessionConfig(sessionId);
  if (!config) {
    return null;
  }

  // Create resources
  const botToken = getSessionBotToken(sessionId);
  const inbox = new InboxClient({ sessionId });
  const telegram = new TelegramClient(botToken || undefined);

  // Create tmux injector
  const tmuxInjector = config.tmux_session
    ? new TmuxInjector({
        sessionName: config.tmux_session,
        ...(config.tmux_wake_command ? { command: config.tmux_wake_command } : {}),
      })
    : null;

  const resources: SessionResources = {
    inbox,
    telegram,
    tmuxInjector,
    config,
  };

  sessionResources.set(sessionId, resources);
  return resources;
}

// Legacy single-tenant support
function createInboxClient(): InboxClient {
  return new InboxClient();
}

export function createGateway(options?: GatewayOptions): Express {
  const app = express();

  // Load sessions config
  const sessionsConfig = loadSessionsConfig();
  const isMultiTenant = Object.keys(sessionsConfig.sessions).length > 0;

  if (isMultiTenant) {
    logger.info(`Gateway running in multi-tenant mode with ${Object.keys(sessionsConfig.sessions).length} sessions`);
  } else {
    logger.info('Gateway running in single-tenant mode (legacy)');
  }

  // Legacy single-tenant resources
  const inbox = createInboxClient();
  const telegram = new TelegramClient();

  // Tmux injector (optional, legacy)
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
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      mode: isMultiTenant ? 'multi-tenant' : 'single-tenant',
      sessions: isMultiTenant ? Object.keys(sessionsConfig.sessions) : undefined,
    });
  });

  // Internal endpoint for hooks to send messages
  app.post('/internal/send', async (req: Request, res: Response): Promise<void> => {
    try {
      const { chat_id, text, parse_mode } = req.body as {
        chat_id?: number;
        text?: string;
        parse_mode?: 'MarkdownV2' | 'HTML';
      };

      if (!chat_id || !text) {
        res.status(400).json({ error: 'chat_id and text are required' });
        return;
      }

      const sendOptions: {
        chatId: number;
        text: string;
        parseMode?: 'MarkdownV2' | 'HTML';
      } = {
        chatId: chat_id,
        text,
      };

      if (parse_mode !== undefined) {
        sendOptions.parseMode = parse_mode;
      }

      const result = await telegram.sendMessage(sendOptions);

      if (result.ok) {
        res.json({ ok: true, message_id: result.messageId });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error) {
      logger.error('Internal send error', { error: error instanceof Error ? error.message : 'Unknown' });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Session-specific webhook endpoint (recommended for multi-tenant)
  // Usage: POST /telegram/webhook/SESSION_X01
  app.post('/telegram/webhook/:sessionId', async (req: Request, res: Response): Promise<void> => {
    const requestedSessionId = req.params['sessionId'] || '';

    if (!requestedSessionId) {
      res.status(400).json({ error: 'Session ID required' });
      return;
    }

    // Verify session exists in config
    const sessionConfig = getSessionConfig(requestedSessionId);
    if (!sessionConfig) {
      logger.warn(`Unknown session in webhook URL: ${requestedSessionId}`);
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Get session resources
    const resources = getSessionResources(requestedSessionId);
    if (!resources) {
      res.status(500).json({ error: 'Failed to get session resources' });
      return;
    }

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
    const message = update.message ?? update.edited_message;

    if (!message) {
      res.json({ ok: true, processed: false });
      return;
    }

    const userId = message.from?.id;
    if (userId === undefined) {
      res.json({ ok: true, processed: false, reason: 'no_user' });
      return;
    }

    const text = message.text ?? message.caption ?? '';
    if (text.length === 0) {
      res.json({ ok: true, processed: false, reason: 'no_text' });
      return;
    }

    // Validate user allowlist
    if (sessionConfig.allowed_users.length > 0 && !sessionConfig.allowed_users.includes(userId)) {
      logger.warn(`User ${userId} not in allowlist for session ${requestedSessionId}`);
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Check if tmux session exists
    if (resources.tmuxInjector) {
      const sessionExists = await resources.tmuxInjector.sessionExists();
      if (!sessionExists) {
        logger.warn(`Tmux session not found: ${sessionConfig.tmux_session}`);

        const alreadyNotified = sessionNotificationSent.get(requestedSessionId);
        if (!alreadyNotified) {
          await resources.telegram.sendMessage({
            chatId: message.chat.id,
            text: `⚠️ Claude Code session is not available.\n\nThe tmux session "${sessionConfig.tmux_session}" does not exist. Please start the session first.`,
          });
          sessionNotificationSent.set(requestedSessionId, true);
        }

        res.status(503).json({ error: 'Session unavailable', reason: 'tmux_session_not_found' });
        return;
      } else {
        sessionNotificationSent.delete(requestedSessionId);
      }
    }

    // Add to inbox
    await resources.inbox.setupConsumerGroup();
    const inboxId = await resources.inbox.addMessage({
      chatId: message.chat.id,
      userId,
      text,
      timestamp: message.date * 1000,
      messageId: `${message.chat.id}-${message.message_id}`,
      tgMessageId: message.message_id,
    });

    logger.info(`Message added to inbox`, { inboxId, sessionId: requestedSessionId, chatId: message.chat.id, userId, textLength: text.length });

    // Send typing indicator and reaction
    resources.telegram.sendChatAction(message.chat.id, 'typing').catch((err) => {
      logger.debug('Failed to send typing indicator', { error: String(err) });
    });
    resources.telegram.setMessageReaction({ chatId: message.chat.id, messageId: message.message_id, reaction: '👀' }).catch((err) => {
      logger.debug('Failed to set reaction', { error: String(err) });
    });

    // Tmux wake-up injection
    if (resources.tmuxInjector) {
      resources.tmuxInjector.inject().then(async (result) => {
        if (!result.success) {
          logger.warn(`Tmux injection failed`, { error: result.error, sessionId: requestedSessionId });
          await resources.telegram.sendMessage({
            chatId: message.chat.id,
            text: `⚠️ Tmux wake-up failed: ${result.error}\n\nThe message was saved to inbox.`,
          });
        }
      }).catch((error) => {
        logger.error('Tmux injection error', { error: error instanceof Error ? error.message : 'Unknown' });
      });
    }

    res.json({ ok: true, processed: true, inboxId, sessionId: requestedSessionId });
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

      // Extract text
      const text = message.text ?? message.caption ?? '';
      if (text.length === 0) {
        res.json({ ok: true, processed: false, reason: 'no_text' });
        return;
      }

      // Multi-tenant routing: try to identify session by bot token
      // For now, we use a simpler approach: route by chat_id matching
      let sessionId: string | null = null;
      let resources: SessionResources | null = null;

      if (isMultiTenant) {
        // Find session that allows this chat
        for (const [id, sessionConfig] of Object.entries(sessionsConfig.sessions)) {
          if (sessionConfig.chat_ids.includes(message.chat.id)) {
            // Check user allowlist
            if (sessionConfig.allowed_users.length === 0 || sessionConfig.allowed_users.includes(userId)) {
              sessionId = id;
              resources = getSessionResources(id);
              break;
            }
          }
        }

        if (!resources) {
          logger.warn(`No session found for chat ${message.chat.id} and user ${userId}`);
          res.status(403).json({ error: 'Forbidden - no matching session' });
          return;
        }

        logger.debug(`Routing message to session: ${sessionId}`);
      }

      // Use session resources or fall back to legacy
      const activeInbox = resources?.inbox ?? inbox;
      const activeTelegram = resources?.telegram ?? telegram;
      const activeTmuxInjector = resources?.tmuxInjector ?? tmuxInjector;

      // Validate against allowlist (legacy mode)
      if (!isMultiTenant && allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
        logger.warn(`User ${userId} not in allowlist`);
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      // Check if tmux session exists before saving to inbox
      // If tmux is configured but session doesn't exist, reject the message
      if (activeTmuxInjector) {
        const sessionExists = await activeTmuxInjector.sessionExists();
        if (!sessionExists) {
          const currentSessionId = sessionId || 'default';
          logger.warn(`Tmux session not found, rejecting message`, {
            sessionId: currentSessionId,
            chatId: message.chat.id,
            tmuxSession: resources?.config.tmux_session ?? tmuxSessionName,
          });

          // Check if we already sent notification (only send once)
          const alreadyNotified = sessionNotificationSent.get(currentSessionId);

          if (!alreadyNotified) {
            // Notify user that the session is unavailable (only once)
            await activeTelegram.sendMessage({
              chatId: message.chat.id,
              text: `⚠️ Claude Code session is not available.\n\nThe tmux session "${resources?.config.tmux_session ?? tmuxSessionName}" does not exist. Please start the session first.`,
            });
            sessionNotificationSent.set(currentSessionId, true);
          }

          res.status(503).json({
            error: 'Session unavailable',
            reason: 'tmux_session_not_found',
          });
          return;
        } else {
          // Session exists - clear notification tracking so we can notify again if it goes down
          sessionNotificationSent.delete(sessionId || 'default');
        }
      }

      // Add to inbox
      await activeInbox.setupConsumerGroup(); // Ensure group exists

      const inboxId = await activeInbox.addMessage({
        chatId: message.chat.id,
        userId,
        text,
        timestamp: message.date * 1000, // Convert to milliseconds
        messageId: `${message.chat.id}-${message.message_id}`,
        tgMessageId: message.message_id,
      });

      logger.info(`Message added to inbox`, {
        inboxId,
        sessionId: sessionId || 'default',
        chatId: message.chat.id,
        userId,
        textLength: text.length,
      });

      // Send typing indicator (non-blocking)
      activeTelegram.sendChatAction(message.chat.id, 'typing').catch((err) => {
        logger.debug('Failed to send typing indicator', { error: err });
      });

      // Add 👀 reaction to show message was received (non-blocking)
      activeTelegram.setMessageReaction({
        chatId: message.chat.id,
        messageId: message.message_id,
        reaction: '👀',
      }).catch((err) => {
        logger.debug('Failed to set reaction', { error: err });
      });

      // Tmux wake-up injection (non-blocking)
      if (activeTmuxInjector) {
        activeTmuxInjector.inject().then(async (result) => {
          if (!result.success) {
            logger.warn(`Tmux injection failed, sending Telegram notification`, {
              error: result.error,
              chatId: message.chat.id,
              sessionId: sessionId || 'default',
            });

            // Send error notification to Telegram
            const errorMessage = `⚠️ Tmux wake-up failed: ${result.error}\n\nThe message was saved to inbox. Claude Code will process it on next poll.`;
            await activeTelegram.sendMessage({
              chatId: message.chat.id,
              text: errorMessage,
            });
          }
        }).catch((error) => {
          logger.error('Tmux injection error', { error: error instanceof Error ? error.message : 'Unknown' });
        });
      }

      res.json({ ok: true, processed: true, inboxId, sessionId: sessionId || 'default' });
    } catch (error) {
      logger.error('Webhook error', { error: error instanceof Error ? error.message : 'Unknown' });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Graceful shutdown helper
  app.locals['inbox'] = inbox;
  app.locals['sessionResources'] = sessionResources;

  return app;
}

export async function shutdownGateway(app: Express): Promise<void> {
  // Disconnect legacy inbox
  const inbox = app.locals['inbox'] as InboxClient | undefined;
  if (inbox !== undefined) {
    await inbox.disconnect();
  }

  // Disconnect all session inboxes
  const resources = app.locals['sessionResources'] as Map<string, SessionResources> | undefined;
  if (resources) {
    for (const [, session] of resources) {
      await session.inbox.disconnect();
    }
  }
}
