# Setup Guide

Complete setup guide for tg-agent v2.

## Prerequisites

### Required

- **Node.js 20+** - Check with `node --version`
- **Redis** - Any recent version
- **Telegram Bot Token** - Get from [@BotFather](https://t.me/BotFather)

### Optional

- **Domain with HTTPS** - For production webhook
- **Process Manager** - PM2, systemd, or Docker

---

## Step 1: Get Telegram Bot Token

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Send `/newbot`
3. Follow the prompts to name your bot
4. Save the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Get Your User ID

1. Open [@userinfobot](https://t.me/userinfobot)
2. Send any message
3. Save your user ID (a number like `123456789`)

---

## Step 2: Install and Configure

```bash
# Clone or navigate to project
cd tg-agent

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### Edit `.env`

```bash
# Required
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_ALLOWED_USERS=123456789

# Optional (with defaults)
REDIS_URL=redis://localhost:6379
GATEWAY_PORT=3000
LOG_LEVEL=info
```

---

## Step 3: Start Redis

### macOS (Homebrew)
```bash
brew install redis
brew services start redis
```

### Ubuntu/Debian
```bash
sudo apt install redis-server
sudo systemctl start redis
```

### Docker
```bash
docker run -d --name redis -p 6379:6379 redis:alpine
```

### Verify Redis
```bash
redis-cli ping
# Should return: PONG
```

---

## Step 4: Setup Inbox

```bash
# Create Redis consumer group (one-time setup)
npm run setup:inbox
```

Expected output:
```
Created consumer group "tg-consumer" for stream "tg:inbox"
```

---

## Step 5: Run tg-agent

### Development
```bash
# Run both gateway and MCP
npm run dev

# Or run separately
npm run dev:gateway  # Terminal 1
npm run dev:mcp      # Terminal 2
```

### Production
```bash
npm run build
npm start
```

---

## Step 6: Configure Webhook

### Local Development (with ngrok)

```bash
# Install ngrok
brew install ngrok  # macOS
# or download from ngrok.com

# Create tunnel
ngrok http 3000
```

Note the HTTPS URL (e.g., `https://abc123.ngrok.io`).

### Set Webhook

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://abc123.ngrok.io/telegram/webhook"
  }'
```

### Production (with domain)

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/telegram/webhook",
    "secret_token": "your-random-secret-here"
  }'
```

Add the secret to `.env`:
```bash
TELEGRAM_WEBHOOK_SECRET=your-random-secret-here
```

### Verify Webhook

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"
```

---

## Step 7: Test

### Test Gateway Health

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2024-02-21T00:00:00.000Z"}
```

### Send Test Message

1. Open your bot in Telegram
2. Send `/start`
3. Send any message

### Check Gateway Logs

You should see:
```
[INFO] Message added to inbox {"inboxId":"...","chatId":123456789}
```

---

## Step 8: Claude Code Integration

### Edit MCP Settings

Location depends on your setup:
- **VS Code**: `~/.claude/mcp_settings.json`
- **Claude Desktop**: Claude → Settings → Developer → MCP

Add the server:

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

### Restart Claude Code

The `tg-agent` tools should now appear in your available tools.

---

## Troubleshooting

### "Configuration errors: TELEGRAM_BOT_TOKEN is required"
- Check `.env` file exists and has correct values
- Verify no extra spaces around `=`

### "Redis connection refused"
- Ensure Redis is running: `redis-cli ping`
- Check `REDIS_URL` in `.env`

### "User not in allowlist"
- Add your Telegram user ID to `TELEGRAM_ALLOWED_USERS`
- Get your ID from [@userinfobot](https://t.me/userinfobot)

### Webhook returns 401
- Check `TELEGRAM_WEBHOOK_SECRET` matches webhook config
- Remove secret from both if not using

### No messages from telegram_poll
- Verify webhook is set: `getWebhookInfo`
- Check gateway logs for incoming messages
- Ensure Redis consumer group exists: `npm run setup:inbox`

### MCP tools not appearing
- Check JSON syntax in MCP settings
- Verify path to `dist/index.js` is absolute
- Check Claude Code logs for errors

---

## Production Deployment

### Using PM2

```bash
npm install -g pm2

# Start
pm2 start dist/index.js --name tg-agent

# Logs
pm2 logs tg-agent

# Restart
pm2 restart tg-agent
```

### Using Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/index.js"]
```

```bash
docker build -t tg-agent .
docker run -d \
  -p 3000:3000 \
  -e TELEGRAM_BOT_TOKEN=... \
  -e TELEGRAM_ALLOWED_USERS=... \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  tg-agent
```

### Environment Checklist

- [ ] `TELEGRAM_BOT_TOKEN` set
- [ ] `TELEGRAM_ALLOWED_USERS` set
- [ ] Redis accessible
- [ ] Webhook URL is HTTPS
- [ ] Webhook secret configured
- [ ] Gateway port open
- [ ] Logs being captured
