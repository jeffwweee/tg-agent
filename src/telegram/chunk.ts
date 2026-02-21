/**
 * Message Chunking Utility
 *
 * Splits long messages into 4000-character chunks for Telegram.
 */

export const MAX_MESSAGE_LENGTH = 4000;

export interface ChunkResult {
  chunks: string[];
  needsChunking: boolean;
}

export function chunkMessage(text: string, maxLength: number = MAX_MESSAGE_LENGTH): ChunkResult {
  if (text.length <= maxLength) {
    return { chunks: [text], needsChunking: false };
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good break point
    let breakPoint = remaining.lastIndexOf('\n', maxLength);
    if (breakPoint === -1 || breakPoint < maxLength * 0.5) {
      breakPoint = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakPoint === -1 || breakPoint < maxLength * 0.5) {
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint).trim());
    remaining = remaining.slice(breakPoint).trim();
  }

  return { chunks, needsChunking: true };
}
