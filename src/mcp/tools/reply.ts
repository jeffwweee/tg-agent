/**
 * telegram_reply MCP Tool
 *
 * Stateful conversation tool for Telegram.
 * Call without text to poll messages, call with text to reply and auto-ack.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerContext } from '../server.js';
import type { InboxMessage } from '../../inbox/types.js';
import { chunkMessage } from '../../telegram/chunk.js';
import { escapeMarkdown } from '../../telegram/escape.js';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Conversation state file path (per-session)
function getStateFilePath(sessionId: string): string {
  return join(tmpdir(), `tg-conversation-${sessionId}.json`);
}

interface ConversationState {
  chat_id: number;
  pending_acks: string[];
  last_poll: number;
}

function loadState(sessionId: string): ConversationState | null {
  try {
    const path = getStateFilePath(sessionId);
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      return data as ConversationState;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function saveState(sessionId: string, state: ConversationState): void {
  try {
    const path = getStateFilePath(sessionId);
    writeFileSync(path, JSON.stringify(state));
  } catch {
    // Ignore errors
  }
}

function clearState(sessionId: string): void {
  try {
    const path = getStateFilePath(sessionId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Ignore errors
  }
}

export const replyTool: Tool = {
  name: 'telegram_reply',
  description: 'Stateful conversation tool. Call without text to poll messages, call with text to reply and auto-ack. Replaces telegram_poll + telegram_send + telegram_ack pattern.',
  inputSchema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Reply text. If omitted, polls for messages only.',
      },
      ack_all: {
        type: 'boolean',
        description: 'Ack all pending messages after sending (default: true)',
      },
      typing: {
        type: 'boolean',
        description: 'Show typing indicator before sending (default: true)',
      },
    },
  },
};

export interface ReplyResult {
  ok: boolean;
  action: 'poll' | 'reply' | 'error';
  messages?: Array<{
    id: string;
    chat_id: number;
    user_id: number;
    text: string;
    timestamp: number;
  }>;
  count?: number;
  combined_context?: string;
  message_ids?: number[];
  chunks_sent?: number;
  acked?: number;
  error?: string;
}

export async function handleReply(
  context: McpServerContext,
  args: Record<string, unknown>
): Promise<ReplyResult> {
  const sessionId = context.inbox.getSessionId();
  const text = args['text'];
  const ackAll = args['ack_all'] !== false; // Default true
  const showTyping = args['typing'] !== false; // Default true

  // If text provided, this is a reply
  if (typeof text === 'string' && text.trim().length > 0) {
    return handleSendReply(context, sessionId, text.trim(), ackAll, showTyping);
  }

  // Otherwise, poll for messages
  return handlePollMessages(context, sessionId);
}

async function handlePollMessages(
  context: McpServerContext,
  sessionId: string
): Promise<ReplyResult> {
  // Ensure consumer group exists
  await context.inbox.setupConsumerGroup();

  // Get messages from inbox
  const messages = await context.inbox.getMessages(10, 5000);

  if (messages.length === 0) {
    return {
      ok: true,
      action: 'poll',
      messages: [],
      count: 0,
    };
  }

  // Save state with pending acks
  const state: ConversationState = {
    chat_id: messages[0]!.chatId,
    pending_acks: messages.map(m => m.id),
    last_poll: Date.now(),
  };
  saveState(sessionId, state);

  // Combine messages into context if multiple
  let combinedContext: string | undefined;
  if (messages.length > 1) {
    combinedContext = messages.map(m => m.text).join('\n\n---\n\n');
  }

  return {
    ok: true,
    action: 'poll',
    messages: messages.map(m => ({
      id: m.id,
      chat_id: m.chatId,
      user_id: m.userId,
      text: m.text,
      timestamp: m.timestamp,
    })),
    count: messages.length,
    ...(combinedContext ? { combined_context: combinedContext } : {}),
  };
}

async function handleSendReply(
  context: McpServerContext,
  sessionId: string,
  text: string,
  ackAll: boolean,
  showTyping: boolean
): Promise<ReplyResult> {
  // Load state to get chat_id and pending acks
  const state = loadState(sessionId);

  if (!state) {
    return {
      ok: false,
      action: 'error',
      error: 'No active conversation. Call telegram_reply() without text first to poll messages.',
    };
  }

  const chatId = state.chat_id;
  const pendingAcks = state.pending_acks;

  // Show typing indicator
  if (showTyping) {
    await context.telegram.sendChatAction(chatId, 'typing').catch(() => {
      // Ignore typing errors
    });
  }

  // Escape markdown and chunk message
  const processedText = escapeMarkdown(text);
  const { chunks, needsChunking } = chunkMessage(processedText);

  const messageIds: number[] = [];
  let chunksSent = 0;

  // Send chunks
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] ?? '';
    const prefix = needsChunking ? `[${i + 1}/${chunks.length}]\n\n` : '';
    const messageText = prefix + chunk;

    const result = await context.telegram.sendMessage({
      chatId,
      text: messageText,
      parseMode: 'MarkdownV2',
    });

    if (!result.ok) {
      return {
        ok: false,
        action: 'error',
        error: result.error ?? 'Failed to send message',
        chunks_sent: chunksSent,
        ...(messageIds.length > 0 ? { message_ids: messageIds } : {}),
      };
    }

    if (result.messageId !== undefined) {
      messageIds.push(result.messageId);
    }
    chunksSent++;
  }

  // Ack pending messages if requested
  let acked = 0;
  if (ackAll && pendingAcks.length > 0) {
    acked = await context.inbox.ackMessages(pendingAcks);

    // Update reactions on acked messages
    const messages = await context.inbox.getMessagesByIds(pendingAcks);
    for (const msg of messages) {
      if (msg.tgMessageId) {
        await context.telegram.setMessageReaction({
          chatId: msg.chatId,
          messageId: msg.tgMessageId,
          reaction: '✅',
        }).catch(() => {
          // Ignore reaction errors
        });
      }
    }
  }

  // Clear state after successful reply
  clearState(sessionId);

  return {
    ok: true,
    action: 'reply',
    message_ids: messageIds,
    chunks_sent: chunksSent,
    acked,
  };
}
