# Project Context: tg-agent

## Quick Reference
- **Tech**: Node.js 20+, TypeScript, Fastify, Telegram Bot API, tmux, cloudflared
- **Commands**:
  - `npm run start:dev` - Development server with hot reload
  - `npm run dev` - Same as above (tsx watch)
  - `npm run build` - Compile TypeScript to dist/
  - `npm start` - Production server (from dist/)
  - `npm test` - Run Vitest tests
  - `npm run typecheck` - Type checking only
- **Port**: 3000 (configurable via PORT env var)
- **Env vars**:
  - `TELEGRAM_BOT_TOKEN` (required)
  - `TELEGRAM_ALLOWED_USERS` (required)
  - `TMUX_SESSION_NAME` (default: claude)
  - `PORT` (default: 3000)
  - `STATE_DIR` (default: ~/.claude)

## Architecture

```
Telegram → Cloudflared Tunnel → Fastify Server → tmux → Claude Code
                     ↑                                      ↓
                 Stop Hook ← sends responses via API ←─────┘

src/
├── server/
│   ├── index.ts           # Fastify app entry
│   └── routes/
│       ├── telegram.ts    # Webhook handler
│       └── health.ts      # Health endpoints
├── telegram/
│   ├── client.ts          # Telegram API client
│   ├── markdown.ts        # Markdown → Telegram HTML
│   └── types.ts           # Telegram API types
├── tmux/
│   └── inject.ts          # tmux prompt injection
├── state/
│   └── files.ts           # Atomic file state management
├── config/
│   └── commands.ts        # Bot command definitions
└── utils/
    ├── logger.ts          # Pino logger
    └── retry.ts           # Retry with backoff

hooks/
└── send-to-telegram.mjs   # Claude Stop hook

bin/
├── start.sh               # Service management
├── webhook.sh             # Webhook setup
└── commands.sh            # Sync bot commands
```

## Testing
- **Unit**: `npm test` (Vitest)
- **Coverage**: `npm run test:coverage`
- **Watch**: `npm run test:watch`
- **Current**: 48 tests passing

### Test Files
- `tests/retry.test.ts` - Retry logic with exponential backoff
- `tests/client.test.ts` - Telegram API client
- `tests/markdown.test.ts` - Markdown conversion

## Known Patterns

### Message Flow
1. Telegram sends webhook to `/telegram/webhook`
2. Validate user against `TELEGRAM_ALLOWED_USERS`
3. Inject message into tmux session via `src/tmux/inject.ts`
4. Claude processes in tmux
5. Stop hook (`hooks/send-to-telegram.mjs`) reads transcript
6. Response sent back via Telegram API

### State Files (in ~/.claude/)
- `telegram_chat_id` - Active chat ID for responses
- `telegram_pending` - Pending message state
- `telegram_permission` - Tool approval pending state

### Error Handling
- All Telegram API calls use retry with exponential backoff
- 30s timeout with AbortController
- Graceful degradation on failures

### Message Formatting
- Claude markdown → Telegram HTML
- Long messages chunked at 4096 chars
- Code blocks get language labels
- Truncation for very long code

## Current Sprint Focus

**MVP Hardening: COMPLETE** ✅

Project is production-ready. Future work:
- FEAT-011: Send pictures to Claude (P2)
- FEAT-013: Scheduled messages (P3, deferred)
- FEAT-012: Tunnel auto-reconnection (P3)

## Debugging

### Check if server is running
```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/detailed
```

### Check tmux session
```bash
tmux attach -t claude
```

### View logs
```bash
tail -f logs/*.log
```

### Test Stop hook manually
```bash
echo '{"transcript_path":"~/.claude/transcript.jsonl"}' | node hooks/send-to-telegram.mjs
```
