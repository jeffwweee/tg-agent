# tg-agent Upgrade Plan (Telegram Gateway + MCP + Claude Code)

This doc captures the recommended architecture and migration steps for upgrading `tg-agent` into a more robust **Telegram Gateway + MCP tools** setup that works well with **Claude Code** and your existing **webhook + tunnel** approach.

---

## Goals

- Keep **near real-time** Telegram replies.
- Reduce “wonky” behavior from:
  - transcript scraping
  - filesystem polling for approvals/selections
- Make Telegram integration modular so it can later plug into Wingman / broader agent tooling.

---

## Recommended End-State Architecture

### Components

1) **Telegram Gateway (Webhook Receiver + Inbox)**
- Receives Telegram webhooks via your tunnel.
- Validates allowlist / signature (as applicable).
- Writes each incoming message/update into a **durable inbox** (MQ or DB).
- Optionally “nudges” your tmux window by injecting a command like `telegram_pull\n`.

2) **Claude Code Session (Orchestrator)**
- Runs persistently (tmux is optional but recommended for keeping it alive).
- Executes `telegram_pull` (or an equivalent command) to fetch the next message from the inbox.
- Performs reasoning and actions.
- Sends replies via MCP tool(s) or direct Telegram API (prefer MCP tool for consistency).

3) **Telegram MCP Server (Tools Layer)**
- Provides tool contracts for outbound messages and interactive UI patterns:
  - sending replies (formatting, chunking)
  - approvals / selections via inline keyboards
- Optionally also provides tools to read the inbox (if you later want to remove the gateway split).

> Key point: **tmux is no longer needed for message routing**. It is useful mainly for persistence / session survival and for your “inject `telegram_pull`” workflow.

---

## Message Flow

### Inbound
1. User sends message in Telegram
2. Telegram → webhook → **Gateway**
3. Gateway persists message into inbox (MQ/DB)
4. Gateway optionally injects `telegram_pull` into tmux

### Processing
5. Claude Code receives the “wake” (via tmux injection or your own loop)
6. Claude Code runs `telegram_pull`
7. `telegram_pull` fetches next pending message from inbox
8. Claude Code processes the task

### Outbound
9. Claude Code calls MCP tool: `telegram_send(chat_id, text, parse_mode?)`
10. After successful send, Claude Code acks the inbox message (so it won’t be replayed)

---

## Durable Inbox Options (Free)

Choose based on how much infra you want to run:

### Option A — Redis Streams (Best fit if you can run Redis)
- Durable queue + consumer groups + ack/replay.
- Great for “webhook producer + single consumer”.

Core ops:
- Producer: `XADD tg:inbox * chat_id=... update_id=... text=...`
- Consumer: `XREADGROUP ...` → process → `XACK`

### Option B — NATS JetStream (Lightweight MQ daemon)
- Durable streams, ack/replay, simple footprint.
- Good if you want MQ without Redis.

### Option C — RabbitMQ (Heavier, classic)
- Durable queues + ack.
- More operational overhead than Redis/NATS for your use case.

### Option D — SQLite Inbox (Often the simplest)
- If single-host and single-consumer: an inbox table is frequently enough.
- Use WAL mode; implement claim/ack semantics.

**Recommendation:**  
- If Redis already exists → **Redis Streams**  
- If you want a dedicated MQ daemon → **NATS JetStream**  
- If you want minimal moving parts → **SQLite inbox**

---

## MCP Tool Surface (Telegram)

Start small and grow.

### Phase 1: Outbound only (lowest risk)
- `telegram_send(chat_id, text, parse_mode="MarkdownV2"|"HTML"|"Plain")`
  - includes Markdown escaping + chunking (reuse your existing chunking logic)
- `telegram_send_typing(chat_id)` (optional)

### Phase 2: Selections / Approvals (to replace filesystem polling)
Instead of relying on wonky `AskUserQuestion` file polling, add a tool that blocks until callback arrives:

- `telegram_select(request_id, chat_id, question, options, multi=false, allow_custom=false)`
  - returns:
    - `selected_indices: number[]`
    - `selected_labels: string[]`
    - `custom_input?: string`

Also useful:
- `telegram_request_approval(request_id, chat_id, question, approve_label="Approve", deny_label="Deny")`
  - returns `{ approved: boolean }`

> MCP doesn’t have a “UI” by itself; **the MCP server implements Telegram inline keyboards**, and Claude Code only sees structured JSON results.

---

## tmux: Do You Still Need It?

**Not for message handling.**  
If Claude Code is the MCP client/orchestrator, it can call tools directly.

tmux remains useful for:
- Keeping Claude Code session alive (detach/attach)
- Your preferred “gateway injects `telegram_pull`” wake-up mechanism
- Multiple session routing if you run more than one agent context

---

## Migration Plan

### Step 0 — Keep your current system working
Do not break the current bridge until the new path is stable.

### Step 1 — Build Gateway Inbox (webhook → durable store)
- Store: pick Redis Streams / NATS / SQLite.
- Save minimum fields:
  - `update_id` (dedupe key)
  - `chat_id`
  - `from_user`
  - `text`
  - `timestamp`
  - `status` (pending/claimed/acked)
- Implement **dedupe** based on Telegram `update_id`.

### Step 2 — Implement `telegram_pull`
- Reads next pending message from inbox
- Claims it with a lease (prevents double processing)
- Outputs a clean payload Claude Code can work with:
  - `message_id`, `chat_id`, `text`, `meta`

### Step 3 — Add Telegram MCP server (Outbound)
- Implement `telegram_send(...)` with:
  - escaping (MarkdownV2)
  - chunking (Telegram size constraints)
  - error handling + retries
- Update Claude Code workflow to respond via MCP tool, not transcript scraping.

### Step 4 — Replace wonky hooks with explicit tools
- Replace PreToolUse file polling for approvals/selections with:
  - `telegram_request_approval(...)`
  - `telegram_select(...)`
- Store callback responses in the gateway/MCP server store keyed by `request_id`.

### Step 5 — (Optional) Merge gateway into MCP later
Once stable, you can decide whether:
- keep gateway separate (good for webhook isolation), or
- expose inbox tools via MCP too (`next_message`, `ack`, `requeue`).

---

## Idempotency & Reliability Rules (Must-have)

- **Inbound dedupe:** use Telegram `update_id`.
- **Processing lease:** claim messages with a lease/timeout; auto-requeue if expired.
- **Ack only after send success:** only ack inbox after `telegram_send` succeeds.
- **Safe retries:** if `telegram_send` fails transiently, retry; if permanent, mark failed and notify.

---

## NPM Publishing

You **do not need** to publish to npm to run an MCP server in Claude Code.

Use local repo:
- install deps locally
- run via local command (stdio) or local HTTP endpoint

Publish only if you need distribution/versioning across multiple machines/teams.

---

## Notes for Implementation

- Start with **outbound MCP** + **gateway inbox** first. This gives immediate benefit and removes transcript scraping.
- Then implement selections/approvals with explicit `request_id` correlation. Avoid filesystem polling.

---

## Quick Checklist

- [ ] Gateway receives webhooks and writes to durable inbox
- [ ] `telegram_pull` claims/leases and returns next message
- [ ] Claude Code replies using MCP `telegram_send`
- [ ] Inbox ack happens only after successful send
- [ ] Approvals/selections implemented via MCP tools + callback store
- [ ] tmux used only for persistence/wake-up (optional)
