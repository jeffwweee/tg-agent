# tg-agent

Telegram ↔ Claude Code Bridge - Remote control interface for Claude CLI.

## Overview

Send messages to Claude Code CLI from Telegram and receive responses asynchronously.

## Architecture

```
Telegram → Cloudflared Tunnel → Node Bridge → tmux → Claude Code
                                              ↓
Telegram ← Bot API ← Stop Hook ←──────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- tmux
- cloudflared (for tunnel)
- Telegram Bot Token (from @BotFather)

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment config:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your values

4. Start development server:
   ```bash
   npm run dev
   ```

### Telegram Bot Setup

1. Message @BotFather on Telegram
2. Create new bot: `/newbot`
3. Copy the token to `.env`

### Get Your User ID

1. Message @userinfobot on Telegram
2. Add your ID to `TELEGRAM_ALLOWED_USERS` in `.env`

### Cloudflared Tunnel

```bash
cloudflared tunnel create tg-agent
cloudflared tunnel run tg-agent --url http://localhost:3000
```

Set webhook:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-tunnel-url/telegram/webhook"}'
```

## Commands

| Command | Action |
|---------|--------|
| `message` | Send message to Claude |
| `/clear` | Clear Claude screen |
| `/stop` | Cancel current operation |
| `/status` | Check bridge status |
| `/schedule add` | Add scheduled job |
| `/schedule list` | List scheduled jobs |
| `/schedule remove` | Remove scheduled job |

## Project Structure

```
tg-agent/
├── src/
│   ├── server/        # Fastify server and routes
│   ├── telegram/      # Bot API client and utilities
│   ├── tmux/          # tmux integration
│   ├── state/         # State file management
│   ├── scheduler/     # Cron job scheduler
│   └── utils/         # Shared utilities
├── hooks/             # Claude Code stop hooks
├── workspace/         # Working directory
└── logs/              # Log files
```

## License

MIT
