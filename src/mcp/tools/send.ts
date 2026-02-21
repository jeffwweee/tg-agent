/**
 * telegram_send MCP Tool
 *
 * Sends messages to Telegram with auto-chunking.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerContext } from '../server.js';
import { chunkMessage } from '../../telegram/chunk.js';
import { escapeMarkdown } from '../../telegram/escape.js';

export const sendTool: Tool = {
  name: 'telegram_send',
  description: 'Send a message to Telegram. Auto-chunks if message exceeds 4000 characters. Supports MarkdownV2 formatting.',
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: {
        type: 'number',
        description: 'Telegram chat ID to send to',
      },
      text: {
        type: 'string',
        description: 'Message text to send',
      },
      parse_mode: {
        type: 'string',
        enum: ['MarkdownV2', 'HTML'],
        description: 'Parse mode for formatting (default: MarkdownV2)',
      },
    },
    required: ['chat_id', 'text'],
  },
};

export interface SendResult {
  ok: boolean;
  message_ids?: number[];
  chunks_sent?: number;
  error?: string;
}

export async function handleSend(
  context: McpServerContext,
  args: Record<string, unknown>
): Promise<SendResult> {
  const chatId = args['chat_id'];
  const text = args['text'];
  const parseMode = args['parse_mode'];

  if (typeof chatId !== 'number') {
    return { ok: false, error: 'chat_id must be a number' };
  }

  if (typeof text !== 'string') {
    return { ok: false, error: 'text must be a string' };
  }

  // Process text based on parse mode
  let processedText = text;
  const useMarkdown = parseMode !== 'HTML';

  if (useMarkdown) {
    processedText = escapeMarkdown(text);
  }

  // Chunk the message
  const { chunks, needsChunking } = chunkMessage(processedText);

  const messageIds: number[] = [];
  let chunksSent = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] ?? '';
    const prefix = needsChunking ? `[${i + 1}/${chunks.length}]\n\n` : '';
    const messageText = prefix + chunk;

    const result = await context.telegram.sendMessage({
      chatId,
      text: messageText,
      parseMode: useMarkdown ? 'MarkdownV2' : 'HTML',
    });

    if (!result.ok) {
      // If a chunk fails, return partial success
      const failResult: SendResult = {
        ok: false,
        chunks_sent: chunksSent,
        error: result.error ?? 'Failed to send message',
      };
      if (messageIds.length > 0) {
        failResult.message_ids = messageIds;
      }
      return failResult;
    }

    if (result.messageId !== undefined) {
      messageIds.push(result.messageId);
    }
    chunksSent++;
  }

  return {
    ok: true,
    message_ids: messageIds,
    chunks_sent: chunksSent,
  };
}
