/**
 * Photo Handling Module
 *
 * Downloads and saves photos from Telegram for Claude to analyze.
 */

import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getTelegramClient, TelegramPhotoSize } from './client.js';

// Photos directory (within workspace)
const PHOTOS_DIR = process.env.PHOTOS_DIR || 'photos';
const MAX_PHOTO_SIZE = parseInt(process.env.MAX_PHOTO_SIZE || '10485760', 10); // 10MB default

/**
 * Photo metadata after saving
 */
export interface SavedPhoto {
  /** Absolute path to saved photo */
  filePath: string;
  /** Original file ID from Telegram */
  fileId: string;
  /** File size in bytes */
  fileSize: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * Get the photos directory path
 */
export function getPhotosDir(): string {
  // Use workspace-relative path or absolute path
  const workspaceDir = process.env.DEFAULT_WORKSPACE || join(process.env.HOME || '', 'workspace');
  if (PHOTOS_DIR.startsWith('/')) {
    return PHOTOS_DIR;
  }
  return join(workspaceDir, PHOTOS_DIR);
}

/**
 * Ensure photos directory exists
 */
async function ensurePhotosDir(): Promise<string> {
  const dir = getPhotosDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

/**
 * Generate a unique filename for a photo
 */
function generateFilename(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `photo_${timestamp}_${random}.jpg`;
}

/**
 * Download and save a photo from Telegram
 *
 * @param photo - The largest photo size from Telegram
 * @returns Information about the saved photo
 */
export async function savePhoto(photo: TelegramPhotoSize): Promise<SavedPhoto> {
  const client = getTelegramClient();

  // Check file size
  if (photo.file_size && photo.file_size > MAX_PHOTO_SIZE) {
    throw new Error(`Photo too large: ${photo.file_size} bytes (max: ${MAX_PHOTO_SIZE})`);
  }

  // Get file info from Telegram
  const fileInfo = await client.getFile(photo.file_id);
  if (!fileInfo.file_path) {
    throw new Error('Could not get file path from Telegram');
  }

  // Download the file
  const buffer = await client.downloadFile(fileInfo.file_path);

  // Ensure directory exists
  const photosDir = await ensurePhotosDir();

  // Generate filename and save
  const filename = generateFilename();
  const filePath = join(photosDir, filename);

  await writeFile(filePath, buffer);

  return {
    filePath,
    fileId: photo.file_id,
    fileSize: buffer.length,
    width: photo.width,
    height: photo.height,
  };
}

/**
 * Get the largest photo from an array of photo sizes
 * Telegram sends multiple sizes, we want the highest quality
 */
export function getLargestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize {
  if (!photos || photos.length === 0) {
    throw new Error('No photos provided');
  }

  // Photos are sorted by size, last one is largest
  return photos[photos.length - 1];
}

/**
 * Format a message for Claude about the received photo
 */
export function formatPhotoMessageForClaude(savedPhoto: SavedPhoto, caption?: string): string {
  let message = `User sent an image saved at: ${savedPhoto.filePath}. `;
  message += `Size: ${savedPhoto.width}x${savedPhoto.height}, ${Math.round(savedPhoto.fileSize / 1024)}KB. `;
  message += 'Please analyze this image.';

  if (caption) {
    message += ` Caption: ${caption}`;
  }

  return message;
}
