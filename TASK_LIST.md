# tg-agent Task List

**Sprint**: MVP Hardening
**Last Updated**: 2026-02-14

---

## Sprint Goals

1. Improve message formatting for Telegram
2. Add typing indicator support
3. Error handling and recovery
4. Prepare for production use

---

## In Progress

| Task | Assignee | Status | Notes |
|------|----------|--------|-------|
| - | - | - | No tasks in progress |

---

## Pending (Prioritized)

### Phase 3: Formatting & UX

| # | Task | Effort | Priority | Dependencies |
|---|------|--------|----------|--------------|
| 1 | Improve markdown conversion (Claude → Telegram) | M | High | - |
| 2 | Add typing indicator while Claude responds | S | Medium | - |
| 3 | Better code block formatting | S | Medium | - |
| 4 | Handle long messages (chunking) | M | Medium | - |

### Phase 5: Hardening

| # | Task | Effort | Priority | Dependencies |
|---|------|--------|----------|--------------|
| 5 | Add unit tests for core modules | L | High | - |
| 6 | Error recovery for failed Telegram sends | M | High | - |
| 7 | Cloudflared tunnel reconnection logic | M | Medium | - |
| 8 | Health check endpoint improvements | S | Low | - |
| 9 | Add request timeout handling | S | Medium | - |
| 10 | Logging improvements | S | Low | - |

### Phase 4: Scheduling (Deferred)

| # | Task | Effort | Priority | Dependencies |
|---|------|--------|----------|--------------|
| 11 | Design scheduler architecture | M | Low | - |
| 12 | Implement node-cron integration | M | Low | #11 |
| 13 | Add schedule storage (SQLite/JSON) | M | Low | #11 |
| 14 | Implement /schedule commands | L | Low | #12, #13 |

---

## Blocked

| Task | Blocker | Owner | Status |
|------|---------|-------|--------|
| - | - | - | - |

---

## Completed This Sprint

| Task | Completed | Notes |
|------|-----------|-------|
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
