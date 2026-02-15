# tg-agent Deployment Guide

This guide covers deploying tg-agent for production use.

## Prerequisites

- Node.js 20+
- tmux
- cloudflared (for tunnel)
- Telegram Bot Token (from @BotFather)

## Quick Start

### 1. Install Dependencies

```bash
cd source-code/tg-agent
npm install
npm run build  # Build TypeScript
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_ALLOWED_USERS=your_telegram_user_id

# Optional
PORT=3000
TMUX_SESSION_NAME=claude
LOG_LEVEL=info
LOG_PRETTY=true
PENDING_TIMEOUT_MS=600000
```

### 3. Configure Claude Code Stop Hook

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

### 4. Start Services

```bash
# Start server only
./bin/start.sh -d

# Start server with tunnel
./bin/start.sh -d -t

# Check status
./bin/start.sh --status

# View logs
./bin/start.sh --logs
```

### 5. Set Webhook

```bash
# Auto-detect tunnel URL
./bin/webhook.sh set --tunnel

# Or manually
./bin/webhook.sh set https://your-domain.com
```

## Service Management

### start.sh Commands

| Command | Description |
|---------|-------------|
| `./bin/start.sh` | Start server in foreground |
| `./bin/start.sh -d` | Start server in background |
| `./bin/start.sh -d -t` | Start server + tunnel in background |
| `./bin/start.sh -s` | Stop all services |
| `./bin/start.sh -r` | Restart all services |
| `./bin/start.sh --status` | Show service status |
| `./bin/start.sh --logs` | Tail all logs |

### webhook.sh Commands

| Command | Description |
|---------|-------------|
| `./bin/webhook.sh info` | Show current webhook info |
| `./bin/webhook.sh set <url>` | Set webhook URL |
| `./bin/webhook.sh set --tunnel` | Auto-detect and set from tunnel |
| `./bin/webhook.sh delete` | Remove webhook |

## Production Deployment

### Systemd Service (Recommended)

Create `/etc/systemd/system/tg-agent.service`:

```ini
[Unit]
Description=tg-agent Telegram Bridge
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/tg-agent
ExecStart=/usr/bin/npm run start:dev
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable tg-agent
sudo systemctl start tg-agent
sudo systemctl status tg-agent
```

### Cloudflare Tunnel (Alternative)

For persistent tunnels, use Cloudflare Tunnel:

```bash
cloudflared tunnel create tg-agent
cloudflared tunnel route dns tg-agent tg-agent.your-domain.com
cloudflared tunnel run tg-agent
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USERS` | Yes | - | Comma-separated user IDs |
| `PORT` | No | 3000 | Server port |
| `TMUX_SESSION_NAME` | No | claude | tmux session name |
| `STATE_DIR` | No | ~/.claude | State files directory |
| `LOG_LEVEL` | No | info | Logging level |
| `PENDING_TIMEOUT_MS` | No | 600000 | Message timeout (10 min) |

## Health Checks

### Basic Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-02-15T12:00:00.000Z",
  "version": "0.1.0"
}
```

### Detailed Health Check

```bash
curl http://localhost:3000/health/detailed
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-02-15T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "tmux": { "status": "ok", "details": "Session \"claude\" running" },
    "telegram": { "status": "ok", "details": "API reachable" },
    "pending": { "status": "ok", "details": "No pending messages" }
  }
}
```

## Troubleshooting

### Messages not being sent

1. Check pending state:
   ```bash
   cat ~/.claude/telegram_pending
   ```

2. Check hook logs:
   ```bash
   ./bin/start.sh --logs
   ```

3. Verify webhook:
   ```bash
   ./bin/webhook.sh info
   ```

### Tunnel issues

1. Check tunnel status:
   ```bash
   ./bin/start.sh --status
   ```

2. Restart tunnel:
   ```bash
   ./bin/start.sh -r -t
   ./bin/webhook.sh set --tunnel
   ```

### Claude not responding

1. Verify tmux session:
   ```bash
   tmux attach -t claude
   ```

2. Check if pending state exists:
   ```bash
   cat ~/.claude/telegram_pending
   ```

## Security Considerations

1. **User Whitelist**: Always set `TELEGRAM_ALLOWED_USERS` to limit who can use the bot

2. **Token Security**: Never commit `.env` file. Use environment variables in production

3. **HTTPS**: Always use HTTPS for webhooks (cloudflared provides this)

4. **Rate Limiting**: Telegram has rate limits. The client includes retry logic with backoff

## Monitoring

### Log Files

- `logs/server.log` - Server output
- `logs/tunnel.log` - Cloudflared output
- `logs/hook.log` - Stop hook debug logs (if enabled)

### Metrics

The `/health/detailed` endpoint provides:
- tmux session status
- Telegram API connectivity
- Pending message state
- Server uptime

## Backup & Recovery

### State Files

Located in `~/.claude/`:
- `telegram_chat_id` - Current chat ID
- `telegram_pending` - Pending message state

### Recovery

If messages are stuck:
```bash
rm ~/.claude/telegram_pending
```
