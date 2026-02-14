/**
 * tmux Integration Module
 *
 * Provides functions for interacting with a tmux session running Claude Code:
 * - Send text/prompts
 * - Send control keys (escape, clear)
 * - Validate session existence
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Default session name
const DEFAULT_SESSION = 'claude';

/**
 * Get the tmux session name from env or default
 */
export function getSessionName(): string {
  return process.env.TMUX_SESSION_NAME || DEFAULT_SESSION;
}

/**
 * Check if a tmux session exists
 */
export async function sessionExists(session?: string): Promise<boolean> {
  const sessionName = session || getSessionName();
  try {
    await execAsync(`tmux has-session -t ${sessionName} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of available tmux sessions
 */
export async function listSessions(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null');
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Send keys to tmux session
 */
export async function sendKeys(keys: string, session?: string): Promise<void> {
  const sessionName = session || getSessionName();

  if (!(await sessionExists(sessionName))) {
    throw new Error(`tmux session "${sessionName}" does not exist`);
  }

  // Use -l flag for literal key transmission
  await execAsync(`tmux send-keys -t ${sessionName} -l "${escapeForTmux(keys)}"`);
}

/**
 * Send keys followed by Enter
 */
export async function sendKeysWithEnter(keys: string, session?: string): Promise<void> {
  const sessionName = session || getSessionName();

  if (!(await sessionExists(sessionName))) {
    throw new Error(`tmux session "${sessionName}" does not exist`);
  }

  await execAsync(`tmux send-keys -t ${sessionName} -l "${escapeForTmux(keys)}" Enter`);
}

/**
 * Send a single key (like Escape, Enter, etc.)
 */
export async function sendKey(key: string, session?: string): Promise<void> {
  const sessionName = session || getSessionName();

  if (!(await sessionExists(sessionName))) {
    throw new Error(`tmux session "${sessionName}" does not exist`);
  }

  await execAsync(`tmux send-keys -t ${sessionName} ${key}`);
}

/**
 * Send Escape key to cancel/interrupt
 */
export async function sendEscape(session?: string): Promise<void> {
  await sendKey('Escape', session);
}

/**
 * Send Ctrl+C to interrupt
 */
export async function sendInterrupt(session?: string): Promise<void> {
  await sendKey('C-c', session);
}

/**
 * Clear the terminal screen (Ctrl+L)
 */
export async function clearScreen(session?: string): Promise<void> {
  await sendKey('C-l', session);
}

/**
 * Send a prompt/message to Claude
 */
export async function injectPrompt(message: string, session?: string): Promise<void> {
  await sendKeysWithEnter(message, session);
}

/**
 * Escape special characters for tmux send-keys
 */
function escapeForTmux(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

/**
 * Get session info for status
 */
export async function getSessionInfo(session?: string): Promise<{
  exists: boolean;
  name: string;
  windows?: number;
}> {
  const sessionName = session || getSessionName();
  const exists = await sessionExists(sessionName);

  if (!exists) {
    return { exists: false, name: sessionName };
  }

  try {
    const { stdout } = await execAsync(
      `tmux list-windows -t ${sessionName} -F "#{window_index}" 2>/dev/null`
    );
    const windows = stdout.trim().split('\n').filter(Boolean).length;
    return { exists: true, name: sessionName, windows };
  } catch {
    return { exists: true, name: sessionName };
  }
}
