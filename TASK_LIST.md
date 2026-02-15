# tg-agent Task List

**Sprint**: MVP Hardening
**Last Updated**: 2026-02-15

---

## Sprint Goals

1. ~~Improve message formatting for Telegram~~ ✅
2. ~~Add typing indicator support~~ ✅
3. ~~Error handling and recovery~~ ✅
4. ~~Prepare for production use~~ ✅

---

## In Progress

| Task | Assignee | Status | Notes |
|------|----------|--------|-------|
| - | - | - | No tasks in progress |

---

## Pending (Prioritized)

### Phase 4: Scheduling (Deferred)

| # | Task | Effort | Priority | Dependencies |
|---|------|--------|----------|--------------|
| 11 | Design scheduler architecture | M | Low | - |
| 12 | Implement node-cron integration | M | Low | #11 |
| 13 | Add schedule storage (SQLite/JSON) | M | Low | #11 |
| 14 | Implement /schedule commands | L | Low | #12, #13 |

### Future Features

| Feature | Effort | Priority |
|---------|--------|----------|
| Tool approval from Telegram | L | Medium |
| Cloudflared tunnel reconnection | M | Low |
| Logging improvements | S | Low |

---

## Blocked

| Task | Blocker | Owner | Status |
|------|---------|-------|--------|
| - | - | - | - |

---

## Completed This Sprint

| Task | Completed | Notes |
|------|-----------|-------|
| Production startup scripts | 2026-02-15 | bin/start.sh, bin/webhook.sh |
| Documentation | 2026-02-15 | README, deployment guide, API reference |
| Add unit tests for core modules | 2026-02-15 | Vitest setup, 48 tests for retry, client, markdown |
| Error recovery for failed Telegram sends | 2026-02-15 | Retry with exponential backoff |
| Add request timeout handling | 2026-02-15 | 30s timeout with AbortController |
| Health check endpoint improvements | 2026-02-15 | Detailed /health/detailed with component checks |
| Better code block formatting | 2026-02-15 | Language labels, truncation for long code |
| Handle long messages (chunking) | 2026-02-15 | Continuation markers, percentage remaining |
| Add typing indicator while Claude responds | 2026-02-15 | Periodic typing until response sent |
| Improve markdown conversion (Claude → Telegram) | 2026-02-15 | Bold, italic, code, links, proper escaping |
| Fix tmux Enter key | 2026-02-14 | Separate send-keys commands |
| Fix Stop hook transcript reading | 2026-02-14 | Read from stdin JSON input |
| Fix response timing | 2026-02-14 | Added 500ms delay |
| Filter response content | 2026-02-14 | Text blocks only |

---

## Handover Notes

### Quick Start Commands

```bash
# Start server
cd source-code/tg-agent
npm run start:dev

# Start tunnel
cloudflared tunnel --url http://localhost:3000

# Set webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<tunnel-url>/telegram/webhook"}'
```

### Key Files

- `src/server/index.ts` - Main server entry
- `src/server/routes/telegram.ts` - Webhook handler
- `src/tmux/inject.ts` - tmux integration
- `src/state/files.ts` - State management
- `hooks/send-to-telegram.mjs` - Stop hook

### State Files

Located in `~/.claude/`:
- `telegram_chat_id` - Current chat ID
- `telegram_pending` - Pending message state

---

## Effort Legend

- **XS**: < 2 hours
- **S**: 2-4 hours
- **M**: 4-8 hours (1 day)
- **L**: 2-3 days
- **XL**: 1 week
