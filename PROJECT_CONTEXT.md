# PROJECT_CONTEXT.md

> Project context for tg-agent v2 - Telegram Gateway + MCP Server for Claude Code

## Overview

**tg-agent** is a Telegram Gateway + MCP Server that enables Claude Code to communicate via Telegram. It uses a clean MCP-based polling approach with Redis Streams for message durability.

### Key Features
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

1. User sends message to Telegram bot
2. Telegram → webhook → Gateway → Redis inbox
3. Claude Code calls `telegram_poll`
4. Claude Code processes messages
5. Claude Code calls `telegram_send(reply)`
6. Claude Code calls `telegram_ack`
7. Loop to step 3

## Project Structure

```
tg-agent/
├── .claude/
│   └── skills/           # Project-level Claude Code skills
├── docs/
│   ├── plans/            # Design documents
│   └── tg-agent-upgrade-plan.md
├── src/
│   ├── index.ts          # Entry point (gateway + MCP)
│   ├── process.ts        # Process management
│   ├── config/           # Configuration module
│   │   └── index.ts
│   ├── gateway/          # Express webhook server
│   │   ├── server.ts
│   │   └── routes/webhook.ts
│   ├── inbox/            # Redis Streams client
│   │   ├── client.ts
│   │   └── types.ts
│   ├── mcp/              # MCP Server
│   │   ├── server.ts
│   │   └── tools/
│   │       ├── poll.ts
│   │       ├── send.ts
│   │       ├── ack.ts
│   │       └── typing.ts
│   ├── telegram/         # Telegram API client
│   │   ├── client.ts
│   │   ├── chunk.ts
│   │   └── escape.ts
│   ├── utils/            # Shared utilities
│   │   ├── index.ts
│   │   └── logger.ts
│   └── scripts/          # Utility scripts
│       └── setup-inbox.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── helpers/
├── tasks.json            # Implementation tasks
├── CLAUDE.md             # Claude Code instructions
├── README.md             # User documentation
└── package.json
```

## Setup

### Prerequisites
- Node.js 20+
- Redis server
- Telegram bot token (from @BotFather)

### Installation

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Setup Redis consumer group (one-time)
npm run setup:inbox

# Development mode (gateway + MCP)
npm run dev
```

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

## Configuration

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
| `LOG_LEVEL` | No | `info` | Log level |

## MCP Tools

| Tool | Purpose |
|------|---------|
| `telegram_poll` | Fetch pending messages from inbox |
| `telegram_send` | Send reply (auto-chunks if > 4000 chars) |
| `telegram_ack` | Acknowledge processed messages |
| `telegram_send_typing` | Show typing indicator |

## Available Skills

Project-level skills in `.claude/skills/`:

| Skill | Use For |
|-------|---------|
| `building-mcp-server-on-cloudflare` | MCP server patterns |
| `telegram-bot-builder` | Telegram Bot API best practices |
| `nodejs-backend-patterns` | Express/Fastify patterns |
| `redis-best-practices` | Redis Streams, caching |
| `typescript-advanced-types` | Type-safe implementations |
| `typescript-pro` | Advanced TypeScript patterns |

## Conventions

- **Language:** TypeScript with strict mode
- **Runtime:** Node.js 20+
- **Testing:** Vitest
- **Commits:** Conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- **Branches:** `feature/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Wake-up | Native polling via MCP | No tmux dependency |
| Inbox | Redis Streams | Already running, native consumer groups |
| Lease | 12 hours | Long sessions with headroom |
| Messages | Accumulate until polled | Multi-message context |
| Reply | Consolidated, auto-chunked | Simpler for Claude Code |

## Dependencies

### Production
- `@modelcontextprotocol/sdk` - MCP server implementation
- `express` - Webhook gateway
- `ioredis` - Redis Streams client
- `dotenv` - Environment configuration

### Development
- `typescript` - Type checking and compilation
- `tsx` - TypeScript execution
- `vitest` - Testing framework
- `@types/*` - Type definitions

## Implementation Status

### Completed Phases
- **Foundation** (V2-001, V2-002, V2-003, V2-010) - Core modules and utilities
- **Gateway** (V2-004) - Webhook receiver
- **MCP Server** (V2-005, V2-006, V2-007, V2-008) - MCP tools implementation
- **Integration** (V2-009, V2-011) - Entry point and testing
- **Docs** (V2-012) - Documentation

### Pending Phases
- **Wake-up** (V2-013) - Tmux injection for Claude Code wake-up
- **Hooks** (V2-014, V2-015) - Response and approval hooks for Telegram integration

## Related Documentation

- [CLAUDE.md](./CLAUDE.md) - Claude Code instructions
- [README.md](./README.md) - User documentation
- [tasks.json](./tasks.json) - Implementation tasks
- [Wake-up Mechanism Design](./docs/plans/2026-02-21-wake-up-mechanism-design.md)
- [Upgrade Plan](./docs/tg-agent-upgrade-plan.md)
