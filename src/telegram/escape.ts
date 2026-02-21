/**
 * MarkdownV2 Escaping Utility
 *
 * Escapes special characters for Telegram MarkdownV2 formatting.
 */

// Characters that need escaping in MarkdownV2
const MARKDOWN_V2_SPECIAL_CHARS = [
  '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'
];

const ESCAPE_REGEX = new RegExp(`[${MARKDOWN_V2_SPECIAL_CHARS.map(c => `\\${c}`).join('')}]`, 'g');

export function escapeMarkdown(text: string): string {
  return text.replace(ESCAPE_REGEX, (char) => `\\${char}`);
}

export function escapeMarkdownPreserveCode(text: string): string {
  // Split by code blocks and inline code, escape only non-code parts
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);

  return parts
    .map((part) => {
      if (part.startsWith('```') || part.startsWith('`')) {
        return part; // Don't escape code blocks
      }
      return escapeMarkdown(part);
    })
    .join('');
}
