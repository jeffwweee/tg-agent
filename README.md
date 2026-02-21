# tg-agent v2

A **Telegram Gateway + MCP Server** that enables Claude Code to communicate via Telegram. Built with a clean MCP-based polling approach using Redis Streams for durability.

## Features

- **Webhook Gateway** - Receive Telegram messages via Express webhook
- **Redis Streams Inbox** - Durable message storage with consumer groups
- **MCP Tools** - Native integration with Claude Code via Model Context Protocol
- **Auto-chunking** - Messages longer than 4000 chars are automatically split
- **Message Lease** - 12-hour lease with automatic reclaim for long sessions
- **Type-safe** - Full TypeScript with strict mode

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Telegram      │────▶│    Gateway      │────▶│     Redis       │
│   (webhook)     │     │   (Express)     │     │   (inbox)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                      │
                                                      ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Claude Code   │────▶│   MCP Server    │────▶│  telegram_*     │
│   (polls)       │◀────│   (tools)       │◀────│  tools          │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Components

| Component | Description |
|-----------|-------------|
| **Gateway** | Express server receiving Telegram webhooks at `/telegram/webhook` |
| **Redis Streams** | Durable inbox with consumer groups for message reliability |
| **MCP Server** | Provides `telegram_*` tools via stdio transport |

### Message Flow

```
1. User sends message to Telegram bot
2. Telegram → webhook → Gateway → Redis inbox
3. Claude Code calls telegram_poll
4. Claude Code processes messages
5. Claude Code calls telegram_send(reply)
6. Claude Code calls telegram_ack
7. Loop to step 3
```

## Quick Start

### Prerequisites

- Node.js 20+
- Redis server
- Telegram bot token (from [@BotFather](https://t.me/BotFather))

### Installation

```bash
# Clone and install
cd tg-agent
npm install

# Copy environment config
cp .env.example .env

# Edit .env with your settings
vim .env
```

### Configuration

Create a `.env` file with the following variables:

```bash
# Telegram Configuration (required)
TELEGRAM_BOT_TOKEN=your-bot-token-here
TELEGRAM_ALLOWED_USERS=123456789,987654321

# Telegram Webhook Secret (optional, recommended)
TELEGRAM_WEBHOOK_SECRET=your-random-secret

# Redis Configuration
REDIS_URL=redis://localhost:6379
INBOX_STREAM_KEY=tg:inbox
INBOX_CONSUMER_GROUP=tg-consumer

# Message Settings
MESSAGE_LEASE_MS=43200000

# Gateway Configuration
GATEWAY_PORT=3000
GATEWAY_HOST=0.0.0.0

# Logging
LOG_LEVEL=info
```

### Running

```bash
# Setup Redis consumer group (one-time)
npm run setup:inbox

# Development mode (gateway + MCP)
npm run dev

# Gateway only
npm run dev:gateway

# MCP only (for Claude Code integration)
npm run dev:mcp

# Production
npm run build
npm start
```

## MCP Tools

### telegram_poll

Fetch pending messages from the Telegram inbox.

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `timeout` | number | 5000 | Long-poll timeout in milliseconds |
| `limit` | number | 10 | Maximum messages to return |

**Returns:**
```json
{
  "ok": true,
  "count": 2,
  "messages": [
    {
      "id": "1234567890-0",
      "chat_id": 123456789,
      "user_id": 987654321,
      "text": "Hello!",
      "timestamp": 1708492800000
    }
  ]
}
```

When multiple messages are returned, a `combined_context` field contains all messages joined with separators for easy processing.

### telegram_send

Send a message to Telegram with auto-chunking.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `chat_id` | number | Yes | Telegram chat ID |
| `text` | string | Yes | Message text to send |
| `parse_mode` | string | No | `MarkdownV2` or `HTML` (default: `MarkdownV2`) |

**Returns:**
```json
{
  "ok": true,
  "message_ids": [42, 43],
  "chunks_sent": 2
}
```

Messages longer than 4000 characters are automatically chunked with progress indicators (`[1/3]`, `[2/3]`, etc.).

### telegram_ack

Acknowledge processed messages to remove them from pending.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `message_ids` | string[] | Yes | Array of message IDs from `telegram_poll` |

**Returns:**
```json
{
  "ok": true,
  "acked": 2
}
```

### telegram_send_typing

Show typing indicator in the chat.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `chat_id` | number | Yes | Telegram chat ID |

**Returns:**
```json
{
  "ok": true
}
```

## Claude Code Integration

### MCP Configuration

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "tg-agent": {
      "command": "node",
      "args": ["/path/to/tg-agent/dist/index.js", "--mcp"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your-token",
        "TELEGRAM_ALLOWED_USERS": "123456789",
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

### Usage Example

In Claude Code:

```
You: Check for new Telegram messages

Claude: [calls telegram_poll]
I found 2 messages from chat 123456789:
1. "What's the weather?"
2. "In Tokyo"

[calls telegram_send with chat_id=123456789, text="I'll check the weather in Tokyo for you..."]

[calls telegram_ack with message_ids from poll]
```

## Webhook Setup

After starting the gateway, configure your Telegram webhook:

```bash
# Using the bot API directly
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/telegram/webhook",
    "secret_token": "your-webhook-secret"
  }'
```

The webhook secret should match `TELEGRAM_WEBHOOK_SECRET` in your `.env`.

## Project Structure

```
tg-agent/
├── src/
│   ├── index.ts              # Entry point
│   ├── config/               # Configuration module
│   ├── gateway/              # Express webhook server
│   │   ├── server.ts
│   │   └── routes/webhook.ts
│   ├── inbox/                # Redis Streams client
│   │   ├── client.ts
│   │   └── types.ts
│   ├── mcp/                  # MCP Server
│   │   ├── server.ts
│   │   └── tools/            # Tool implementations
│   │       ├── poll.ts
│   │       ├── send.ts
│   │       ├── ack.ts
│   │       └── typing.ts
│   ├── telegram/             # Telegram API client
│   │   ├── client.ts
│   │   ├── chunk.ts          # Message chunking
│   │   └── escape.ts         # MarkdownV2 escaping
│   ├── utils/                # Shared utilities
│   └── scripts/              # Utility scripts
├── tests/
│   ├── unit/                 # Unit tests
│   ├── integration/          # Integration tests
│   └── helpers/              # Test helpers
├── docs/                     # Design documents
├── .env.example              # Environment template
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Development mode with hot reload |
| `npm run dev:gateway` | Run gateway only |
| `npm run dev:mcp` | Run MCP server only |
| `npm start` | Production mode |
| `npm test` | Run tests |
| `npm run typecheck` | Type check without emit |

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage
```

## Configuration Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USERS` | Yes | - | Comma-separated allowed user IDs |
| `TELEGRAM_WEBHOOK_SECRET` | No | - | Secret for webhook validation |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `INBOX_STREAM_KEY` | No | `tg:inbox` | Redis stream key |
| `INBOX_CONSUMER_GROUP` | No | `tg-consumer` | Consumer group name |
| `MESSAGE_LEASE_MS` | No | `43200000` | Message lease (12 hours) |
| `GATEWAY_PORT` | No | `3000` | Gateway server port |
| `GATEWAY_HOST` | No | `0.0.0.0` | Gateway bind address |
| `MCP_SERVER_NAME` | No | `tg-agent` | MCP server name |
| `MCP_SERVER_VERSION` | No | `2.0.0` | MCP server version |
| `LOG_LEVEL` | No | `info` | Log level (debug/info/warn/error) |

## License

MIT
