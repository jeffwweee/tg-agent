/**
 * telegram_poll MCP Tool
 *
 * Polls messages from the inbox.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerContext } from '../server.js';

export const pollTool: Tool = {
  name: 'telegram_poll',
  description: 'Poll pending messages from the Telegram inbox. Returns messages with combined_context for multi-message context.',
  inputSchema: {
    type: 'object',
    properties: {
      timeout: {
        type: 'number',
        description: 'Long-poll timeout in milliseconds (default: 5000)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of messages to return (default: 10)',
      },
    },
  },
};

export interface PollResult {
  ok: boolean;
  messages: Array<{
    id: string;
    chat_id: number;
    user_id: number;
    text: string;
    timestamp: number;
    combined_context?: string;
  }>;
  count: number;
}

export async function handlePoll(
  context: McpServerContext,
  args: Record<string, unknown>
): Promise<PollResult> {
  const timeout = typeof args['timeout'] === 'number' ? args['timeout'] : 5000;
  const limit = typeof args['limit'] === 'number' ? args['limit'] : 10;

  // Ensure consumer group exists
  await context.inbox.setupConsumerGroup();

  // Get messages from inbox
  const messages = await context.inbox.getMessages(limit, timeout);

  // Combine messages into context if multiple
  let combinedContext: string | undefined;
  if (messages.length > 1) {
    combinedContext = messages
      .map((m) => m.text)
      .join('\n\n---\n\n');
  }

  return {
    ok: true,
    messages: messages.map((m) => ({
      id: m.id,
      chat_id: m.chatId,
      user_id: m.userId,
      text: m.text,
      timestamp: m.timestamp,
      ...(combinedContext !== undefined ? { combined_context: combinedContext } : {}),
    })),
    count: messages.length,
  };
}
