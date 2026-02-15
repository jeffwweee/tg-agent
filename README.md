# tg-agent

Telegram ↔ Claude Code Bridge - Remote control interface for Claude CLI.

Send messages to Claude Code CLI from Telegram and receive responses asynchronously.

## Features

- Send messages to Claude from Telegram
- Receive Claude responses with proper markdown formatting
- Typing indicator while Claude processes
- Message chunking for long responses
- Built-in commands (/clear, /stop, /status)
- Retry logic with exponential backoff
- Health monitoring endpoints

## Architecture

```
Telegram → Cloudflared Tunnel → Node Bridge → tmux → Claude Code
                                              ↓
Telegram ← Bot API ← Stop Hook ←──────────────┘
```

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your bot token and user ID
```

### 3. Start Services

```bash
# Start server with tunnel
./bin/start.sh -d -t

# Set webhook
./bin/webhook.sh set --tunnel
```

### 4. Configure Claude Hook

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/tg-agent/hooks/send-to-telegram.mjs"
          }
        ]
      }
    ]
  }
}
```

## Commands

| Command | Action |
|---------|--------|
| `message` | Send message to Claude |
| `/reset` | Clear context and return to workspace |
| `/clear` | Clear Claude screen |
| `/stop` | Cancel current operation |
| `/status` | Check bridge status |
| `/help` | Show commands |

## Project Structure

```
tg-agent/
├── bin/                    # Startup scripts
│   ├── start.sh           # Service management
│   └── webhook.sh         # Webhook management
├── docs/                   # Documentation
├── hooks/                  # Claude Code hooks
│   └── send-to-telegram.mjs
├── src/
│   ├── server/            # Fastify server
│   ├── telegram/          # Bot API client
│   ├── tmux/              # tmux integration
│   ├── state/             # State management
│   └── utils/             # Utilities
├── logs/                   # Log files
└── workspace/             # Working directory
```

## Service Management

```bash
# Start services
./bin/start.sh -d -t        # Server + tunnel (daemon)

# Stop services
./bin/start.sh -s

# Check status
./bin/start.sh --status

# View logs
./bin/start.sh --logs
```

## Telegram Bot Setup

1. Message @BotFather on Telegram
2. Create new bot: `/newbot`
3. Copy token to `.env` as `TELEGRAM_BOT_TOKEN`

### Get Your User ID

1. Message @userinfobot on Telegram
2. Add your ID to `TELEGRAM_ALLOWED_USERS` in `.env`

## Documentation

- [Deployment Guide](docs/deployment.md) - Production deployment
- [API Reference](docs/api-reference.md) - Endpoint documentation

## Development

```bash
# Development server with hot reload
npm run dev

# Type checking
npm run typecheck

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Requirements

- Node.js 20+
- tmux
- cloudflared (for tunnel)
- Telegram Bot Token

## License

MIT

