/**
 * telegram_send_typing MCP Tool
 *
 * Shows typing indicator in Telegram chat.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerContext } from '../server.js';

export const typingTool: Tool = {
  name: 'telegram_send_typing',
  description: 'Show typing indicator in a Telegram chat. Use this before sending a long response.',
  inputSchema: {
    type: 'object',
    properties: {
      chat_id: {
        type: 'number',
        description: 'Telegram chat ID',
      },
    },
    required: ['chat_id'],
  },
};

export interface TypingResult {
  ok: boolean;
  error?: string;
}

export async function handleTyping(
  context: McpServerContext,
  args: Record<string, unknown>
): Promise<TypingResult> {
  const chatId = args['chat_id'];

  if (typeof chatId !== 'number') {
    return { ok: false, error: 'chat_id must be a number' };
  }

  const success = await context.telegram.sendChatAction(chatId, 'typing');

  return { ok: success };
}
