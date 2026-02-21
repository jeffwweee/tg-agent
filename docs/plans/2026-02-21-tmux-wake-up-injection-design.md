# Tmux Wake-up Injection Design

**Date:** 2026-02-21
**Status:** Approved
**Task:** V2-013
**Related:** [wake-up-mechanism-design.md](./2026-02-21-wake-up-mechanism-design.md)

---

## Overview

Design for tmux keystroke injection in the gateway to automatically trigger Claude Code polling when Telegram messages arrive. This provides faster wake-up when Claude Code is idle in a tmux session.

---

## Goals

- Inject `/mcp tg-agent:telegram_poll` command into tmux session when messages arrive
- Notify user via Telegram if injection fails
- Zero-configuration enable (auto-activates when `TMUX_SESSION_NAME` is set)
- Non-blocking (webhook response not delayed by injection)

---

## Approach

Use simple `tmux send-keys` command to inject the polling command:

```
tmux send-keys -t <session> "/mcp tg-agent:telegram_poll" Enter
```

This is the standard tmux approach for keystroke injection.

---

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TMUX_SESSION_NAME` | No | - | Target tmux session name. If set, wake-up is enabled. |

**Enable Logic:**
- If `TMUX_SESSION_NAME` is set → wake-up enabled
- If `TMUX_SESSION_NAME` is not set → wake-up disabled (no-op)

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Telegram      │────▶│    Gateway      │────▶│     Redis       │
│   (webhook)     │     │   (Express)     │     │   (inbox)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               │ if TMUX_SESSION_NAME set
                               ▼
                        ┌─────────────────┐
                        │ tmux send-keys  │
                        │ -t <session>    │
                        └─────────────────┘
                               │
                               │ on failure
                               ▼
                        ┌─────────────────┐
                        │ TelegramClient  │
                        │ (error notify)  │
                        └─────────────────┘
```

---

## Components

### 1. TmuxInjector Module (`src/gateway/tmux-injector.ts`)

```typescript
export interface TmuxInjectorOptions {
  sessionName: string;
}

export class TmuxInjector {
  constructor(options: TmuxInjectorOptions);

  // Inject wake-up command into tmux session
  async inject(): Promise<{ success: boolean; error?: string }>;
}
```

**Implementation:**
- Use `child_process.spawn` to execute `tmux send-keys`
- Command: `tmux send-keys -t <session> "/mcp tg-agent:telegram_poll" Enter`
- Return success/failure status

### 2. Gateway Integration (`src/gateway/server.ts`)

- Import `TelegramClient` for error notifications
- Create `TmuxInjector` if `TMUX_SESSION_NAME` is configured
- After successful inbox write, call `injector.inject()`
- On injection failure, send Telegram error message to the chat

### 3. Config Updates (`src/config/index.ts`)

Add new config section:
```typescript
tmux: {
  sessionName?: string;  // TMUX_SESSION_NAME
}
```

---

## Message Flow

### Success Path

```
1. Webhook received
2. Validate user/secret
3. Write to Redis inbox
4. If TMUX_SESSION_NAME set:
   a. Execute: tmux send-keys -t <session> "/mcp tg-agent:telegram_poll" Enter
   b. Log injection success
5. Return webhook response
```

### Failure Path

```
1-3. (same as above)
4. If TMUX_SESSION_NAME set:
   a. Execute tmux send-keys
   b. If fails (session not found, etc.):
      - Log error
      - Send Telegram message to chat: "⚠️ Tmux injection failed: <error>"
5. Return webhook response (still success - message was saved to inbox)
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| TMUX_SESSION_NAME not set | Skip injection (disabled) |
| tmux command not found | Log error, send Telegram notification |
| Session not found | Log error, send Telegram notification |
| tmux send-keys fails | Log error, send Telegram notification |

**Telegram Error Message Format:**
```
⚠️ Tmux wake-up failed: <error message>

The message was saved to inbox. Claude Code will process it on next poll.
```

---

## Files to Change

| File | Change |
|------|--------|
| `src/gateway/tmux-injector.ts` | New - TmuxInjector class |
| `src/gateway/server.ts` | Integrate injector, add TelegramClient for errors |
| `src/config/index.ts` | Add tmux config section |
| `.env.example` | Add TMUX_SESSION_NAME documentation |

---

## Testing

### Manual Testing

```bash
# 1. Start a tmux session
tmux new -s claude

# 2. Set environment
export TMUX_SESSION_NAME=claude

# 3. Start gateway
npm run dev:gateway

# 4. Send Telegram message

# 5. Check tmux session - should see command injected
```

### Unit Tests

- Test `TmuxInjector` with mocked `child_process`
- Test success/failure return values
- Test config loading

---

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Injection method | `tmux send-keys` | Standard, simple, widely supported |
| Command to inject | `/mcp tg-agent:telegram_poll` | Full MCP command format |
| Enable control | Auto if TMUX_SESSION_NAME set | Simpler UX, no extra flag |
| Failure handling | Telegram notification | User awareness, not silent |
| Telegram send | Direct from gateway | Immediate feedback |

---

## Future Considerations

- Could add `TMUX_WAKEUP_COMMAND` for custom injection text
- Could add retry logic for transient failures
- Could support multiple sessions
