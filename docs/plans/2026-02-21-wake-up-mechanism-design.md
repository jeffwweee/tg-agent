# Wake-up Mechanism Design

**Date:** 2026-02-21
**Status:** Approved
**Related:** [tg-agent-upgrade-plan.md](../tg-agent-upgrade-plan.md)

---

## Overview

Design for Claude Code's wake-up mechanism in tg-agent v2. Replaces v1's tmux injection + transcript scraping with a clean MCP-based polling approach.

## Goals

- Fast response time (1-5 seconds)
- No tmux dependency (tmux optional for session persistence only)
- Reliable message delivery without paste issues or filesystem wonkiness
- Support for multi-message context (user sends instructions while Claude works)

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Telegram      │────▶│    Gateway      │────▶│     Redis       │
│   (webhook)     │     │   (Express)     │     │   (inbox)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Claude Code   │────▶│   MCP Server    │────▶│  telegram_*     │
│   (polls)       │◀────│   (tools)       │◀────│  tools          │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Components:**
- **Gateway** — Receives webhooks, validates, writes to Redis inbox
- **Redis Streams** — Durable inbox with consumer groups
- **MCP Server** — Provides telegram_poll, telegram_send, telegram_ack tools
- **Claude Code** — Polls inbox via MCP, processes messages, sends replies

---

## MCP Tools

### telegram_poll

Fetch pending messages from inbox.

```typescript
// Input
{
  timeout?: number,  // Long-poll timeout in seconds (default: 5)
  limit?: number     // Max messages to return (default: 10)
}

// Output
{
  messages: [
    {
      message_id: string,
      chat_id: number,
      from_user: { id, username?, first_name? },
      text: string,
      timestamp: string
    }
  ],
  combined_context?: string  // All message texts combined
}
// Or if empty: { messages: [] }
```

### telegram_send

Send reply to Telegram (auto-chunks if > 4000 chars).

```typescript
// Input
{
  chat_id: number,
  text: string,
  parse_mode?: "MarkdownV2" | "HTML" | "Plain"  // default: MarkdownV2
}

// Output
{
  success: boolean,
  message_id?: number,
  chunks_sent?: number  // If chunked
}
```

### telegram_ack

Ack processed messages (only after successful send).

```typescript
// Input
{
  message_ids: string[]
}

// Output
{
  success: boolean,
  acked: number
}
```

### telegram_send_typing

Show typing indicator.

```typescript
// Input
{
  chat_id: number
}
```

---

## Message Flow

### Inbound

```
User sends: "Analyze the auth module"
         → "Focus on the OAuth part"
         → "Also check for security issues"
                    │
                    ▼ (messages accumulate in Redis)
┌─────────────────────────────────────────┐
│ telegram_poll returns ALL pending:      │
│ {                                       │
│   messages: [msg1, msg2, msg3],         │
│   combined_context: "Analyze the auth   │
│                      module\n           │
│                      Focus on OAuth\n   │
│                      Also check..."     │
│ }                                       │
└─────────────────────────────────────────┘
```

### Processing

```
telegram_poll → Claude processes → telegram_send(reply) → telegram_ack → poll again
```

### Outbound

```
Claude Code calls telegram_send(full_response)
                    │
                    ▼
┌─────────────────────────────────────────┐
│ MCP tool handles chunking:              │
│ - Split at 4000 chars (Telegram limit)  │
│ - Preserve markdown boundaries          │
│ - Send chunks sequentially              │
└─────────────────────────────────────────┘
```

---

## Redis Streams Setup

**Stream key:** `tg:inbox`

**Fields per message:**
- `update_id` — Telegram dedupe key
- `chat_id`
- `from_user` — JSON
- `text`
- `timestamp`

**Consumer group (one-time setup):**
```bash
XGROUP CREATE tg:inbox tg-consumer $ MKSTREAM
```

**Core operations:**

| Operation | Command |
|-----------|---------|
| Add message | `XADD tg:inbox * update_id=... chat_id=... text=...` |
| Claim/read | `XREADGROUP GROUP tg-consumer <consumer> COUNT 10 BLOCK 5000 STREAMS tg:inbox >` |
| Ack | `XACK tg:inbox tg-consumer <message_id>` |
| Pending check | `XPENDING tg:inbox tg-consumer` |

---

## Reliability

### Message Lifecycle

```
pending → claimed → acked
                 ↘ failed
```

### Lease & Timeout

- **Lease duration:** 12 hours
- Messages claimed on poll, acked after successful send
- If not acked within lease, auto-requeued via `XCLAIM`

### Deduplication

- Dedupe by Telegram `update_id` before writing to Redis
- Prevents duplicate processing from webhook retries

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Claude crashes mid-task | Message requeues after 12h lease |
| `telegram_send` fails | Retry with exponential backoff; don't ack until success |
| Duplicate webhook | Dedupe by `update_id` |
| Poll returns empty | Long-poll blocks or returns empty array |

---

## Future Enhancements

- **Optional tmux nudge** — Gateway can inject `telegram_pull` into tmux if detected (for faster wake-up)
- **Failed message recovery** — CLI command to inspect/requeue failed messages
- **Metrics** — Message throughput, latency tracking

---

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Wake-up mechanism | Native polling via MCP | Simplest, no tmux dependency |
| Response time | 1-5 seconds | Fast enough, achievable with polling |
| Message batching | Accumulate until polled | Natural multi-message context |
| Reply style | Consolidated, auto-chunked | Simpler for Claude, proven in v1 |
| Lease duration | 12 hours | Covers long sessions with headroom |
| Inbox store | Redis Streams | Already running, native consumer groups |
