/**
 * State File Management Module
 *
 * Manages state files for coordinating webhook and hook script:
 * - telegram_chat_id: Current chat ID for responses
 * - telegram_pending: Pending message metadata with timestamp
 *
 * Uses atomic writes (tmp + rename) for safety.
 */

import { readFile, writeFile, unlink, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { tmpdir } from 'os';

// State file paths
const getDefaultStateDir = () => join(homedir(), '.claude');

let stateDir: string;

export function setStateDir(dir: string) {
  stateDir = dir;
}

export function getStateDir(): string {
  return stateDir || process.env.STATE_DIR || getDefaultStateDir();
}

// File names
const CHAT_ID_FILE = 'telegram_chat_id';
const PENDING_FILE = 'telegram_pending';

// Types
export interface PendingState {
  chatId: number;
  userId: number;
  messageId: number;
  timestamp: number;
  text: string;
}

export interface ChatIdState {
  chatId: number;
  updatedAt: number;
}

// Helper: Ensure state directory exists
async function ensureStateDir(): Promise<void> {
  const dir = getStateDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// Helper: Atomic write (write to temp, then rename)
async function atomicWrite(filename: string, content: string): Promise<void> {
  await ensureStateDir();
  const dir = getStateDir();
  const filePath = join(dir, filename);
  const tempPath = join(tmpdir(), `${filename}.${Date.now()}.tmp`);

  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, filePath);
}

// Helper: Read file safely
async function safeRead(filename: string): Promise<string | null> {
  const dir = getStateDir();
  const filePath = join(dir, filename);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// === Chat ID Management ===

/**
 * Save the current chat ID for responses
 */
export async function saveChatId(chatId: number): Promise<void> {
  const state: ChatIdState = {
    chatId,
    updatedAt: Date.now(),
  };
  await atomicWrite(CHAT_ID_FILE, JSON.stringify(state));
}

/**
 * Get the current chat ID
 */
export async function getChatId(): Promise<number | null> {
  const content = await safeRead(CHAT_ID_FILE);
  if (!content) {
    return null;
  }

  try {
    const state: ChatIdState = JSON.parse(content);
    return state.chatId;
  } catch {
    return null;
  }
}

/**
 * Get full chat ID state
 */
export async function getChatIdState(): Promise<ChatIdState | null> {
  const content = await safeRead(CHAT_ID_FILE);
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// === Pending State Management ===

/**
 * Save pending message state
 */
export async function savePending(state: PendingState): Promise<void> {
  await atomicWrite(PENDING_FILE, JSON.stringify(state));
}

/**
 * Get pending message state
 */
export async function getPending(): Promise<PendingState | null> {
  const content = await safeRead(PENDING_FILE);
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Check if there's a pending message (optionally check timeout)
 */
export async function hasPending(timeoutMs?: number): Promise<boolean> {
  const pending = await getPending();
  if (!pending) {
    return false;
  }

  // Check timeout if specified
  if (timeoutMs !== undefined) {
    const age = Date.now() - pending.timestamp;
    if (age > timeoutMs) {
      await clearPending();
      return false;
    }
  }

  return true;
}

/**
 * Clear pending state
 */
export async function clearPending(): Promise<void> {
  const dir = getStateDir();
  const filePath = join(dir, PENDING_FILE);

  if (existsSync(filePath)) {
    await unlink(filePath);
  }
}

/**
 * Get state summary for status command
 */
export async function getStateSummary(): Promise<{
  hasChatId: boolean;
  hasPending: boolean;
  pendingAge?: number;
  pendingText?: string;
}> {
  const chatId = await getChatId();
  const pending = await getPending();

  return {
    hasChatId: chatId !== null,
    hasPending: pending !== null,
    pendingAge: pending ? Date.now() - pending.timestamp : undefined,
    pendingText: pending?.text,
  };
}
