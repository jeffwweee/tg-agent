/**
 * Permission State Management Module
 *
 * Tracks pending tool permission requests for Telegram approval.
 * Uses atomic writes for safety.
 *
 * Flow:
 * 1. Hook script creates permission request → savePermissionRequest()
 * 2. User approves/denies via Telegram → updatePermissionRequest()
 * 3. Hook script polls for response → waitForPermissionResponse()
 * 4. Response returned, state cleaned up → clearPermissionRequest()
 */

import { readFile, writeFile, unlink, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { basename } from 'path';

// File names
const PERMISSION_DIR = 'permissions';
const PERMISSION_INDEX_FILE = 'permission_index';

// Types
export type PermissionStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  chatId: number;
  messageId?: number;
  timestamp: number;
  status: PermissionStatus;
  response?: 'approve' | 'deny';
  respondedAt?: number;
}

export interface PermissionIndex {
  lastId: number;
}

// Get state directory
function getStateDir(): string {
  return process.env.STATE_DIR || join(homedir(), '.claude');
}

// Get permission directory
function getPermissionDir(): string {
  return join(getStateDir(), PERMISSION_DIR);
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

// Helper: Get permission file path
function getPermissionFilePath(requestId: string): string {
  return join(getPermissionDir(), `${requestId}.json`);
}

// Helper: Get index file path
function getIndexFilePath(): string {
  return join(getStateDir(), PERMISSION_INDEX_FILE);
}

/**
 * Generate a unique request ID
 */
export async function generateRequestId(): Promise<string> {
  await ensureDir(getStateDir());

  const indexFile = getIndexFilePath();
  let index: PermissionIndex = { lastId: 0 };

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
  return `perm_${timestamp}_${index.lastId}`;
}

/**
 * Save a new permission request
 */
export async function savePermissionRequest(request: Omit<PermissionRequest, 'requestId' | 'timestamp' | 'status'> & { requestId?: string }): Promise<PermissionRequest> {
  await ensureDir(getPermissionDir());

  const fullRequest: PermissionRequest = {
    requestId: request.requestId || await generateRequestId(),
    toolName: request.toolName,
    toolInput: request.toolInput,
    chatId: request.chatId,
    messageId: request.messageId,
    timestamp: Date.now(),
    status: 'pending',
  };

  const filePath = getPermissionFilePath(fullRequest.requestId);
  await atomicWrite(filePath, JSON.stringify(fullRequest, null, 2));

  return fullRequest;
}

/**
 * Get a permission request by ID
 */
export async function getPermissionRequest(requestId: string): Promise<PermissionRequest | null> {
  const filePath = getPermissionFilePath(requestId);
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
 * Update permission request status
 */
export async function updatePermissionRequest(
  requestId: string,
  updates: Partial<Pick<PermissionRequest, 'status' | 'response' | 'respondedAt' | 'messageId'>>
): Promise<PermissionRequest | null> {
  const request = await getPermissionRequest(requestId);
  if (!request) {
    return null;
  }

  const updated: PermissionRequest = {
    ...request,
    ...updates,
  };

  const filePath = getPermissionFilePath(requestId);
  await atomicWrite(filePath, JSON.stringify(updated, null, 2));

  return updated;
}

/**
 * Clear/delete a permission request
 */
export async function clearPermissionRequest(requestId: string): Promise<void> {
  const filePath = getPermissionFilePath(requestId);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }
}

/**
 * Wait for permission response (polling)
 * Returns the response or null on timeout
 */
export async function waitForPermissionResponse(
  requestId: string,
  timeoutMs: number = 300000, // 5 minutes default
  pollIntervalMs: number = 500
): Promise<{ approved: boolean; response: 'approve' | 'deny' | 'timeout' }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const request = await getPermissionRequest(requestId);

    if (!request) {
      // Request was deleted (shouldn't happen normally)
      return { approved: false, response: 'timeout' };
    }

    if (request.status === 'approved') {
      await clearPermissionRequest(requestId);
      return { approved: true, response: 'approve' };
    }

    if (request.status === 'denied') {
      await clearPermissionRequest(requestId);
      return { approved: false, response: 'deny' };
    }

    if (request.status === 'expired') {
      await clearPermissionRequest(requestId);
      return { approved: false, response: 'timeout' };
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout - mark as expired
  await updatePermissionRequest(requestId, { status: 'expired' });
  return { approved: false, response: 'timeout' };
}

/**
 * Get all pending permission requests (for status/cleanup)
 */
export async function getPendingPermissions(): Promise<PermissionRequest[]> {
  const dir = getPermissionDir();
  await ensureDir(dir);

  const { readdir } = await import('fs/promises');
  const files = await readdir(dir);

  const pending: PermissionRequest[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const content = await safeRead(join(dir, file));
    if (content) {
      try {
        const request: PermissionRequest = JSON.parse(content);
        if (request.status === 'pending') {
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
 * Clean up expired permission requests
 */
export async function cleanupExpiredPermissions(timeoutMs: number = 300000): Promise<number> {
  const dir = getPermissionDir();
  await ensureDir(dir);

  const { readdir } = await import('fs/promises');
  const files = await readdir(dir);

  let cleaned = 0;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const content = await safeRead(join(dir, file));
    if (content) {
      try {
        const request: PermissionRequest = JSON.parse(content);
        const age = Date.now() - request.timestamp;

        if (request.status === 'pending' && age > timeoutMs) {
          await clearPermissionRequest(request.requestId);
          cleaned++;
        } else if (request.status !== 'pending') {
          // Clean up resolved requests older than 1 hour
          if (request.respondedAt && Date.now() - request.respondedAt > 3600000) {
            await clearPermissionRequest(request.requestId);
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

/**
 * Format tool input for display (truncate/redact sensitive data)
 */
export function formatToolInputForDisplay(
  toolName: string,
  input: Record<string, unknown>,
  maxLength: number = 500
): string {
  let display = '';

  switch (toolName) {
    case 'Write':
    case 'Edit':
      display = `file: ${input.file_path || 'unknown'}`;
      if (input.content) {
        const content = String(input.content);
        if (content.length > 100) {
          display += `\ncontent: ${content.slice(0, 100)}...`;
        } else {
          display += `\ncontent: ${content}`;
        }
      }
      break;

    case 'Bash':
      display = `command: ${input.command || 'unknown'}`;
      break;

    default:
      // Generic formatting
      const entries = Object.entries(input);
      if (entries.length === 0) {
        display = '(no parameters)';
      } else {
        display = entries
          .map(([key, value]) => {
            const strValue = String(value);
            if (strValue.length > 100) {
              return `${key}: ${strValue.slice(0, 100)}...`;
            }
            return `${key}: ${strValue}`;
          })
          .join('\n');
      }
  }

  if (display.length > maxLength) {
    display = display.slice(0, maxLength) + '...';
  }

  return display;
}
