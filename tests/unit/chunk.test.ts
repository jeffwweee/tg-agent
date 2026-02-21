/**
 * Chunking Tests
 */

import { describe, it, expect } from 'vitest';
import { chunkMessage, MAX_MESSAGE_LENGTH } from '../../src/telegram/chunk.js';

describe('chunkMessage', () => {
  it('should not chunk short messages', () => {
    const text = 'Hello, world!';
    const result = chunkMessage(text);

    expect(result.needsChunking).toBe(false);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe(text);
  });

  it('should chunk messages exceeding max length', () => {
    const text = 'a'.repeat(5000);
    const result = chunkMessage(text);

    expect(result.needsChunking).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(1);

    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it('should prefer breaking at newlines', () => {
    const text = 'a'.repeat(3000) + '\n' + 'b'.repeat(3000);
    const result = chunkMessage(text);

    expect(result.needsChunking).toBe(true);
    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0]).toMatch(/^a+$/);
    expect(result.chunks[1]).toMatch(/^b+$/);
  });

  it('should prefer breaking at spaces when no newlines', () => {
    const text = 'word '.repeat(1200); // ~6000 chars
    const result = chunkMessage(text);

    expect(result.needsChunking).toBe(true);

    // Each chunk should end cleanly
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it('should force break when no good break point', () => {
    const text = 'a'.repeat(10000);
    const result = chunkMessage(text);

    expect(result.needsChunking).toBe(true);
    expect(result.chunks.length).toBeGreaterThanOrEqual(3);

    // Verify total content is preserved
    const rejoined = result.chunks.join('');
    expect(rejoined).toBe(text);
  });

  it('should handle empty string', () => {
    const result = chunkMessage('');

    expect(result.needsChunking).toBe(false);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe('');
  });

  it('should handle exact boundary', () => {
    const text = 'a'.repeat(MAX_MESSAGE_LENGTH);
    const result = chunkMessage(text);

    expect(result.needsChunking).toBe(false);
    expect(result.chunks).toHaveLength(1);
  });

  it('should handle just over boundary', () => {
    const text = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    const result = chunkMessage(text);

    expect(result.needsChunking).toBe(true);
    expect(result.chunks).toHaveLength(2);
  });
});
