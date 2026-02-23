# Multi-Session telegram_reply Implementation

**Date:** 2026-02-23
**Status:** In Progress - Issues Encountered
**Branch:** feature/V2-017-multi-session-telegram-reply
**Related Tasks:** V2-017, V2-020

## Overview

Implementation of multi-session/multi-bot support with a new `telegram_reply` MCP tool that provides stateful conversation handling.

## Features Implemented

### 1. Session Configuration

**File:** `dev-workspace/config/sessions.json`

```json
{
  "sessions": {
    "SESSION_X01": {
      "name": "RX-78-1",
      "bot_token_env": "BOT_TOKEN_02",
      "bot_username": "rx78_p_bot",
      "chat_ids": [195061634],
      "allowed_users": [195061634],
      "tmux_session": "session-x01",
      "tmux_wake_command": "/telegram-reply"
    },
    "SESSION_X02": {
      "name": "RX-78-2",
      "bot_token_env": "BOT_TOKEN_01",
      "bot_username": "rx78_p2_bot",
      "chat_ids": [195061634],
      "allowed_users": [195061634],
      "tmux_session": "session-x02",
      "tmux_wake_command": "/telegram-reply"
    }
  },
  "default": "SESSION_X01"
}
```

### 2. Session Config Loader

**File:** `src/config/sessions.ts`

- `loadSessionsConfig()` — Loads sessions from workspace-level config
- `getSessionId()` — Returns current session ID from `TG_SESSION_ID` env var
- `getSessionConfig(sessionId)` — Gets config for specific session
- `getSessionBotToken(sessionId)` — Gets bot token for session
- `findSessionByBotToken(botToken)` — Finds session by bot token
- `isChatAllowed(chatId, sessionId)` — Validates chat_id against session
- `isUserAllowed(userId, sessionId)` — Validates user_id against session

### 3. Session-Specific Webhooks

**File:** `src/gateway/server.ts`

New endpoint: `POST /telegram/webhook/:sessionId`

Routes webhooks directly to specific session:
- `@rx78_p_bot` → `/telegram/webhook/SESSION_X01`
- `@rx78_p2_bot` → `/telegram/webhook/SESSION_X02`

### 4. Redis Namespacing

**File:** `src/inbox/client.ts`

- Stream key: `tg:inbox:{session_id}` (e.g., `tg:inbox:SESSION_X01`)
- Consumer name: `consumer-{session_id}` (consistent per session)
- Consumer group: `tg-consumer` (shared across sessions)

### 5. telegram_reply MCP Tool

**File:** `src/mcp/tools/reply.ts`

Stateful conversation tool:
- `telegram_reply()` — Polls messages, stores state
- `telegram_reply({text: "..."})` — Sends reply, acks messages, clears state

State stored in `/tmp/tg-conversation-{session_id}.json`

### 6. Tmux Session Check

**File:** `src/gateway/tmux-injector.ts`

- `sessionExists()` — Checks if tmux session exists
- Gateway rejects messages if tmux session not found
- **Notification spam prevention:** Only sends error notification once per session downtime

### 7. Telegram Client Updates

**File:** `src/telegram/client.ts`

- `setMessageReaction()` — Adds emoji reactions to messages
- Constructor accepts string (bot token) or options object

### 8. /telegram-reply Command

**File:** `dev-workspace/.claude/commands/telegram-reply.md`

User-invocable command:
- `/telegram-reply` — Polls for messages
- `/telegram-reply <text>` — Sends reply

## Setup Instructions

### 1. Environment Variables

Create `.env` file:

```bash
# Bot tokens
BOT_TOKEN_01=<token-for-rx78_p2_bot>
BOT_TOKEN_02=<token-for-rx78_p_bot>

# Session config
TG_SESSION_ID=SESSION_X01
TG_SESSIONS_CONFIG=/path/to/dev-workspace/config/sessions.json

# Redis
REDIS_URL=redis://localhost:6379

# Gateway
GATEWAY_PORT=3000
```

### 2. Redis Setup

```bash
# Ensure Redis is running
redis-server

# Consumer groups are created automatically on first poll
```

### 3. Telegram Webhook Setup

```bash
# For @rx78_p_bot (SESSION_X01)
curl -F "url=https://your-domain.com/telegram/webhook/SESSION_X01" \
  https://api.telegram.org/bot<BOT_TOKEN_01>/setWebhook

# For @rx78_p2_bot (SESSION_X02)
curl -F "url=https://your-domain.com/telegram/webhook/SESSION_X02" \
  https://api.telegram.org/bot<BOT_TOKEN_02>/setWebhook
```

### 4. Start Gateway

```bash
TG_SESSIONS_CONFIG=/path/to/config/sessions.json npm run dev:gateway
```

### 5. Cloudflare Tunnel (for webhooks)

```bash
# Ensure tunnel is running
cloudflared tunnel run x20a
```

## Issues Encountered

### Issue 1: Consumer Name Timestamp Bug

**Problem:** `InboxClient` created consumer names with `Date.now()`:
```typescript
this.consumerName = `consumer-${this.sessionId}-${process.pid}-${Date.now()}`;
```

**Impact:** Each MCP poll created a NEW consumer, which could only read NEW messages (not pending ones from previous consumers).

**Fix:** Changed to consistent consumer name:
```typescript
this.consumerName = `consumer-${this.sessionId}`;
```

**Status:** Fixed in code, but MCP server needs restart to apply.

### Issue 2: telegram_poll Returns 0 Messages

**Problem:** After restart, `telegram_poll` still returns empty messages array.

**Symptoms:**
- Messages ARE in Redis streams (verified with `XRANGE`)
- Pending count shows 0 (all messages acked)
- Fresh consumer CAN read messages with `XREADGROUP`

**Possible Causes:**
1. MCP server using cached/old compiled code
2. Consumer group state not matching expected consumer name
3. Session ID mismatch between gateway and MCP server

**Debug Commands:**
```bash
# Check stream length
redis-cli XLEN tg:inbox:SESSION_X01

# Check pending messages
redis-cli XPENDING tg:inbox:SESSION_X01 tg-consumer

# Try reading with expected consumer name
redis-cli XREADGROUP GROUP tg-consumer consumer-SESSION_X01 COUNT 5 STREAMS tg:inbox:SESSION_X01 ">"

# Check compiled code
grep "consumerName" dist/inbox/client.js
```

**Status:** UNRESOLVED - Requires further investigation

### Issue 3: /skill vs /command

**Problem:** Initially tried `/skill telegram-reply` which didn't exist.

**Fix:** Created `/telegram-reply` as a command instead of skill.

**Files:**
- `dev-workspace/.claude/commands/telegram-reply.md` (command)
- `dev-workspace/.claude/skills/telegram-reply/` (skill - also created)

## Files Changed

| File | Change |
|------|--------|
| `src/config/sessions.ts` | NEW - Session config loader |
| `src/mcp/tools/reply.ts` | NEW - telegram_reply tool |
| `src/gateway/server.ts` | Session-specific webhooks, notification spam fix |
| `src/gateway/tmux-injector.ts` | sessionExists() method |
| `src/inbox/client.ts` | Consistent consumer name, session namespacing |
| `src/inbox/types.ts` | Added tgMessageId field |
| `src/mcp/server.ts` | Registered telegram_reply tool |
| `src/telegram/client.ts` | setMessageReaction(), string constructor |
| `.env.example` | Added multi-session vars |
| `dev-workspace/.claude/commands/telegram-reply.md` | NEW - /telegram-reply command |
| `dev-workspace/.claude/skills/telegram-reply/` | NEW - skill files |

## Next Steps

1. **Debug telegram_poll issue:**
   - Verify MCP server is using updated code
   - Check consumer group state in Redis
   - Test with fresh Redis database

2. **Consider alternative approach:**
   - Use XREAD instead of XREADGROUP for simpler message consumption
   - Or implement message claiming with XCLAIM for pending messages

3. **Testing:**
   - Create integration tests for multi-session flow
   - Test consumer group behavior

## Test Results

### Webhook Routing
- ✅ Session-specific webhooks working (`/telegram/webhook/SESSION_X01`)
- ✅ Messages saved to correct Redis streams
- ✅ Reactions and typing indicators working

### MCP Poll
- ❌ Returns 0 messages despite messages in stream
- ❌ Consumer group state unclear

### Redis Verification
```
SESSION_X01 length: 18
SESSION_X02 length: 6
Pending: 0
```

## References

- Design doc: `docs/plans/2026-02-23-multi-session-telegram-reply-design.md`
- Task: V2-017 in `tasks.json`
- Telegram Bot API: https://core.telegram.org/bots/api
- Redis Streams: https://redis.io/docs/data-types/streams/
