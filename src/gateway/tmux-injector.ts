/**
 * Tmux Injector
 *
 * Injects keystrokes into a tmux session to wake up Claude Code
 * when Telegram messages arrive.
 */

import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';

export interface TmuxInjectorOptions {
  sessionName: string;
  command?: string;
}

export interface InjectionResult {
  success: boolean;
  error?: string;
}

const DEFAULT_COMMAND = '/mcp tg-agent:telegram_poll';

export class TmuxInjector {
  private sessionName: string;
  private command: string;

  constructor(options: TmuxInjectorOptions) {
    this.sessionName = options.sessionName;
    this.command = options.command ?? DEFAULT_COMMAND;
  }

  /**
   * Inject wake-up command into tmux session
   */
  async inject(): Promise<InjectionResult> {
    return new Promise((resolve) => {
      const args = ['send-keys', '-t', this.sessionName, this.command, 'Enter'];

      logger.debug(`Executing: tmux ${args.join(' ')}`);

      const proc = spawn('tmux', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        const errorMsg = error.message;
        logger.error(`Tmux injection failed`, { error: errorMsg });
        resolve({ success: false, error: errorMsg });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          logger.info(`Tmux injection successful`, {
            session: this.sessionName,
            command: this.command,
          });
          resolve({ success: true });
        } else {
          const errorMsg = stderr.trim() || `tmux exited with code ${code}`;
          logger.error(`Tmux injection failed`, {
            session: this.sessionName,
            code,
            error: errorMsg,
          });
          resolve({ success: false, error: errorMsg });
        }
      });
    });
  }

  /**
   * Check if tmux is available
   */
  static async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('tmux', ['-V'], { stdio: 'ignore' });
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  }
}
