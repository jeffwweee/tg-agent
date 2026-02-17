/**
 * Task Monitor Module
 *
 * Monitors Claude Code background task output files and sends
 * Telegram notifications when tasks complete.
 *
 * Detection method:
 * - Running tasks: 0-byte .output files
 * - Completed tasks: Symbolic links to JSONL files
 */

import { readdir, stat, readlink, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getChatId } from '../state/files.js';
import { getTelegramClient } from '../telegram/client.js';

export interface TaskStatus {
  taskId: string;
  description?: string;
  status: 'running' | 'completed' | 'failed' | 'unknown';
  outputPath: string;
  linkedFile?: string;
  completedAt?: Date;
  startTime?: Date;
  summary?: string;
}

export interface TaskMonitorConfig {
  /** Session ID for task directory path */
  sessionId: string;
  /** Polling interval in milliseconds */
  pollingIntervalMs?: number;
  /** Enable/disable notifications */
  enabled?: boolean;
  /** Maximum summary length */
  maxSummaryLength?: number;
}

/**
 * Extract session ID from task directory path
 */
export function extractSessionIdFromPath(taskDir: string): string | null {
  // Path format: /tmp/claude-{sessionId}/tasks
  const match = taskDir.match(/claude-([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Find Claude Code task directory for current session
 */
export function findTaskDirectory(sessionId: string): string {
  return `/tmp/claude-${sessionId}/tasks`;
}

/**
 * Task Monitor - Polls task output files and notifies on completion
 */
export class TaskMonitor {
  private taskDir: string;
  private pollingInterval: number;
  private enabled: boolean;
  private maxSummaryLength: number;
  private knownTasks: Map<string, TaskStatus> = new Map();
  private intervalId?: ReturnType<typeof setInterval>;
  private log: (msg: string) => void;

  constructor(config: TaskMonitorConfig, logger?: (msg: string) => void) {
    this.taskDir = findTaskDirectory(config.sessionId);
    this.pollingInterval = config.pollingIntervalMs || 5000;
    this.enabled = config.enabled !== false;
    this.maxSummaryLength = config.maxSummaryLength || 300;
    this.log = logger || (() => {});
  }

  /**
   * Start monitoring for task completions
   */
  async start(): Promise<void> {
    if (!this.enabled) {
      this.log('Task monitor disabled');
      return;
    }

    this.log(`Starting task monitor: ${this.taskDir}`);

    // Initial scan to populate known tasks
    await this.scanTasks();

    // Start polling
    this.intervalId = setInterval(() => this.scanTasks(), this.pollingInterval);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.log('Task monitor stopped');
  }

  /**
   * Check if monitor is running
   */
  isRunning(): boolean {
    return this.intervalId !== undefined;
  }

  /**
   * Get current known tasks
   */
  getKnownTasks(): Map<string, TaskStatus> {
    return new Map(this.knownTasks);
  }

  /**
   * Scan task directory for changes
   */
  private async scanTasks(): Promise<void> {
    if (!existsSync(this.taskDir)) {
      return;
    }

    try {
      const files = await readdir(this.taskDir);
      const outputFiles = files.filter(f => f.endsWith('.output'));

      for (const file of outputFiles) {
        await this.checkTaskFile(file);
      }
    } catch (err) {
      this.log(`Error scanning tasks: ${(err as Error).message}`);
    }
  }

  /**
   * Check a single task file for completion
   */
  private async checkTaskFile(filename: string): Promise<void> {
    const taskId = filename.replace('.output', '');
    const outputPath = join(this.taskDir, filename);

    try {
      const stats = await stat(outputPath);
      const isComplete = stats.size > 0 || stats.isSymbolicLink();
      const wasRunning = this.knownTasks.get(taskId)?.status === 'running';

      // Get linked file if it's a symlink
      let linkedFile: string | undefined;
      if (stats.isSymbolicLink()) {
        try {
          linkedFile = await readlink(outputPath);
        } catch {
          // Ignore broken symlinks
        }
      }

      // Detect completion: was running, now complete
      if (wasRunning && isComplete) {
        const task: TaskStatus = {
          taskId,
          status: 'completed',
          outputPath,
          linkedFile,
          completedAt: new Date(),
        };

        // Extract summary from JSONL
        if (linkedFile) {
          task.summary = await this.extractSummary(linkedFile);
          task.description = this.extractDescription(taskId, task.summary);
        }

        this.log(`Task completed: ${taskId}`);
        await this.onTaskCompleted(task);
      }

      // Update known state
      if (!this.knownTasks.has(taskId) || wasRunning) {
        this.knownTasks.set(taskId, {
          taskId,
          status: isComplete ? 'completed' : 'running',
          outputPath,
          linkedFile,
          startTime: this.knownTasks.get(taskId)?.startTime || new Date(),
        });
      }
    } catch (err) {
      // File might have been deleted, ignore
    }
  }

  /**
   * Extract summary from JSONL output file
   */
  private async extractSummary(jsonlPath: string): Promise<string> {
    try {
      // Handle relative paths
      const fullPath = jsonlPath.startsWith('/')
        ? jsonlPath
        : join(this.taskDir, jsonlPath);

      if (!existsSync(fullPath)) {
        return 'Task completed';
      }

      const content = await readFile(fullPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Find the summary/result in the last assistant messages
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);

          // Look for summary in result
          if (entry.type === 'task_notification' && entry.summary) {
            return entry.summary;
          }

          // Look for assistant messages with summary
          if (entry.message?.role === 'assistant' && entry.message?.content) {
            const content = entry.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  // Found text content, use as summary
                  return this.truncateSummary(block.text);
                }
              }
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      return 'Task completed';
    } catch (err) {
      return 'Task completed';
    }
  }

  /**
   * Extract description from task ID and summary
   */
  private extractDescription(taskId: string, summary: string): string {
    // Try to extract task description from summary
    const match = summary.match(/(?:Task|Agent|FEAT-\d+|Implement)[:\s]+([^\n]+)/i);
    if (match) {
      return match[1].trim();
    }
    return `Task ${taskId}`;
  }

  /**
   * Truncate summary to max length
   */
  private truncateSummary(text: string): string {
    // Remove code blocks and excessive whitespace
    let cleaned = text
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/\n{2,}/g, '\n')
      .trim();

    if (cleaned.length > this.maxSummaryLength) {
      cleaned = cleaned.slice(0, this.maxSummaryLength).trim() + '...';
    }

    return cleaned;
  }

  /**
   * Handle task completion
   */
  private async onTaskCompleted(task: TaskStatus): Promise<void> {
    await this.sendNotification(task);
  }

  /**
   * Send Telegram notification
   */
  private async sendNotification(task: TaskStatus): Promise<void> {
    try {
      const chatId = await getChatId();
      if (!chatId) {
        this.log('No chat ID available for notification');
        return;
      }

      const client = getTelegramClient();
      const message = this.formatMessage(task);

      await client.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      this.log(`Notification sent for task: ${task.taskId}`);
    } catch (err) {
      this.log(`Failed to send notification: ${(err as Error).message}`);
    }
  }

  /**
   * Format notification message
   */
  private formatMessage(task: TaskStatus): string {
    const emoji = task.status === 'completed' ? '✅' : '❌';
    const statusText = task.status === 'completed' ? 'Complete' : 'Failed';

    let message = `${emoji} *Task ${statusText}*\n\n`;
    message += `*ID:* \`${task.taskId}\`\n`;

    if (task.description) {
      message += `*Task:* ${this.escapeMarkdown(task.description)}\n`;
    }

    if (task.summary) {
      message += `\n_${this.escapeMarkdown(task.summary)}_`;
    }

    return message;
  }

  /**
   * Escape special characters for Telegram Markdown
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1');
  }
}

/**
 * Create and start a task monitor instance
 */
export async function startTaskMonitor(
  sessionId: string,
  logger?: (msg: string) => void
): Promise<TaskMonitor> {
  const monitor = new TaskMonitor({ sessionId }, logger);
  await monitor.start();
  return monitor;
}
