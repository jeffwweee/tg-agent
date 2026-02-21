/**
 * MarkdownV2 Escape Tests
 */

import { describe, it, expect } from 'vitest';
import { escapeMarkdown, escapeMarkdownPreserveCode } from '../../src/telegram/escape.js';

describe('escapeMarkdown', () => {
  it('should escape special characters', () => {
    const text = 'Hello *world*!';
    const escaped = escapeMarkdown(text);

    expect(escaped).toBe('Hello \\*world\\*\\!');
  });

  it('should escape all special characters', () => {
    const specialChars = '_*[]()~`>#+-=|{}.!';
    const escaped = escapeMarkdown(specialChars);

    // Each character should be escaped
    expect(escaped).toBe(
      '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!'
    );
  });

  it('should not modify plain text', () => {
    const text = 'Hello world';
    const escaped = escapeMarkdown(text);

    expect(escaped).toBe(text);
  });

  it('should handle empty string', () => {
    expect(escapeMarkdown('')).toBe('');
  });

  it('should handle multiple special chars in sequence', () => {
    const text = '***bold***';
    const escaped = escapeMarkdown(text);

    expect(escaped).toBe('\\*\\*\\*bold\\*\\*\\*');
  });
});

describe('escapeMarkdownPreserveCode', () => {
  it('should preserve inline code', () => {
    const text = 'Use `code` here';
    const escaped = escapeMarkdownPreserveCode(text);

    expect(escaped).toBe('Use `code` here');
  });

  it('should preserve code blocks', () => {
    const text = '```javascript\nconst x = 1;\n```';
    const escaped = escapeMarkdownPreserveCode(text);

    expect(escaped).toBe(text);
  });

  it('should escape text outside code', () => {
    const text = 'Hello *world*! `code` here';
    const escaped = escapeMarkdownPreserveCode(text);

    expect(escaped).toBe('Hello \\*world\\*\\! `code` here');
  });

  it('should handle mixed content', () => {
    const text = '*bold* and `code with *` and `more`';
    const escaped = escapeMarkdownPreserveCode(text);

    expect(escaped).toBe('\\*bold\\* and `code with *` and `more`');
  });
});
