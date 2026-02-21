/**
 * telegram_ack MCP Tool
 *
 * Acknowledges processed messages.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerContext } from '../server.js';

export const ackTool: Tool = {
  name: 'telegram_ack',
  description: 'Acknowledge that messages have been processed. Removes them from the pending queue.',
  inputSchema: {
    type: 'object',
    properties: {
      message_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of message IDs (from telegram_poll) to acknowledge',
      },
    },
    required: ['message_ids'],
  },
};

export interface AckResult {
  ok: boolean;
  acked: number;
  error?: string;
}

export async function handleAck(
  context: McpServerContext,
  args: Record<string, unknown>
): Promise<AckResult> {
  const messageIds = args['message_ids'];

  if (!Array.isArray(messageIds)) {
    return { ok: false, acked: 0, error: 'message_ids must be an array' };
  }

  // Filter to valid strings
  const validIds = messageIds.filter((id): id is string => typeof id === 'string');

  if (validIds.length === 0) {
    return { ok: true, acked: 0 };
  }

  const acked = await context.inbox.ackMessages(validIds);

  return {
    ok: true,
    acked,
  };
}
