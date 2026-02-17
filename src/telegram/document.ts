/**
 * Document Handling Module
 *
 * Downloads and saves documents from Telegram for Claude to process.
 */

import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getTelegramClient } from './client.js';

// Files directory (within workspace)
const FILES_DIR = process.env.FILES_DIR || 'files';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '20971520', 10); // 20MB default
const ALLOWED_FILE_TYPES = (process.env.ALLOWED_FILE_TYPES || 'pdf,txt,csv,json,md,xml').split(',').map(t => t.trim().toLowerCase());

/**
 * Document metadata from Telegram
 */
export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/**
 * Document metadata after saving
 */
export interface SavedDocument {
  /** Absolute path to saved document */
  filePath: string;
  /** Original filename */
  fileName: string;
  /** Original file ID from Telegram */
  fileId: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Get the files directory path
 */
export function getFilesDir(): string {
  // Use workspace-relative path or absolute path
  const workspaceDir = process.env.DEFAULT_WORKSPACE || join(process.env.HOME || '', 'workspace');
  if (FILES_DIR.startsWith('/')) {
    return FILES_DIR;
  }
  return join(workspaceDir, FILES_DIR);
}

/**
 * Ensure files directory exists
 */
async function ensureFilesDir(): Promise<string> {
  const dir = getFilesDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

/**
 * Sanitize filename to prevent path traversal and other issues
 */
function sanitizeFilename(name: string): string {
  // Remove path separators and null bytes
  let sanitized = name.replace(/[/\\\x00]/g, '_');
  // Remove leading dots (hidden files)
  sanitized = sanitized.replace(/^\.+/, '');
  // Replace any non-alphanumeric characters (except dots, underscores, hyphens)
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Limit length
  if (sanitized.length > 200) {
    const ext = sanitized.split('.').pop() || '';
    const baseName = sanitized.slice(0, 200 - ext.length - 1);
    sanitized = `${baseName}.${ext}`;
  }
  return sanitized || `file_${Date.now()}`;
}

/**
 * Get allowed file types
 */
export function getAllowedFileTypes(): string[] {
  return [...ALLOWED_FILE_TYPES];
}

/**
 * Check if a file extension is allowed
 */
export function isFileTypeAllowed(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? ALLOWED_FILE_TYPES.includes(ext) : false;
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string | undefined {
  return filename.split('.').pop()?.toLowerCase();
}

/**
 * Download and save a document from Telegram
 *
 * @param doc - The document from Telegram
 * @returns Information about the saved document
 */
export async function saveDocument(doc: TelegramDocument): Promise<SavedDocument> {
  const client = getTelegramClient();

  // Check file size
  if (doc.file_size && doc.file_size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${Math.round(doc.file_size / 1024)}KB (max: ${Math.round(MAX_FILE_SIZE / 1024)}KB)`);
  }

  // Get file info from Telegram
  const fileInfo = await client.getFile(doc.file_id);
  if (!fileInfo.file_path) {
    throw new Error('Could not get file path from Telegram');
  }

  // Download the file
  const buffer = await client.downloadFile(fileInfo.file_path);

  // Ensure directory exists
  const filesDir = await ensureFilesDir();

  // Sanitize filename and ensure uniqueness
  const originalName = doc.file_name || `document_${Date.now()}`;
  const sanitizedName = sanitizeFilename(originalName);
  let finalName = sanitizedName;
  let counter = 1;

  // Handle filename conflicts by appending a counter
  while (existsSync(join(filesDir, finalName))) {
    const ext = getFileExtension(sanitizedName);
    const baseName = sanitizedName.replace(/\.[^.]+$/, '');
    finalName = ext ? `${baseName}_${counter}.${ext}` : `${baseName}_${counter}`;
    counter++;
  }

  const filePath = join(filesDir, finalName);
  await writeFile(filePath, buffer);

  return {
    filePath,
    fileName: finalName,
    fileId: doc.file_id,
    mimeType: doc.mime_type || 'application/octet-stream',
    fileSize: buffer.length,
  };
}

/**
 * Format a message for Claude about the received document
 */
export function formatFileMessageForClaude(savedDoc: SavedDocument, caption?: string): string {
  const sizeKB = Math.round(savedDoc.fileSize / 1024);
  let message = `User sent a file:\n`;
  message += `- Filename: ${savedDoc.fileName}\n`;
  message += `- Path: ${savedDoc.filePath}\n`;
  message += `- Type: ${savedDoc.mimeType}\n`;
  message += `- Size: ${sizeKB}KB\n`;
  message += '\nPlease process this file.';

  if (caption) {
    message += `\n\nUser's caption: ${caption}`;
  }

  return message;
}
