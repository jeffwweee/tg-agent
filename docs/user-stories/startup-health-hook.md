# User Story: Startup Health Hook

**Status:** 📋 Proposed
**Priority:** High
**Created:** 2026-02-16
**Effort:** S (2-4 hours)

---

## User Story

**As a** user running the tg-agent bridge
**I want to** automatically verify all required services are running at startup
**So that** I can be notified of any issues before they cause problems

---

## Acceptance Criteria

- [ ] Health check runs automatically when server starts
- [ ] Checks tmux session with Claude is running
- [ ] Checks Telegram webhook is configured
- [ ] Checks cloudflared tunnel is running (if enabled)
- [ ] Checks state directory is writable
- [ ] Results are logged with clear status indicators
- [ ] Optional: Send startup notification to Telegram with health status
- [ ] Server starts even if non-critical checks fail (degraded mode)
- [ ] Health check can be run manually via `/health` or script

---

## Technical Design

### Flow

```
Server Start → Run Health Checks → Log Results → (Optional) Notify Telegram → Continue Startup
```

### Implementation Steps

#### 1. Create Health Check Module

Create `src/health/startup-checks.ts`:

```typescript
import { sessionExists, getSessionInfo } from '../tmux/inject.js';
import { getTelegramClient } from '../telegram/client.js';
import { access, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface HealthCheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  critical: boolean;
}

export async function runStartupChecks(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // Check 1: tmux session
  results.push(await checkTmuxSession());

  // Check 2: Telegram webhook
  results.push(await checkTelegramWebhook());

  // Check 3: State directory
  results.push(await checkStateDirectory());

  // Check 4: Cloudflared tunnel (optional)
  if (process.env.USE_TUNNEL === 'true') {
    results.push(await checkCloudflaredTunnel());
  }

  // Check 5: Photos directory writable
  results.push(await checkPhotosDirectory());

  return results;
}

async function checkTmuxSession(): Promise<HealthCheckResult> {
  try {
    const info = await getSessionInfo();
    if (info.exists) {
      return {
        name: 'tmux Session',
        status: 'ok',
        message: `Session '${info.name}' is running (${info.windows} windows)`,
        critical: true,
      };
    }
    return {
      name: 'tmux Session',
      status: 'error',
      message: `Session '${info.name}' not found. Start with: tmux new -s ${info.name}`,
      critical: true,
    };
  } catch (err) {
    return {
      name: 'tmux Session',
      status: 'error',
      message: `Failed to check: ${(err as Error).message}`,
      critical: true,
    };
  }
}

async function checkTelegramWebhook(): Promise<HealthCheckResult> {
  try {
    const client = getTelegramClient();
    const info = await client.getWebhookInfo();

    if (info.url) {
      return {
        name: 'Telegram Webhook',
        status: 'ok',
        message: `Webhook configured: ${info.url}`,
        critical: true,
      };
    }
    return {
      name: 'Telegram Webhook',
      status: 'warning',
      message: 'No webhook configured. Run: ./bin/webhook.sh set --tunnel',
      critical: false,
    };
  } catch (err) {
    return {
      name: 'Telegram Webhook',
      status: 'error',
      message: `Failed to check: ${(err as Error).message}`,
      critical: true,
    };
  }
}

async function checkStateDirectory(): Promise<HealthCheckResult> {
  const stateDir = process.env.STATE_DIR || join(process.env.HOME || '', '.claude');

  try {
    // Try to write a test file
    const testFile = join(stateDir, '.healthcheck_test');
    await writeFile(testFile, 'test');
    await unlink(testFile);

    return {
      name: 'State Directory',
      status: 'ok',
      message: `Directory writable: ${stateDir}`,
      critical: true,
    };
  } catch (err) {
    return {
      name: 'State Directory',
      status: 'error',
      message: `Directory not writable: ${stateDir}`,
      critical: true,
    };
  }
}

async function checkCloudflaredTunnel(): Promise<HealthCheckResult> {
  try {
    const { stdout } = await execAsync('pgrep -f cloudflared');
    if (stdout.trim()) {
      return {
        name: 'Cloudflared Tunnel',
        status: 'ok',
        message: 'Tunnel process is running',
        critical: false,
      };
    }
    return {
      name: 'Cloudflared Tunnel',
      status: 'warning',
      message: 'Tunnel not running. Start with: ./bin/start.sh -t',
      critical: false,
    };
  } catch {
    return {
      name: 'Cloudflared Tunnel',
      status: 'warning',
      message: 'Tunnel not running',
      critical: false,
    };
  }
}

async function checkPhotosDirectory(): Promise<HealthCheckResult> {
  const photosDir = process.env.PHOTOS_DIR || 'photos';

  try {
    const testFile = join(photosDir, '.healthcheck_test');
    await writeFile(testFile, 'test');
    await unlink(testFile);

    return {
      name: 'Photos Directory',
      status: 'ok',
      message: `Directory writable: ${photosDir}`,
      critical: false,
    };
  } catch (err) {
    return {
      name: 'Photos Directory',
      status: 'warning',
      message: `Directory not writable: ${photosDir}`,
      critical: false,
    };
  }
}
```

#### 2. Integrate with Server Startup

Update `src/server/index.ts`:

```typescript
import { runStartupChecks, HealthCheckResult } from './health/startup-checks.js';

async function logStartupHealth(results: HealthCheckResult[]): Promise<void> {
  log.info('=== Startup Health Check ===');

  for (const result of results) {
    const emoji = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
    log.info(`${emoji} ${result.name}: ${result.message}`);
  }

  const criticalErrors = results.filter(r => r.status === 'error' && r.critical);
  if (criticalErrors.length > 0) {
    log.error(`${criticalErrors.length} critical error(s) found`);
  }

  log.info('============================');
}

async function startServer() {
  // Run health checks
  const healthResults = await runStartupChecks();
  await logStartupHealth(healthResults);

  // Notify via Telegram (optional)
  if (process.env.NOTIFY_STARTUP === 'true') {
    await sendStartupNotification(healthResults);
  }

  // Check for critical errors
  const criticalErrors = healthResults.filter(r => r.status === 'error' && r.critical);
  if (criticalErrors.length > 0) {
    log.warn('Starting in degraded mode due to critical errors');
  }

  // Continue with normal startup...
}
```

#### 3. Optional Telegram Notification

```typescript
async function sendStartupNotification(results: HealthCheckResult[]): Promise<void> {
  const client = getTelegramClient();

  let message = '🚀 *tg-agent Started*\n\n';
  message += '*Health Check Results:*\n';

  for (const result of results) {
    const emoji = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
    message += `${emoji} ${result.name}\n`;
  }

  const criticalErrors = results.filter(r => r.status === 'error' && r.critical);
  if (criticalErrors.length > 0) {
    message += `\n⚠️ *Running in degraded mode*`;
  }

  // Read chat_id from state file
  const chatId = await readChatId();
  if (chatId) {
    await client.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }
}
```

#### 4. Add /health Command (Optional)

Update `src/server/routes/telegram.ts`:

```typescript
health: async (_message, reply) => {
  const results = await runStartupChecks();

  let text = '*Service Health*\n\n';
  for (const result of results) {
    const emoji = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
    text += `${emoji} ${result.name}\n_${result.message}_\n\n`;
  }

  await reply(text);
},
```

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_TUNNEL` | Check cloudflared tunnel status | `false` |
| `NOTIFY_STARTUP` | Send Telegram notification on startup | `false` |
| `STATE_DIR` | State directory path | `~/.claude` |
| `PHOTOS_DIR` | Photos directory path | `photos` |

---

## Health Check Items

| Check | Critical | Description |
|-------|----------|-------------|
| tmux Session | ✅ Yes | Claude must be running in tmux |
| Telegram Webhook | ✅ Yes | Webhook must be configured |
| State Directory | ✅ Yes | Must be writable for state files |
| Cloudflared Tunnel | ❌ No | Optional, for public URL |
| Photos Directory | ❌ No | Optional, for photo handling |

---

## Testing

1. Start server with all services running → all checks pass
2. Start without tmux session → critical error logged
3. Start without webhook → warning logged
4. Start without tunnel → warning logged (if USE_TUNNEL=true)
5. Verify Telegram notification received (if NOTIFY_STARTUP=true)
6. Test /health command returns current status

---

## Example Output

### Console Log
```
=== Startup Health Check ===
✅ tmux Session: Session 'claude' is running (1 windows)
✅ Telegram Webhook: Webhook configured: https://xxx.trycloudflare.com/telegram/webhook
✅ State Directory: Directory writable: /home/user/.claude
⚠️ Cloudflared Tunnel: Tunnel not running. Start with: ./bin/start.sh -t
✅ Photos Directory: Directory writable: /home/user/workspace/photos
============================
```

### Telegram Notification
```
🚀 *tg-agent Started*

*Health Check Results:*
✅ tmux Session
✅ Telegram Webhook
✅ State Directory
⚠️ Cloudflared Tunnel
✅ Photos Directory
```

---

## Future Enhancements

- [ ] Add `/health` command to check current status from Telegram
- [ ] Periodic health checks (every N minutes)
- [ ] Auto-restart failed services
- [ ] Prometheus metrics endpoint
- [ ] Web dashboard for health status

---

## Related

- [API Reference](../api-reference.md) - Health endpoint documentation
- [Deployment Guide](../deployment.md) - Production deployment
