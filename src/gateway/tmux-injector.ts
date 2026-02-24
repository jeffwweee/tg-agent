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

const DEFAULT_COMMAND = '[TELEGRAM] New message received. Run telegram_poll to read it.';

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
    try {
      // Step 1: Send the text literally (no interpretation)
      const textResult = await this.runTmuxCommand(['send-keys', '-t', this.sessionName, '-l', this.command]);
      if (!textResult.success) {
        return textResult;
      }

      // Step 2: Small delay before sending Enter
      await this.sleep(50);

      // Step 3: Send Enter key separately
      const enterResult = await this.runTmuxCommand(['send-keys', '-t', this.sessionName, 'Enter']);

      if (enterResult.success) {
        logger.info(`Tmux injection successful`, {
          session: this.sessionName,
          command: this.command,
        });
      }

      return enterResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Tmux injection failed`, { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  private runTmuxCommand(args: string[]): Promise<InjectionResult> {
    return new Promise((resolve) => {
      logger.debug(`Executing: tmux ${args.join(' ')}`);

      const proc = spawn('tmux', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr.trim() || `tmux exited with code ${code}` });
        }
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  /**
   * Check if the target session exists
   */
  async sessionExists(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('tmux', ['has-session', '-t', this.sessionName], {
        stdio: 'ignore',
      });

      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  }
}
