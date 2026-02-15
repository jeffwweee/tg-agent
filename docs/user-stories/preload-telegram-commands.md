# User Story: Preload Telegram Bot Commands

**Status:** ✅ Completed
**Priority:** Low
**Created:** 2026-02-15
**Effort:** S (2-4 hours)

---

## User Story

**As a** user setting up the Telegram bot
**I want to** preload all `/` commands into the bot automatically
**So that** I don't have to manually configure them through @BotFather each time

---

## Acceptance Criteria

- [ ] All bot commands are defined in a configuration file
- [ ] Commands can be loaded into Telegram via a script or API call
- [ ] Commands appear in the Telegram UI with descriptions
- [ ] Adding a new command only requires updating the config, not @BotFather
- [ ] Script can be run on-demand to sync commands

---

## Technical Design

### Telegram Bot API Endpoints

Use the `setMyCommands` API to register commands:

```http
POST https://api.telegram.org/bot<TOKEN>/setMyCommands
Content-Type: application/json

{
  "commands": [
    { "command": "start", "description": "Start the bot" },
    { "command": "help", "description": "Show available commands" },
    { "command": "status", "description": "Check bridge status" },
    { "command": "clear", "description": "Clear Claude screen" },
    { "command": "stop", "description": "Cancel current operation" },
    { "command": "reset", "description": "Reset to workspace root" }
  ]
}
```

### Implementation Steps

#### 1. Create Commands Configuration

Add to `src/config/commands.ts`:

```typescript
export const BOT_COMMANDS = [
  { command: 'start', description: 'Start the bot and show welcome message' },
  { command: 'help', description: 'Show available commands and usage' },
  { command: 'status', description: 'Check bridge and server status' },
  { command: 'clear', description: 'Clear Claude Code screen' },
  { command: 'stop', description: 'Cancel current Claude operation' },
  { command: 'reset', description: 'Reset context and return to workspace' },
];
```

#### 2. Add API Method to Client

Add to `src/telegram/client.ts`:

```typescript
async setMyCommands(commands: BotCommand[]): Promise<boolean> {
  const url = `https://api.telegram.org/bot${this.token}/setMyCommands`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  const data = await response.json();
  return data.ok;
}

async getMyCommands(): Promise<BotCommand[]> {
  const url = `https://api.telegram.org/bot${this.token}/getMyCommands`;
  const response = await fetch(url);
  const data = await response.json();
  return data.ok ? data.result : [];
}
```

#### 3. Create Setup Script

Create `bin/commands.sh`:

```bash
#!/bin/bash
# Sync bot commands with Telegram

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

node "$PROJECT_ROOT/scripts/sync-commands.mjs" "$@"
```

Create `scripts/sync-commands.mjs`:

```javascript
#!/usr/bin/env node
import { BOT_COMMANDS } from '../src/config/commands.js';
import { getTelegramClient } from '../src/telegram/client.js';

async function main() {
  const client = getTelegramClient();

  console.log('Current commands:', await client.getMyCommands());
  console.log('Setting commands:', BOT_COMMANDS);

  const success = await client.setMyCommands(BOT_COMMANDS);

  if (success) {
    console.log('✅ Commands synced successfully');
  } else {
    console.error('❌ Failed to sync commands');
    process.exit(1);
  }
}

main();
```

#### 4. Integrate with Server Startup

Optionally auto-sync on server start:

```typescript
// In src/server/index.ts
async function startServer() {
  // ... existing startup code

  // Sync commands on startup (optional)
  if (process.env.SYNC_COMMANDS_ON_START === 'true') {
    await client.setMyCommands(BOT_COMMANDS);
    log.info('Bot commands synced');
  }
}
```

---

## Commands to Register

| Command | Description |
|---------|-------------|
| `/start` | Start the bot and show welcome message |
| `/help` | Show available commands and usage |
| `/status` | Check bridge and server status |
| `/clear` | Clear Claude Code screen |
| `/stop` | Cancel current Claude operation |
| `/reset` | Reset context and return to workspace |

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `SYNC_COMMANDS_ON_START` | Auto-sync commands on server start | `false` |

---

## Usage

```bash
# Sync commands manually
./bin/commands.sh sync

# View current commands
./bin/commands.sh list

# Clear all commands
./bin/commands.sh clear
```

---

## Testing

1. Run sync script
2. Verify commands appear in Telegram bot info
3. Test each command still works
4. Add new command to config, sync, verify it appears

---

## Notes

- Telegram allows up to 100 commands
- Commands are case-insensitive
- Commands can be scoped to specific chats or users (optional)
- `deleteMyCommands` can clear all commands
- Commands are cached by Telegram, may take a moment to update
