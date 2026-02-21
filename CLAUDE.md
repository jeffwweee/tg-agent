# CLAUDE.md

Instructions for Claude Code when working with tg-agent v2.

## Project Overview

tg-agent is a **Telegram Gateway + MCP Server** that enables Claude Code to communicate via Telegram. It replaces the v1 tmux/transcript-scraping architecture with a clean MCP-based polling approach.

**Key Features:**
- Receive Telegram messages via webhook
- Store messages in Redis Streams inbox
- Provide MCP tools for Claude Code to poll, send, and ack messages
- Auto-chunking for long messages
- 12-hour message lease for long-running sessions

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

**Components:**
- **Gateway** — Express server receiving Telegram webhooks
- **Redis Streams** — Durable inbox with consumer groups
- **MCP Server** — Provides tools for Claude Code

## Project Structure

```
tg-agent/
├── .claude/
│   └── skills/           # Project-level skills
├── docs/
│   ├── plans/            # Design documents
│   └── tg-agent-upgrade-plan.md
├── src/
│   ├── config/           # Configuration module
│   ├── gateway/          # Express webhook server
│   │   └── routes/       # Route handlers
│   ├── inbox/            # Redis Streams client
│   ├── mcp/              # MCP server
│   │   └── tools/        # Tool implementations
│   ├── telegram/         # Telegram API client
│   │   ├── chunk.ts      # Message chunking
│   │   └── escape.ts     # MarkdownV2 escaping
│   ├── utils/            # Shared utilities
│   └── index.ts          # Entry point
├── tests/
│   └── integration/      # E2E tests
├── tasks.json            # Implementation tasks
└── CLAUDE.md             # This file
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `telegram_poll` | Fetch pending messages from inbox |
| `telegram_send` | Send reply (auto-chunks if > 4000 chars) |
| `telegram_ack` | Acknowledge processed messages |
| `telegram_send_typing` | Show typing indicator |

## Development Workflow

### Setup

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Setup Redis consumer group (one-time)
npm run setup:inbox

# Development mode (gateway + MCP)
npm run dev

# Gateway only
npm run dev:gateway

# MCP only
npm run dev:mcp
```

### Building

```bash
npm run build
npm start
```

### Testing

```bash
npm test
npm run test:integration
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | Required |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook validation secret | Optional |
| `TELEGRAM_ALLOWED_USERS` | Comma-separated user IDs | Required |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `INBOX_STREAM_KEY` | Redis stream key | `tg:inbox` |
| `INBOX_CONSUMER_GROUP` | Consumer group name | `tg-consumer` |
| `MESSAGE_LEASE_MS` | Message lease duration | `43200000` (12h) |
| `GATEWAY_PORT` | Gateway server port | `3000` |

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

## Design Documents

- [Wake-up Mechanism Design](docs/plans/2026-02-21-wake-up-mechanism-design.md)
- [Upgrade Plan](docs/tg-agent-upgrade-plan.md)

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Wake-up | Native polling via MCP | No tmux dependency |
| Inbox | Redis Streams | Already running, native consumer groups |
| Lease | 12 hours | Long sessions with headroom |
| Messages | Accumulate until polled | Multi-message context |
| Reply | Consolidated, auto-chunked | Simpler for Claude Code |

## Conventions

- **Language:** TypeScript with strict mode
- **Runtime:** Node.js 20+
- **Testing:** Vitest
- **Commits:** Conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- **Branches:** `feature/`, `fix/`, `docs/`, `refactor/`

## Message Flow

```
1. User sends message(s) to Telegram bot
2. Telegram → webhook → Gateway → Redis inbox
3. Claude Code calls telegram_poll
4. Claude Code processes messages
5. Claude Code calls telegram_send(reply)
6. Claude Code calls telegram_ack
7. Loop to step 3
```

## Current Status

All tasks complete. See `tasks.json` for full implementation history.

**Completed Phases:**
- Foundation (V2-001, V2-002, V2-003, V2-010)
- Gateway (V2-004)
- MCP Server (V2-005, V2-006, V2-007, V2-008)
- Integration (V2-009, V2-011)
- Docs (V2-012)
