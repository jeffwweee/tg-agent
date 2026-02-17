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
  saveDocument,
  formatFileMessageForClaude,
  isFileTypeAllowed,
  getAllowedFileTypes,
} from '../../telegram/document.js';
import {
  getPermissionRequest,
  updatePermissionRequest,
  formatToolInputForDisplay,
} from '../../state/permission.js';
import {
  getSelectionRequest,
  updateSelectionRequest,
  getPendingCustomInputRequest,
} from '../../state/selection.js';
import {
  parseSelectionCallback,
  formatAnsweredMessage,
  formatCancelledMessage,
  formatAwaitingInputPrompt,
  buildSelectionKeyboard,
  formatSelectionQuestion,
} from '../../telegram/selection.js';
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
import { runStartupChecks } from '../../health/startup-checks.js';

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
      `/health - Run health checks on all services\n` +
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

  health: async (_message, reply) => {
    const report = await runStartupChecks();

    let text = '🔍 *Service Health*\n\n';

    for (const result of report.results) {
      const emoji = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
      text += `${emoji} *${result.name}*\n`;
      text += `_${result.message}_\n\n`;
    }

    text += `*Summary:* ${report.passed}/${report.totalChecks} passed`;

    if (report.criticalErrors > 0) {
      text += `\n\n⚠️ *Running in degraded mode*`;
    }

    await reply(text);
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
 * Handle selection callback query (single-select, toggle, submit, cancel, custom)
 */
async function handleSelectionCallback(
  callbackQuery: NonNullable<TelegramUpdate['callback_query']>,
  log: import('fastify').FastifyLoggerInstance
): Promise<boolean> {
  const { id: callbackId, from, message, data } = callbackQuery;
  const client = getTelegramClient();

  if (!data) {
    return false;
  }

  // Check if this is a selection callback
  const parsed = parseSelectionCallback(data);
  if (!parsed) {
    return false; // Not a selection callback
  }

  const { action, requestId, optionIndex } = parsed;

  // Verify user is allowed
  const verification = verifyUser(from);
  if (!verification.allowed) {
    log.warn({ user_id: from.id }, `Unauthorized selection callback: ${verification.error}`);
    await client.answerCallbackQuery(callbackId, {
      text: 'Unauthorized',
      show_alert: true,
    });
    return true;
  }

  // Get the selection request
  const request = await getSelectionRequest(requestId);
  if (!request) {
    await client.answerCallbackQuery(callbackId, {
      text: 'Request not found or expired',
      show_alert: true,
    });
    return true;
  }

  // Check if already responded
  if (request.status !== 'pending') {
    await client.answerCallbackQuery(callbackId, {
      text: `Already ${request.status}`,
    });
    return true;
  }

  log.info({ requestId, action, optionIndex, from: from.id }, 'Selection callback received');

  // Handle different actions
  switch (action) {
    case 'select': {
      // Single-select: immediately submit with this option
      const selectedLabel = request.options[optionIndex!]?.label || '';
      await updateSelectionRequest(requestId, {
        status: 'answered',
        selectedIndices: [optionIndex!],
      });

      await client.answerCallbackQuery(callbackId, {
        text: `✅ Selected: ${selectedLabel}`,
      });

      // Update the original message
      if (message && message.chat && message.message_id) {
        const updatedText = formatAnsweredMessage(request.question, [selectedLabel]);
        await client.editMessageText(message.chat.id, message.message_id, updatedText, {
          parse_mode: 'Markdown',
        });
      }
      break;
    }

    case 'toggle': {
      // Multi-select: toggle the option
      const currentSelected = [...request.selectedIndices];
      const idx = currentSelected.indexOf(optionIndex!);

      if (idx >= 0) {
        currentSelected.splice(idx, 1);
      } else {
        currentSelected.push(optionIndex!);
      }

      await updateSelectionRequest(requestId, {
        selectedIndices: currentSelected,
      });

      const selectedLabel = request.options[optionIndex!]?.label || '';
      await client.answerCallbackQuery(callbackId, {
        text: idx >= 0 ? `Deselected: ${selectedLabel}` : `Selected: ${selectedLabel}`,
      });

      // Update keyboard to show selection state
      if (message && message.chat && message.message_id) {
        const updatedText = formatSelectionQuestion(
          request.question,
          request.header,
          request.options,
          currentSelected,
          request.multiSelect
        );

        await client.editMessageText(message.chat.id, message.message_id, updatedText, {
          parse_mode: 'MarkdownV2',
          reply_markup: buildSelectionKeyboard(requestId, request.options, currentSelected, request.multiSelect),
        });
      }
      break;
    }

    case 'submit': {
      // Multi-select: submit current selections
      const selectedLabels = request.selectedIndices.map(i => request.options[i]?.label || '');

      if (request.selectedIndices.length === 0) {
        await client.answerCallbackQuery(callbackId, {
          text: 'Please select at least one option',
          show_alert: true,
        });
        return true;
      }

      await updateSelectionRequest(requestId, {
        status: 'answered',
      });

      await client.answerCallbackQuery(callbackId, {
        text: `✅ Submitted ${request.selectedIndices.length} selection(s)`,
      });

      // Update the original message
      if (message && message.chat && message.message_id) {
        const updatedText = formatAnsweredMessage(request.question, selectedLabels);
        await client.editMessageText(message.chat.id, message.message_id, updatedText, {
          parse_mode: 'Markdown',
        });
      }
      break;
    }

    case 'custom': {
      // Request custom text input
      await updateSelectionRequest(requestId, {
        status: 'awaiting_input',
      });

      await client.answerCallbackQuery(callbackId, {
        text: 'Type your answer below',
      });

      // Send prompt for text input
      const promptText = formatAwaitingInputPrompt(request.question);
      await client.sendMessage(message!.chat.id, promptText, { parse_mode: 'Markdown' });
      break;
    }

    case 'cancel': {
      // Cancel the selection
      await updateSelectionRequest(requestId, {
        status: 'cancelled',
      });

      await client.answerCallbackQuery(callbackId, {
        text: '❌ Cancelled',
      });

      // Update the original message
      if (message && message.chat && message.message_id) {
        const updatedText = formatCancelledMessage(request.question);
        await client.editMessageText(message.chat.id, message.message_id, updatedText, {
          parse_mode: 'Markdown',
        });
      }
      break;
    }
  }

  return true;
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
      // First try selection callback, then permission callback
      const handled = await handleSelectionCallback(update.callback_query, log);
      if (!handled) {
        await handleCallbackQuery(update.callback_query, log);
      }
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
      await client.setMessageReaction(chat.id, message_id, '👀');

      log.info({ path: savedPhoto.filePath }, 'Photo message injected to Claude');
    } catch (err) {
      log.error({ err }, 'Failed to process photo');
      // Don't use markdown for error messages to avoid parsing issues
      const client = getTelegramClient();
      await client.sendMessage(chat.id, `Failed to process photo: ${(err as Error).message}`);
    }

    reply.code(200).send({ ok: true });
    return;
  }

  // Handle document messages
  if (message.document) {
    try {
      const doc = message.document;

      // Check tmux session
      if (!(await sessionExists())) {
        await sendReply(chat.id, '⚠️ Claude session not running. Start tmux with Claude first.');
        reply.code(200).send({ ok: true });
        return;
      }

      // Validate file type
      const filename = doc.file_name || 'unknown';
      if (!isFileTypeAllowed(filename)) {
        const allowedTypes = getAllowedFileTypes().join(', ');
        await sendReply(chat.id, `⚠️ Unsupported file type. Allowed types: ${allowedTypes}`);
        reply.code(200).send({ ok: true });
        return;
      }

      log.info({ fileId: doc.file_id, filename, size: doc.file_size }, 'Received document');

      // Download and save the document
      const savedDoc = await saveDocument(doc);
      log.info({ path: savedDoc.filePath }, 'Document saved');

      // Format message for Claude
      const promptText = formatFileMessageForClaude(savedDoc, message.caption);

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
      await client.setMessageReaction(chat.id, message_id, '📎');

      log.info({ path: savedDoc.filePath }, 'Document message injected to Claude');
    } catch (err) {
      log.error({ err }, 'Failed to process document');
      // Don't use markdown for error messages to avoid parsing issues
      const client = getTelegramClient();
      await client.sendMessage(chat.id, `Failed to process document: ${(err as Error).message}`);
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
      // Check if there's a pending selection request awaiting custom input
      const pendingSelection = await getPendingCustomInputRequest(chat.id);
      if (pendingSelection) {
        log.info({ requestId: pendingSelection.requestId, text: text.slice(0, 50) }, 'Received custom input for selection');

        // Update the selection request with the custom input
        await updateSelectionRequest(pendingSelection.requestId, {
          status: 'answered',
          customInput: text,
        });

        // Send confirmation to user
        const client = getTelegramClient();
        const confirmText = `✅ Received: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`;
        await client.sendMessage(chat.id, confirmText);

        reply.code(200).send({ ok: true });
        return;
      }

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
