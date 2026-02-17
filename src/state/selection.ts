/**
 * Selection State Management Module
 *
 * Tracks pending selection requests for multi-option choices from Telegram.
 * Used when Claude uses the AskUserQuestion tool.
 *
 * Flow:
 * 1. Hook script creates selection request → saveSelectionRequest()
 * 2. User selects option via Telegram → updateSelectionRequest()
 * 3. Hook script polls for response → waitForSelectionResponse()
 * 4. Response returned, state cleaned up → clearSelectionRequest()
 */

import { readFile, writeFile, unlink, mkdir, rename, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir, tmpdir } from 'os';

// File names
const SELECTION_DIR = 'selections';
const SELECTION_INDEX_FILE = 'selection_index';

// Types
export type SelectionStatus = 'pending' | 'answered' | 'awaiting_input' | 'cancelled' | 'expired';

export interface SelectionOption {
  index: number;
  label: string;
  description?: string;
}

export interface SelectionRequest {
  requestId: string;
  question: string;
  header?: string;
  options: SelectionOption[];
  multiSelect: boolean;
  chatId: number;
  messageId?: number;
  timestamp: number;
  status: SelectionStatus;
  selectedIndices: number[];
  customInput?: string;
}

export interface SelectionIndex {
  lastId: number;
}

// Get state directory
function getStateDir(): string {
  return process.env.STATE_DIR || join(homedir(), '.claude');
}

// Get selection directory
function getSelectionDir(): string {
  return join(getStateDir(), SELECTION_DIR);
}

// Helper: Ensure directory exists
async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

// Helper: Atomic write
async function atomicWrite(filePath: string, content: string): Promise<void> {
  await ensureDir(join(filePath, '..'));
  const tempPath = join(tmpdir(), `${basename(filePath)}.${Date.now()}.tmp`);
  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, filePath);
}

// Helper: Read file safely
async function safeRead(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// Helper: Get selection file path
function getSelectionFilePath(requestId: string): string {
  return join(getSelectionDir(), `${requestId}.json`);
}

// Helper: Get index file path
function getIndexFilePath(): string {
  return join(getStateDir(), SELECTION_INDEX_FILE);
}

/**
 * Generate a unique request ID
 */
export async function generateSelectionRequestId(): Promise<string> {
  await ensureDir(getStateDir());

  const indexFile = getIndexFilePath();
  let index: SelectionIndex = { lastId: 0 };

  // Read current index
  const content = await safeRead(indexFile);
  if (content) {
    try {
      index = JSON.parse(content);
    } catch {
      // Use default
    }
  }

  // Increment
  index.lastId += 1;

  // Save
  await atomicWrite(indexFile, JSON.stringify(index));

  // Generate ID with timestamp for uniqueness
  const timestamp = Date.now().toString(36);
  return `sel_${timestamp}_${index.lastId}`;
}

/**
 * Save a new selection request
 */
export async function saveSelectionRequest(request: Omit<SelectionRequest, 'requestId' | 'timestamp' | 'status' | 'selectedIndices'> & { requestId?: string }): Promise<SelectionRequest> {
  await ensureDir(getSelectionDir());

  const fullRequest: SelectionRequest = {
    requestId: request.requestId || await generateSelectionRequestId(),
    question: request.question,
    header: request.header,
    options: request.options,
    multiSelect: request.multiSelect,
    chatId: request.chatId,
    messageId: request.messageId,
    timestamp: Date.now(),
    status: 'pending',
    selectedIndices: [],
    customInput: undefined,
  };

  const filePath = getSelectionFilePath(fullRequest.requestId);
  await atomicWrite(filePath, JSON.stringify(fullRequest, null, 2));

  return fullRequest;
}

/**
 * Get a selection request by ID
 */
export async function getSelectionRequest(requestId: string): Promise<SelectionRequest | null> {
  const filePath = getSelectionFilePath(requestId);
  const content = await safeRead(filePath);

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
 * Update selection request
 */
export async function updateSelectionRequest(
  requestId: string,
  updates: Partial<Omit<SelectionRequest, 'requestId' | 'timestamp'>>
): Promise<SelectionRequest | null> {
  const request = await getSelectionRequest(requestId);
  if (!request) {
    return null;
  }

  const updated: SelectionRequest = {
    ...request,
    ...updates,
  };

  const filePath = getSelectionFilePath(requestId);
  await atomicWrite(filePath, JSON.stringify(updated, null, 2));

  return updated;
}

/**
 * Clear/delete a selection request
 */
export async function clearSelectionRequest(requestId: string): Promise<void> {
  const filePath = getSelectionFilePath(requestId);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }
}

/**
 * Wait for selection response (polling)
 * Returns the response or null on timeout
 */
export async function waitForSelectionResponse(
  requestId: string,
  timeoutMs: number = 300000, // 5 minutes default
  pollIntervalMs: number = 500
): Promise<{
  status: 'answered' | 'cancelled' | 'timeout';
  selectedIndices: number[];
  selectedLabels: string[];
  customInput?: string;
}> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const request = await getSelectionRequest(requestId);

    if (!request) {
      // Request was deleted (shouldn't happen normally)
      return { status: 'timeout', selectedIndices: [], selectedLabels: [] };
    }

    if (request.status === 'answered') {
      const selectedLabels = request.selectedIndices.map(i => request.options[i]?.label || '');
      const result = {
        status: 'answered' as const,
        selectedIndices: request.selectedIndices,
        selectedLabels,
        customInput: request.customInput,
      };
      await clearSelectionRequest(requestId);
      return result;
    }

    if (request.status === 'cancelled') {
      await clearSelectionRequest(requestId);
      return { status: 'cancelled', selectedIndices: [], selectedLabels: [] };
    }

    if (request.status === 'expired') {
      await clearSelectionRequest(requestId);
      return { status: 'timeout', selectedIndices: [], selectedLabels: [] };
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout - mark as expired
  await updateSelectionRequest(requestId, { status: 'expired' });
  return { status: 'timeout', selectedIndices: [], selectedLabels: [] };
}

/**
 * Get pending selection request awaiting custom input for a chat
 */
export async function getPendingCustomInputRequest(chatId: number): Promise<SelectionRequest | null> {
  const dir = getSelectionDir();
  await ensureDir(dir);

  const files = await readdir(dir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const content = await safeRead(join(dir, file));
    if (content) {
      try {
        const request: SelectionRequest = JSON.parse(content);
        if (request.chatId === chatId && request.status === 'awaiting_input') {
          return request;
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  return null;
}

/**
 * Get all pending selection requests (for status/cleanup)
 */
export async function getPendingSelections(): Promise<SelectionRequest[]> {
  const dir = getSelectionDir();
  await ensureDir(dir);

  const files = await readdir(dir);

  const pending: SelectionRequest[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const content = await safeRead(join(dir, file));
    if (content) {
      try {
        const request: SelectionRequest = JSON.parse(content);
        if (request.status === 'pending' || request.status === 'awaiting_input') {
          pending.push(request);
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  return pending;
}

/**
 * Clean up expired selection requests
 */
export async function cleanupExpiredSelections(timeoutMs: number = 300000): Promise<number> {
  const dir = getSelectionDir();
  await ensureDir(dir);

  const files = await readdir(dir);

  let cleaned = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const content = await safeRead(join(dir, file));
    if (content) {
      try {
        const request: SelectionRequest = JSON.parse(content);
        const age = Date.now() - request.timestamp;

        if (request.status === 'pending' && age > timeoutMs) {
          await clearSelectionRequest(request.requestId);
          cleaned++;
        } else if (request.status !== 'pending' && request.status !== 'awaiting_input') {
          // Clean up resolved requests older than 1 hour
          if (age > 3600000) {
            await clearSelectionRequest(request.requestId);
            cleaned++;
          }
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  return cleaned;
}
