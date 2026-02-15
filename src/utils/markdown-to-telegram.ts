/**
 * Markdown to Telegram MarkdownV2 Converter
 *
 * Converts Claude's markdown output to Telegram's MarkdownV2 format.
 * Handles: bold, italic, code blocks, inline code, links, lists
 */

/**
 * Characters that need escaping in Telegram MarkdownV2
 * These must be escaped in plain text but NOT inside code blocks
 */
const TELEGRAM_ESCAPE_CHARS = /[_*[\]()~`>#+=|{}.!-]/g;

/**
 * Maximum length for code blocks before truncation
 */
const MAX_CODE_BLOCK_LENGTH = 3500;

/**
 * Escape special characters for Telegram MarkdownV2
 */
function escapeTelegram(text: string): string {
  return text.replace(TELEGRAM_ESCAPE_CHARS, '\\$&');
}

/**
 * Escape only backticks and backslashes for inline code
 * (Inside inline code, most special chars don't need escaping)
 */
function escapeInlineCode(text: string): string {
  return text.replace(/[`\\]/g, '\\$&');
}

/**
 * Token types for markdown parsing
 */
type TokenType = 'text' | 'code_block' | 'inline_code' | 'bold' | 'italic' | 'link' | 'newline';

interface Token {
  type: TokenType;
  content: string;
  url?: string;
  language?: string;
}

/**
 * Parse markdown into tokens
 */
function tokenizeMarkdown(markdown: string): Token[] {
  const tokens: Token[] = [];
  let remaining = markdown;

  while (remaining.length > 0) {
    // Code block (triple backtick)
    const codeBlockMatch = remaining.match(/^```(\w*)\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      tokens.push({
        type: 'code_block',
        content: codeBlockMatch[2].replace(/\n$/, ''),
        language: codeBlockMatch[1] || '',
      });
      remaining = remaining.slice(codeBlockMatch[0].length);
      continue;
    }

    // Inline code (single backtick) - but not triple
    const inlineCodeMatch = remaining.match(/^`([^`\n]+)`/);
    if (inlineCodeMatch) {
      tokens.push({
        type: 'inline_code',
        content: inlineCodeMatch[1],
      });
      remaining = remaining.slice(inlineCodeMatch[0].length);
      continue;
    }

    // Link [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      tokens.push({
        type: 'link',
        content: linkMatch[1],
        url: linkMatch[2],
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold (** or __)
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*|__(.+?)__/);
    if (boldMatch) {
      tokens.push({
        type: 'bold',
        content: boldMatch[1] || boldMatch[2],
      });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic (* or _) - single only, not double
    const italicMatch = remaining.match(/^(?<![*_])([*_])(.+?)\1(?![*_])/);
    if (italicMatch) {
      tokens.push({
        type: 'italic',
        content: italicMatch[2],
      });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Newline
    if (remaining.startsWith('\n')) {
      tokens.push({ type: 'newline', content: '\n' });
      remaining = remaining.slice(1);
      continue;
    }

    // Plain text - consume until next special character or end
    const textMatch = remaining.match(/^[^`*_\[\n]+/);
    if (textMatch) {
      tokens.push({ type: 'text', content: textMatch[0] });
      remaining = remaining.slice(textMatch[0].length);
      continue;
    }

    // Single special character as text
    tokens.push({ type: 'text', content: remaining[0] });
    remaining = remaining.slice(1);
  }

  return tokens;
}

/**
 * Format code block with optional language label and truncation
 */
function formatCodeBlock(content: string, language: string): string {
  let codeBlock = '```\n';

  // Add language label as comment
  if (language) {
    codeBlock += `// ${language}\n`;
  }

  // Truncate very long code blocks
  if (content.length > MAX_CODE_BLOCK_LENGTH) {
    const truncated = content.slice(0, MAX_CODE_BLOCK_LENGTH);
    const lines = truncated.split('\n');
    // Remove last potentially incomplete line
    if (lines.length > 1) {
      lines.pop();
    }
    codeBlock += lines.join('\n');
    codeBlock += '\n\n// ... (truncated, see terminal for full code)';
  } else {
    codeBlock += content;
  }

  codeBlock += '\n```';
  return codeBlock;
}

/**
 * Convert tokens to Telegram MarkdownV2 format
 */
function tokensToTelegram(tokens: Token[]): string {
  const result: string[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        result.push(escapeTelegram(token.content));
        break;

      case 'newline':
        result.push('\n');
        break;

      case 'code_block':
        result.push(formatCodeBlock(token.content, token.language || ''));
        break;

      case 'inline_code':
        // Inline code - only escape backticks and backslashes inside
        result.push(`\`${escapeInlineCode(token.content)}\``);
        break;

      case 'bold':
        result.push(`*${escapeTelegram(token.content)}*`);
        break;

      case 'italic':
        result.push(`_${escapeTelegram(token.content)}_`);
        break;

      case 'link':
        // Link format: [text](url) - escape text, keep URL as-is
        result.push(`[${escapeTelegram(token.content)}](${token.url})`);
        break;
    }
  }

  return result.join('');
}

/**
 * Post-process to handle edge cases
 */
function postProcess(text: string): string {
  // Fix multiple consecutive newlines (keep max 2)
  text = text.replace(/\n{3,}/g, '\n\n');

  // Ensure code blocks are properly separated
  text = text.replace(/([^\n])\n```/g, '$1\n\n```');
  text = text.replace(/```\n([^\n])/g, '```\n\n$1');

  return text;
}

/**
 * Convert Claude markdown to Telegram MarkdownV2 format
 *
 * @param markdown - The markdown text from Claude
 * @returns Formatted text ready for Telegram API with parse_mode: 'MarkdownV2'
 */
export function markdownToTelegram(markdown: string): string {
  if (!markdown) {
    return '';
  }

  const tokens = tokenizeMarkdown(markdown);
  let result = tokensToTelegram(tokens);
  result = postProcess(result);

  return result;
}

/**
 * Count occurrences of a substring
 */
function countOccurrences(str: string, substr: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(substr, pos)) !== -1) {
    count++;
    pos += substr.length;
  }
  return count;
}

/**
 * Split message into chunks respecting Telegram's 4096 character limit
 * Tries to break at sensible points (paragraphs, then lines)
 * Adds continuation markers for multi-part messages
 *
 * @param text - The text to chunk
 * @param maxLength - Maximum characters per chunk (default: 4000 for safety margin)
 * @returns Array of text chunks
 */
export function chunkMessage(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  const totalLength = text.length;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      // Last chunk - add continuation header if there were previous chunks
      if (chunks.length > 0) {
        chunks.push('─────────\n' + remaining);
      } else {
        chunks.push(remaining);
      }
      break;
    }

    let breakPoint = maxLength;

    // Check if we're inside a code block at the maxLength position
    const codeBlockCount = countOccurrences(remaining.slice(0, maxLength), '```');
    if (codeBlockCount % 2 === 1) {
      // We're inside a code block - find where it ends
      const codeBlockEnd = remaining.indexOf('```', maxLength);
      if (codeBlockEnd !== -1 && codeBlockEnd < maxLength + 2000) {
        breakPoint = codeBlockEnd + 3;
      }
    } else {
      // Look for paragraph break first
      const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
      if (paragraphBreak > maxLength / 2) {
        breakPoint = paragraphBreak + 2;
      } else {
        // Look for line break
        const lineBreak = remaining.lastIndexOf('\n', maxLength);
        if (lineBreak > maxLength / 2) {
          breakPoint = lineBreak + 1;
        }
      }
    }

    let chunk = remaining.slice(0, breakPoint);

    // Add continuation markers
    if (chunks.length === 0) {
      // First chunk - add "continued" indicator at the end
      chunk += '\n\n_\\.\\.\\. continued_';
    } else {
      // Middle chunk - add header with remaining percentage
      const remainingPercent = Math.round((remaining.length - breakPoint) / totalLength * 100);
      chunk = `_\\.\\.\\. continued \\(${remainingPercent}% remaining\\)_\n─────────\n` + chunk;
      if (remaining.length > breakPoint) {
        chunk += '\n\n_\\.\\.\\. continued_';
      }
    }

    chunks.push(chunk);
    remaining = remaining.slice(breakPoint);
  }

  return chunks;
}
