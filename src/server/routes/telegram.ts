/**
 * Telegram Webhook Route Handler
 *
 * Handles incoming Telegram updates and routes them to appropriate handlers.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import {
  TelegramUpdate,
  TelegramMessage,
  getTelegramClient,
  verifyUser,
} from '../../telegram/client.js';
import { saveChatId, savePending, getPending, clearPending } from '../../state/files.js';
import {
  injectPrompt,
  sendEscape,
  clearScreen,
  getSessionInfo,
  sessionExists,
} from '../../tmux/inject.js';

// Command prefix
const COMMAND_PREFIX = '/';

// Define command handlers
type CommandHandler = (
  message: TelegramMessage,
  reply: (text: string) => Promise<void>
) => Promise<void>;

const commands: Record<string, CommandHandler> = {
  start: async (message, reply) => {
    const name = message.from?.first_name || 'there';
    await reply(`Hello ${name}! I'm your Claude Code bridge.\n\nSend me a message and I'll pass it to Claude. Use /help for commands.`);
  },

  help: async (_message, reply) => {
    await reply(`*Claude Code Bridge Commands*\n\n` +
      `Just send a message to pass it to Claude.\n\n` +
      `*Commands:*\n` +
      `/clear - Clear Claude's screen\n` +
      `/stop - Cancel current operation\n` +
      `/status - Check bridge status\n` +
      `/help - Show this help`);
  },

  clear: async (_message, reply) => {
    if (!(await sessionExists())) {
      await reply('⚠️ tmux session not running');
      return;
    }
    await clearScreen();
    await reply('✅ Screen cleared');
  },

  stop: async (_message, reply) => {
    if (!(await sessionExists())) {
      await reply('⚠️ tmux session not running');
      return;
    }
    await sendEscape();
    await clearPending();
    await reply('⏹️ Stopped');
  },

  status: async (_message, reply) => {
    const sessionInfo = await getSessionInfo();
    const pending = await getPending();

    let status = '*Bridge Status*\n\n';
    status += `tmux: ${sessionInfo.exists ? '✅ Running' : '❌ Not found'}\n`;
    status += `Session: ${sessionInfo.name}\n`;

    if (sessionInfo.windows) {
      status += `Windows: ${sessionInfo.windows}\n`;
    }

    status += `\nPending: ${pending ? '✅ Yes' : '⚪ No'}`;

    if (pending) {
      const age = Math.round((Date.now() - pending.timestamp) / 1000);
      status += ` (${age}s ago)`;
    }

    await reply(status);
  },
};

/**
 * Send a reply message
 */
async function sendReply(chatId: number, text: string): Promise<void> {
  const client = getTelegramClient();
  await client.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

/**
 * Handle incoming Telegram update
 */
export async function handleWebhook(
  request: FastifyRequest<{ Body: TelegramUpdate }>,
  reply: FastifyReply
): Promise<void> {
  const update = request.body;
  const log = request.log;

  // Log update receipt
  log.info({ update_id: update.update_id }, 'Received Telegram update');

  // Extract message
  const message = update.message || update.edited_message;
  if (!message) {
    log.debug('No message in update, ignoring');
    reply.code(200).send({ ok: true });
    return;
  }

  const { chat, from, text, message_id } = message;

  // Verify user
  if (from) {
    const verification = verifyUser(from);
    if (!verification.allowed) {
      log.warn({ user_id: from.id }, verification.error);
      reply.code(200).send({ ok: true });
      return;
    }
  }

  // Save chat ID for responses
  await saveChatId(chat.id);

  // Handle commands
  if (text && text.startsWith(COMMAND_PREFIX)) {
    const parts = text.slice(1).split(/\s+/);
    const cmd = parts[0];
    const command = cmd.toLowerCase();

    // Route to command handler
    const handler = commands[command];
    if (handler) {
      try {
        await handler(message, (response) => sendReply(chat.id, response));
      } catch (err) {
        log.error({ err, command }, 'Command handler error');
        await sendReply(chat.id, '❌ Command failed');
      }
    } else {
      await sendReply(chat.id, `Unknown command: /${command}\nUse /help for available commands`);
    }

    reply.code(200).send({ ok: true });
    return;
  }

  // Handle regular message
  if (text) {
    try {
      // Check tmux session
      if (!(await sessionExists())) {
        await sendReply(chat.id, '⚠️ Claude session not running. Start tmux with Claude first.');
        reply.code(200).send({ ok: true });
        return;
      }

      // Send typing indicator
      const client = getTelegramClient();
      await client.sendChatAction(chat.id, 'typing');

      // Save pending state
      await savePending({
        chatId: chat.id,
        userId: from?.id || 0,
        messageId: message_id,
        timestamp: Date.now(),
        text,
      });

      // Inject prompt to Claude
      await injectPrompt(text);

      // Acknowledge receipt
      await client.setMessageReaction(chat.id, message_id, '✍');

      log.info({ text: text.slice(0, 50) }, 'Message injected to Claude');
    } catch (err) {
      log.error({ err }, 'Failed to process message');
      await sendReply(chat.id, '❌ Failed to send message to Claude');
    }
  }

  reply.code(200).send({ ok: true });
}

/**
 * Register webhook route
 */
export async function registerTelegramRoutes(fastify: import('fastify').FastifyInstance): Promise<void> {
  fastify.post('/telegram/webhook', handleWebhook);

  // Webhook info endpoint (for debugging)
  fastify.get('/telegram/webhook', async (request, reply) => {
    try {
      const client = getTelegramClient();
      const info = await client.getWebhookInfo();
      return info;
    } catch (err) {
      request.log.error(err, 'Failed to get webhook info');
      return reply.code(500).send({ error: 'Failed to get webhook info' });
    }
  });
}
