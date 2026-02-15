# tg-agent API Reference

## Endpoints

### `GET /`

Root endpoint with API information.

**Response:**
```json
{
  "name": "tg-agent",
  "description": "Telegram ↔ Claude Code Bridge",
  "version": "0.1.0",
  "endpoints": {
    "health": "/health",
    "healthDetailed": "/health/detailed",
    "webhook": "/telegram/webhook"
  }
}
```

---

### `GET /health`

Basic health check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-15T12:00:00.000Z",
  "version": "0.1.0"
}
```

---

### `GET /health/detailed`

Detailed health check with component status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-15T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600.5,
  "checks": {
    "tmux": {
      "status": "ok",
      "details": "Session \"claude\" running"
    },
    "telegram": {
      "status": "ok",
      "details": "API reachable"
    },
    "pending": {
      "status": "ok",
      "details": "No pending messages"
    }
  }
}
```

**Status Values:**
- `ok` - Component is healthy
- `degraded` - Component is working but with issues
- `error` - Component is failing

---

### `POST /telegram/webhook`

Telegram webhook endpoint. Receives updates from Telegram.

**Request Body:** Telegram Update object

**Response:**
```json
{ "ok": true }
```

**Commands:**
| Command | Description |
|---------|-------------|
| `/start` | Show welcome message |
| `/help` | Show available commands |
| `/reset` | Clear context and return to workspace |
| `/clear` | Clear Claude screen |
| `/stop` | Cancel current operation |
| `/status` | Check bridge status |

**Plain text messages** are forwarded to Claude.

---

### `GET /telegram/webhook`

Get webhook info (for debugging).

**Response:** Telegram WebhookInfo object

---

## Telegram Bot Commands

### `/start`

Initialize interaction with the bot.

**Response:**
```
Hello [Name]! I'm your Claude Code bridge.

Send me a message and I'll pass it to Claude. Use /help for commands.
```

---

### `/help`

Show available commands.

**Response:**
```
*Claude Code Bridge Commands*

Just send a message to pass it to Claude.

*Commands:*
/clear - Clear Claude's screen
/stop - Cancel current operation
/status - Check bridge status
/help - Show this help
```

---

### `/clear`

Clear Claude's terminal screen in tmux.

**Response:**
```
✅ Screen cleared
```

---

### `/stop`

Cancel the current Claude operation.

**Response:**
```
⏹️ Stopped
```

---

### `/reset`

Clear Claude's context and return to default workspace.

**Response:**
```
🔄 *Resetting context...*

Context cleared ✓
Workspace: `~/jef/projects/dev-workspace`

Ready for new tasks!
```

---

### `/status`

Check the bridge status.

**Response:**
```
*Bridge Status*

tmux: ✅ Running
Session: claude
Windows: 1

Pending: ⚪ No
```

---

## State Files

Located in `~/.claude/` (or `STATE_DIR`):

### `telegram_chat_id`

Stores the current chat ID for responses.

```json
{
  "chatId": 123456789,
  "updatedAt": 1708000000000
}
```

### `telegram_pending`

Tracks pending messages waiting for Claude response.

```json
{
  "chatId": 123456789,
  "userId": 123456789,
  "messageId": 42,
  "timestamp": 1708000000000,
  "text": "original message"
}
```

---

## Error Handling

The API returns standard HTTP status codes:

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized (invalid user) |
| 500 | Internal Server Error |

Error responses include a description:
```json
{
  "error": "Error description"
}
```

---

## Rate Limiting

Telegram API has rate limits. The client implements:

- **Retry with exponential backoff** for transient errors
- **30-second timeout** per request
- **Max 3 retries** for failed requests

Retryable errors:
- Network errors (ECONNREFUSED, ETIMEDOUT)
- HTTP 429 (Rate limit)
- HTTP 5xx (Server errors)
