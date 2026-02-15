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
import { savePhoto, getLargestPhoto, formatPhotoMessageForClaude } from '../../telegram/photo.js';
import {
  getPermissionRequest,
  updatePermissionRequest,
  formatToolInputForDisplay,
} from '../../state/permission.js';
import { startTypingIndicator, stopAllTypingIndicators } from '../../telegram/typing-indicator.js';
import {
  injectPrompt,
  sendEscape,
  clearScreen,
  getSessionInfo,
  sessionExists,
  sendKeys,
  sendKey,
} from '../../tmux/inject.js';

// Default workspace path
const DEFAULT_WORKSPACE = process.env.DEFAULT_WORKSPACE || process.env.HOME + '/jef/projects/dev-workspace';

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
      `/reset - Clear context and return to workspace\n` +
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

  reset: async (_message, reply) => {
    if (!(await sessionExists())) {
      await reply('⚠️ tmux session not running');
      return;
    }

    // Stop any active typing indicators
    stopAllTypingIndicators();

    // Clear pending state
    await clearPending();

    // Cancel any current operation
    await sendEscape();

    // Delay to ensure escape is processed and CLI is ready
    await new Promise(resolve => setTimeout(resolve, 300));

    // Send /reset command directly to CLI (not as a prompt to Claude)
    await sendKeys('/reset');
    // Small delay to ensure text is fully typed before Enter
    await new Promise(resolve => setTimeout(resolve, 100));
    // Use C-m (Ctrl+M) which is equivalent to Enter and more reliable
    await sendKey('C-m');

    // Send confirmation
    const workspaceDisplay = DEFAULT_WORKSPACE.replace(process.env.HOME || '', '~');
    await reply(`🔄 *Resetting context...*\n\n` +
      `Context cleared ✓\n` +
      `Workspace: \`${workspaceDisplay}\`\n\n` +
      `Ready for new tasks!`);
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
 * Handle callback query from inline keyboard (approve/deny permissions)
 */
async function handleCallbackQuery(
  callbackQuery: NonNullable<TelegramUpdate['callback_query']>,
  log: import('fastify').FastifyLoggerInstance
): Promise<void> {
  const { id: callbackId, from, message, data } = callbackQuery;
  const client = getTelegramClient();

  // Verify user is allowed
  const verification = verifyUser(from);
  if (!verification.allowed) {
    log.warn({ user_id: from.id }, `Unauthorized callback attempt: ${verification.error}`);
    await client.answerCallbackQuery(callbackId, {
      text: 'Unauthorized',
      show_alert: true,
    });
    return;
  }

  // Parse callback data (format: "approve:perm_xxx" or "deny:perm_xxx")
  if (!data) {
    await client.answerCallbackQuery(callbackId, { text: 'Invalid request' });
    return;
  }

  const [action, requestId] = data.split(':');
  if (!requestId || !['approve', 'deny'].includes(action)) {
    await client.answerCallbackQuery(callbackId, { text: 'Invalid action' });
    return;
  }

  // Get the permission request
  const request = await getPermissionRequest(requestId);
  if (!request) {
    await client.answerCallbackQuery(callbackId, {
      text: 'Request not found or expired',
      show_alert: true,
    });
    return;
  }

  // Check if already responded
  if (request.status !== 'pending') {
    await client.answerCallbackQuery(callbackId, {
      text: `Already ${request.status}`,
    });
    return;
  }

  // Update the request
  const approved = action === 'approve';
  await updatePermissionRequest(requestId, {
    status: approved ? 'approved' : 'denied',
    response: approved ? 'approve' : 'deny',
    respondedAt: Date.now(),
  });

  log.info({ requestId, action, from: from.id }, 'Permission response received');

  // Answer the callback query
  await client.answerCallbackQuery(callbackId, {
    text: approved ? '✅ Approved' : '❌ Denied',
  });

  // Update the original message
  if (message && message.chat && message.message_id) {
    const statusEmoji = approved ? '✅' : '❌';
    const statusText = approved ? 'APPROVED' : 'DENIED';

    const updatedText = `🔧 *Tool Permission Request*\n\n` +
      `*Tool:* ${request.toolName}\n` +
      `*Parameters:*\n\`\`\`\n${formatToolInputForDisplay(request.toolName, request.toolInput)}\n\`\`\`\n\n` +
      `${statusEmoji} *${statusText}* by ${from.first_name}`;

    await client.editMessageText(message.chat.id, message.message_id, updatedText, {
      parse_mode: 'Markdown',
    });
  }
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

  // Handle callback query (inline keyboard responses)
  if (update.callback_query) {
    try {
      await handleCallbackQuery(update.callback_query, log);
    } catch (err) {
      log.error({ err }, 'Callback query handler error');
    }
    reply.code(200).send({ ok: true });
    return;
  }

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

  // Handle photo messages
  if (message.photo && message.photo.length > 0) {
    try {
      // Check tmux session
      if (!(await sessionExists())) {
        await sendReply(chat.id, '⚠️ Claude session not running. Start tmux with Claude first.');
        reply.code(200).send({ ok: true });
        return;
      }

      // Get the largest photo
      const largestPhoto = getLargestPhoto(message.photo);
      log.info({ fileId: largestPhoto.file_id, size: largestPhoto.file_size }, 'Received photo');

      // Download and save the photo
      const savedPhoto = await savePhoto(largestPhoto);
      log.info({ path: savedPhoto.filePath }, 'Photo saved');

      // Format message for Claude
      const promptText = formatPhotoMessageForClaude(savedPhoto, message.caption);

      // Save pending state
      await savePending({
        chatId: chat.id,
        userId: from?.id || 0,
        messageId: message_id,
        timestamp: Date.now(),
        text: promptText,
      });

      // Start typing indicator
      startTypingIndicator(chat.id);

      // Inject prompt to Claude
      await injectPrompt(promptText);

      // Acknowledge receipt
      const client = getTelegramClient();
      await client.setMessageReaction(chat.id, message_id, '📷');

      log.info({ path: savedPhoto.filePath }, 'Photo message injected to Claude');
    } catch (err) {
      log.error({ err }, 'Failed to process photo');
      await sendReply(chat.id, `❌ Failed to process photo: ${(err as Error).message}`);
    }

    reply.code(200).send({ ok: true });
    return;
  }

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

      // Save pending state
      await savePending({
        chatId: chat.id,
        userId: from?.id || 0,
        messageId: message_id,
        timestamp: Date.now(),
        text,
      });

      // Start typing indicator (will continue until pending is cleared)
      startTypingIndicator(chat.id);

      // Inject prompt to Claude
      await injectPrompt(text);

      // Acknowledge receipt
      const client = getTelegramClient();
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
