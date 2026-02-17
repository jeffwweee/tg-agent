# User Story: Agent Completion Notification via Telegram

**Status:** ✅ Completed
**Priority:** Medium
**Created:** 2026-02-16
**Effort:** S (2-4 hours)

---

## User Story

**As a** user running background agents/tasks via Claude Code
**I want to** receive a Telegram notification when long-running tasks complete
**So that** I don't have to keep checking the terminal session

---

## Background

Currently, when Claude Code spawns background agents (via the Task tool), completion notifications only appear in the active terminal session. If the user is away or working on something else, they won't know when tasks finish.

This is especially problematic for:
- Long-running implementation tasks
- Multiple parallel agents
- Tasks that complete while user is AFK

---

## Acceptance Criteria

- [ ] User receives Telegram notification when background agent completes
- [ ] Notification includes: task name, status (success/failure), summary
- [ ] Only notify for tasks initiated during active Telegram session
- [ ] User can opt-out via configuration
- [ ] Works without requiring Claude Code hook changes

---

## Technical Design

### Decided Approach: File System Monitoring

After investigation, the recommended approach is **polling task output files**:

| Option | Status | Reason |
|--------|--------|--------|
| PostTask Hook | ❌ Not available | Claude Code only supports `Stop` and `PreToolUse` hooks |
| **File Monitoring** | ✅ Selected | Reliable, no dependencies, real-time detection |
| Process Monitoring | ❌ Not reliable | Tasks run in same process, no separate PIDs |
| API Endpoint | ❌ Doesn't exist | No REST/WebSocket API for task status |

### Detection Method

Task output files are located at `/tmp/claude-{session}/tasks/{taskId}.output`:

| State | File Characteristics |
|-------|---------------------|
| Running | 0-byte empty file |
| Completed | Symbolic link to JSONL file with full history |

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Task Monitor Service                       │
├──────────────────────────────────────────────────────────────┤
│  1. Start: Load active session ID from telegram_chat_id      │
│  2. Poll: Check /tmp/claude-{session}/tasks/*.output         │
│  3. Detect: File changes from 0-byte → symlink (completion)  │
│  4. Parse: Read JSONL to extract task name and summary       │
│  5. Notify: Send Telegram message with results               │
└──────────────────────────────────────────────────────────────┘
```

### Implementation

#### 1. Create Task Monitor Module: `src/monitor/task-monitor.ts`

```typescript
import { readdir, stat, readlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getChatId } from '../state/files.js';
import { getTelegramClient } from '../telegram/client.js';

export interface TaskStatus {
  taskId: string;
  status: 'running' | 'completed' | 'unknown';
  outputPath: string;
  linkedFile?: string;
  completedAt?: Date;
}

export class TaskMonitor {
  private taskDir: string;
  private pollingInterval: number;
  private knownTasks: Map<string, TaskStatus> = new Map();
  private intervalId?: NodeJS.Timeout;

  constructor(sessionId: string, pollingIntervalMs: number = 5000) {
    this.taskDir = `/tmp/claude-${sessionId}/tasks`;
    this.pollingInterval = pollingIntervalMs;
  }

  async start(): Promise<void> {
    // Initial scan
    await this.scanTasks();

    // Start polling
    this.intervalId = setInterval(() => this.scanTasks(), this.pollingInterval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  private async scanTasks(): Promise<void> {
    if (!existsSync(this.taskDir)) return;

    const files = await readdir(this.taskDir);
    const outputFiles = files.filter(f => f.endsWith('.output'));

    for (const file of outputFiles) {
      const taskId = file.replace('.output', '');
      const outputPath = join(this.taskDir, file);
      const stats = await stat(outputPath);

      const isNew = !this.knownTasks.has(taskId);
      const wasRunning = this.knownTasks.get(taskId)?.status === 'running';
      const isNowComplete = stats.size > 0 || stats.isSymbolicLink();

      // Detect completion: was running, now complete
      if (wasRunning && isNowComplete) {
        const linkedFile = stats.isSymbolicLink() ? await readlink(outputPath) : undefined;

        await this.onTaskCompleted({
          taskId,
          status: 'completed',
          outputPath,
          linkedFile,
          completedAt: new Date(),
        });
      }

      // Update known state
      this.knownTasks.set(taskId, {
        taskId,
        status: isNowComplete ? 'completed' : 'running',
        outputPath,
        linkedFile: stats.isSymbolicLink() ? await readlink(outputPath) : undefined,
      });
    }
  }

  private async onTaskCompleted(task: TaskStatus): Promise<void> {
    // Extract summary from JSONL file
    const summary = await this.extractSummary(task.linkedFile);

    // Send Telegram notification
    await this.sendNotification(task, summary);
  }

  private async extractSummary(jsonlPath?: string): Promise<string> {
    // Parse JSONL and extract task summary
    // Implementation details...
  }

  private async sendNotification(task: TaskStatus, summary: string): Promise<void> {
    const chatId = await getChatId();
    if (!chatId) return;

    const client = getTelegramClient();
    await client.sendMessage(chatId, this.formatMessage(task, summary), {
      parse_mode: 'Markdown',
    });
  }

  private formatMessage(task: TaskStatus, summary: string): string {
    return `✅ *Task Complete*\n\n` +
      `*Task ID:* ${task.taskId}\n` +
      `*Status:* Success\n\n` +
      `_${summary.slice(0, 200)}${summary.length > 200 ? '...' : ''}_`;
  }
}
```

#### 2. Integrate with Server Startup: `src/server/index.ts`

```typescript
import { TaskMonitor } from './monitor/task-monitor.js';

// Get session ID from environment or state
const sessionId = process.env.CLAUDE_SESSION_ID || extractSessionIdFromPath();

if (env.NOTIFY_TASK_COMPLETION !== 'false') {
  const taskMonitor = new TaskMonitor(sessionId, env.TASK_MONITOR_INTERVAL_MS || 5000);
  taskMonitor.start();

  // Cleanup on shutdown
  process.on('SIGTERM', () => taskMonitor.stop());
  process.on('SIGINT', () => taskMonitor.stop());
}
```

#### 3. Add Configuration: `.env.example`

```bash
# Task Completion Notification
NOTIFY_TASK_COMPLETION=true
TASK_MONITOR_INTERVAL_MS=5000
```

---

## Notification Format

```
✅ Task Complete

Task: Implement FEAT-016: Send Files
Status: Success
Duration: 3m 45s

Summary: Created document.ts, updated webhook
handler, all 48 tests passing.
```

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `NOTIFY_TASK_COMPLETION` | Enable task notifications | `true` |
| `TASK_MONITOR_INTERVAL_MS` | Polling interval in milliseconds | `5000` |
| `TASK_SUMMARY_MAX_LENGTH` | Max characters in summary | `200` |

---

## Edge Cases

| Case | Handling |
|------|----------|
| Multiple concurrent tasks | Send separate notification for each |
| Task output file deleted | Gracefully handle missing files |
| Large JSONL files | Stream parse, limit summary length |
| Session ID changes | Reload from state file |
| Server restart | Rescan existing tasks, only notify new completions |

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/monitor/task-monitor.ts` | Create | Task monitoring service |
| `src/monitor/summary-extractor.ts` | Create | JSONL parsing for summaries |
| `src/server/index.ts` | Modify | Start monitor on server start |
| `.env.example` | Modify | Add configuration options |
| `tasks.json` | Modify | Mark FEAT-018 as complete |

---

## Testing

1. Start server with monitor enabled
2. Trigger a background task
3. Verify notification received when task completes
4. Test with multiple concurrent tasks
5. Test with monitor disabled

---

## Decisions

1. **Detection method**: ✅ File system monitoring (polling)
2. **Session tracking**: Use existing `telegram_chat_id` state
3. **Privacy**: Summary only, no full output (configurable length)

---

## References

- Task output location: `/tmp/claude-{session}/tasks/*.output`
- Claude Code hooks: Only `Stop` and `PreToolUse` available
- Related: `src/server/routes/telegram.ts` (message sending)
