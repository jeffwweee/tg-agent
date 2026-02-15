import { describe, it, expect } from 'vitest';
import { markdownToTelegram, chunkMessage } from './markdown-to-telegram.js';

describe('Markdown to Telegram Converter', () => {
  describe('markdownToTelegram', () => {
    describe('bold', () => {
      it('should convert **text** to *text*', () => {
        expect(markdownToTelegram('**bold text**')).toBe('*bold text*');
      });

      it('should convert __text__ to *text*', () => {
        expect(markdownToTelegram('__bold text__')).toBe('*bold text*');
      });

      it('should handle multiple bold sections', () => {
        expect(markdownToTelegram('**bold1** and **bold2**')).toBe('*bold1* and *bold2*');
      });
    });

    describe('italic', () => {
      it('should convert *text* to _text_', () => {
        expect(markdownToTelegram('*italic text*')).toBe('_italic text_');
      });

      it('should convert _text_ to _text_', () => {
        expect(markdownToTelegram('_italic text_')).toBe('_italic text_');
      });
    });

    describe('inline code', () => {
      it('should preserve inline code', () => {
        expect(markdownToTelegram('`code`')).toBe('`code`');
      });

      it('should not escape special chars inside inline code', () => {
        expect(markdownToTelegram('`x = y + z`')).toBe('`x = y + z`');
      });
    });

    describe('code blocks', () => {
      it('should convert code blocks', () => {
        const input = '```\ncode\n```';
        const result = markdownToTelegram(input);
        expect(result).toContain('```');
        expect(result).toContain('code');
      });

      it('should add language label as comment', () => {
        const input = '```typescript\nconst x = 1;\n```';
        const result = markdownToTelegram(input);
        expect(result).toContain('// typescript');
      });
    });

    describe('links', () => {
      it('should convert links', () => {
        const result = markdownToTelegram('[text](https://example.com)');
        expect(result).toContain('[text]');
        expect(result).toContain('(https://example.com)');
      });
    });

    describe('escaping', () => {
      it('should escape special characters in plain text', () => {
        const result = markdownToTelegram('test_test');
        expect(result).toBe('test\\_test');
      });

      it('should escape dots', () => {
        const result = markdownToTelegram('file.ts');
        expect(result).toBe('file\\.ts');
      });

      it('should escape hyphens', () => {
        const result = markdownToTelegram('some-text');
        expect(result).toBe('some\\-text');
      });
    });

    describe('mixed content', () => {
      it('should handle complex markdown', () => {
        const input = 'Here is **bold** and *italic* with `code`.';
        const result = markdownToTelegram(input);
        expect(result).toContain('*bold*');
        expect(result).toContain('_italic_');
        expect(result).toContain('`code`');
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        expect(markdownToTelegram('')).toBe('');
      });

      it('should handle null/undefined', () => {
        expect(markdownToTelegram(null as unknown as string)).toBe('');
        expect(markdownToTelegram(undefined as unknown as string)).toBe('');
      });
    });
  });

  describe('chunkMessage', () => {
    it('should return single chunk for short messages', () => {
      const text = 'short message';
      const chunks = chunkMessage(text);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('should split long messages', () => {
      const text = 'a'.repeat(10000);
      const chunks = chunkMessage(text, 4000);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should add continuation markers', () => {
      const text = 'a'.repeat(10000);
      const chunks = chunkMessage(text, 4000);
      expect(chunks[0]).toContain('continued');
    });

    it('should not break inside code blocks', () => {
      const codeBlock = '```\n' + 'a'.repeat(5000) + '\n```';
      const text = 'before\n\n' + codeBlock + '\n\nafter';
      const chunks = chunkMessage(text, 4000);

      // Check that no chunk breaks inside code block
      for (const chunk of chunks) {
        const codeBlockCount = (chunk.match(/```/g) || []).length;
        expect(codeBlockCount % 2).toBe(0);
      }
    });
  });
});
