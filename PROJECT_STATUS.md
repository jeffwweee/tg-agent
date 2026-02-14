# tg-agent Project Status

**Last Updated**: 2026-02-14
**Version**: 0.1.0

## Current Phase: Phase 2 Complete (MVP Working)

### Completed Phases

| Phase | Description | Status | Completion Date |
|-------|-------------|--------|-----------------|
| Phase 1 | Webhook + tmux injection | ✅ Complete | 2026-02-14 |
| Phase 2 | Stop hook replies | ✅ Complete | 2026-02-14 |
| Phase 3 | Formatting + typing indicator | 🔲 Pending | - |
| Phase 4 | Scheduling | 🔲 Deferred | - |
| Phase 5 | Hardening | 🔲 Pending | - |

---

## Working Features

### Core Functionality ✅
- [x] Telegram webhook endpoint (`/telegram/webhook`)
- [x] User verification (allowed users list)
- [x] tmux prompt injection
- [x] State file management (chat_id, pending)
- [x] Stop hook for async responses
- [x] Transcript parsing (JSONL format)
- [x] Text content extraction (filters thinking/tool_use)

### Commands ✅
- [x] `/start` - Welcome message
- [x] `/help` - Command list
- [x] `/clear` - Clear Claude screen
- [x] `/stop` - Cancel operation
- [x] `/status` - Bridge status check
- [x] Plain text messages - Sent to Claude

### Infrastructure ✅
- [x] Fastify server with env validation
- [x] Cloudflared tunnel support
- [x] Telegram Bot API integration
- [x] Atomic file writes for state

---

## Known Issues & Fixes Applied

| Issue | Fix | Status |
|-------|-----|--------|
| Enter sent as literal text | Separate send-keys commands | ✅ Fixed |
| "Done" instead of response | Read transcript_path from stdin | ✅ Fixed |
| Wrong response (1 message late) | Added 500ms delay for disk flush | ✅ Fixed |
| [Tool:Bash] in responses | Filter for text blocks only | ✅ Fixed |

---

## Technical Debt

- [ ] Add proper TypeScript types for transcript entries
- [ ] Add unit tests
- [ ] Add error handling for edge cases
- [ ] Improve markdown formatting for Telegram
- [ ] Add logging to hook script

---

## Configuration Required

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | Yes |
| `TELEGRAM_ALLOWED_USERS` | Comma-separated user IDs | Yes |
| `TMUX_SESSION_NAME` | tmux session name (default: claude) | No |
| `PORT` | Server port (default: 3000) | No |
| `STATE_DIR` | State files directory | No |
| `PENDING_TIMEOUT_MS` | Pending message timeout | No |

---

## Deployment Checklist

- [x] Clone repository
- [x] Install dependencies (`npm install`)
- [x] Create `.env` file
- [x] Configure Stop hook in Claude settings
- [x] Start cloudflared tunnel
- [x] Set Telegram webhook
- [x] Start bridge server

---

## Next Steps

1. **Phase 3**: Formatting improvements
   - Better markdown conversion
   - Typing indicator while Claude responds
   - Message chunking for long responses

2. **Phase 5**: Hardening
   - Error recovery
   - Reconnection logic
   - Health monitoring

3. **Phase 4**: Scheduling (deferred per user request)
   - node-cron integration
   - SQLite/JSON storage for schedules
   - Independent from Claude workflow
