# Progress: tg-agent

## Current State
- **Working on**: None - FEAT-017 Phase 1 complete
- **Last commit**: FEAT-017 Selection list support (Phase 1 MVP)
- **Server**: `npm run start:dev` (port 3000)
- **Clean state**: All tests passing (48 tests), typecheck clean
- **Known issues**: None

## Session Log

### 2026-02-16 Session #6 (Current)
**Accomplished:**
- FEAT-017: Selection List Support (Phase 1 - Core Single-Select MVP)
- Created `src/state/selection.ts` - Selection state management
- Created `src/telegram/selection.ts` - Selection UI components
- Modified `hooks/permission-request.mjs` - Added AskUserQuestion tool handling
- Modified `src/server/routes/telegram.ts` - Added selection callback handlers

**Left off:**
- Phase 1 complete and passing
- Phase 2 (enhanced multi-select) and Phase 3 (custom input polish) can be added later

**Next:**
- Manual testing with real AskUserQuestion tool
- Additional edge case testing if needed

---

### 2026-02-15 Session #5
**Accomplished:**
- MVP Hardening sprint completed
- All core features verified and passing
- Production startup scripts finalized
- Documentation updated

**Left off:**
- Project is in production-ready state
- No active work in progress

**Next:**
- FEAT-011: Send pictures to Claude (when prioritized)
- FEAT-013: Scheduled messages (deferred)

---

### 2026-02-15 Session #4
**Accomplished:**
- Tool approval flow with inline keyboards
- Permission state management
- Callback query handling
- Production startup scripts (bin/start.sh, bin/webhook.sh)
- Bot commands sync (bin/commands.sh)

**Left off:**
- All Phase 5 & 6 complete
- Ready for production

**Next:**
- Final verification and cleanup

### 2026-02-15 Session #3
**Accomplished:**
- Typing indicator implementation
- Message chunking for long responses
- Code block formatting with language labels
- Health check endpoint improvements

**Left off:**
- Phase 3 & 4 complete
- Starting Phase 5 (Hardening)

**Next:**
- Tool approval flow
- Production prep

### 2026-02-14 Session #2
**Accomplished:**
- Stop hook replies working
- Markdown conversion (Claude → Telegram)
- Error handling improvements
- Fixed tmux Enter key issue
- Fixed transcript reading

**Left off:**
- Phase 2 complete
- Starting Phase 3 (Formatting)

**Next:**
- Typing indicator
- Message chunking

### 2026-02-14 Session #1
**Accomplished:**
- Project initialization
- Webhook endpoint setup
- tmux prompt injection
- State file management
- Basic message flow

**Left off:**
- Phase 1 complete
- Ready for Stop hook implementation

**Next:**
- Implement Stop hook for async responses

---

## Quick Reference

### Start Services
```bash
# Development
npm run start:dev

# With tunnel
./bin/start.sh -d -t

# Set webhook
./bin/webhook.sh set --tunnel
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
- `permissions/` - Pending tool approvals
- `selections/` - Pending selection requests

---

_Project initialized 2026-02-14_
_MVP completed 2026-02-15_
_Selection support added 2026-02-16_
