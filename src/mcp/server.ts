/**
 * MCP Server
 *
 * Provides telegram_* tools for Claude Code.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { InboxClient } from '../inbox/client.js';
import { TelegramClient } from '../telegram/client.js';
import { pollTool, handlePoll } from './tools/poll.js';
import { sendTool, handleSend } from './tools/send.js';
import { ackTool, handleAck } from './tools/ack.js';
import { typingTool, handleTyping } from './tools/typing.js';
import { replyTool, handleReply } from './tools/reply.js';
import { logger } from '../utils/logger.js';

export interface McpServerOptions {
  name?: string;
  version?: string;
}

export interface McpServerContext {
  inbox: InboxClient;
  telegram: TelegramClient;
}

// Tool registry
const tools: Tool[] = [pollTool, sendTool, ackTool, typingTool, replyTool];

export function createMcpServer(options?: McpServerOptions): Server {
  const server = new Server(
    {
      name: options?.name ?? process.env['MCP_SERVER_NAME'] ?? 'tg-agent',
      version: options?.version ?? process.env['MCP_SERVER_VERSION'] ?? '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Create shared context
  const context: McpServerContext = {
    inbox: new InboxClient(),
    telegram: new TelegramClient(),
  };

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.debug(`Tool called: ${name}`, { args });

    try {
      switch (name) {
        case 'telegram_poll': {
          const result = await handlePoll(context, args ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'telegram_send': {
          const result = await handleSend(context, args ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'telegram_ack': {
          const result = await handleAck(context, args ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'telegram_send_typing': {
          const result = await handleTyping(context, args ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'telegram_reply': {
          const result = await handleReply(context, args ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Tool error: ${name}`, { error: errorMessage });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: errorMessage }) }],
        isError: true,
      };
    }
  });

  return server;
}

export async function connectMcpServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { InboxClient, TelegramClient };
