#!/usr/bin/env node

/**
 * Claude Code Stop Hook - Send response to Telegram
 *
 * This script runs when Claude finishes a response.
 * It reads the latest transcript, extracts the assistant's reply,
 * and sends it back to Telegram.
 *
 * Usage: Configured in Claude Code settings as a stop hook
 */

import { readFile, writeFile, unlink, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import { fileURLToPath } from 'url';

// Get the directory of this script for finding .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Cache for .env values
let envCache = null;

/**
 * Load and parse .env file
 */
async function loadEnv() {
  if (envCache) return envCache;

  const envPath = join(PROJECT_ROOT, '.env');
  if (existsSync(envPath)) {
    const content = await readFile(envPath, 'utf-8');
    envCache = {};

    // Parse each line
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        envCache[key] = value;
      }
    }
  }

  return envCache || {};
}

/**
 * Get env value with fallback to process.env
 */
async function getEnv(key, defaultValue = null) {
  const env = await loadEnv();
  return env[key] || process.env[key] || defaultValue;
}

// Read token from .env file (preferred over environment variable)
async function getTokenFromEnv() {
  return getEnv('TELEGRAM_BOT_TOKEN');
}

// Configuration
const STATE_DIR = process.env.STATE_DIR || join(homedir(), '.claude');
const TELEGRAM_CHAT_ID_FILE = join(STATE_DIR, 'telegram_chat_id');
const TELEGRAM_PENDING_FILE = join(STATE_DIR, 'telegram_pending');
// Default timeout: 24 hours (will be overridden by .env if set)
const DEFAULT_PENDING_TIMEOUT_MS = 86400000;

// Token and timeout will be loaded asynchronously
let TELEGRAM_BOT_TOKEN = null;
let PENDING_TIMEOUT_MS = DEFAULT_PENDING_TIMEOUT_MS;

/**
 * Atomic file write
 */
async function atomicWrite(filePath, content) {
  const tempPath = join(tmpdir(), `${basename(filePath)}.${Date.now()}.tmp`);
  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, filePath);
}

/**
 * Read file safely
 */
async function safeRead(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Check if there's a pending message to respond to
 */
async function checkPending() {
  const content = await safeRead(TELEGRAM_PENDING_FILE);
  if (!content) {
    return null;
  }

  try {
    const pending = JSON.parse(content);

    // Check timeout
    const age = Date.now() - pending.timestamp;
    if (age > PENDING_TIMEOUT_MS) {
      console.error(`Pending message expired (${age}ms > ${PENDING_TIMEOUT_MS}ms)`);
      await unlink(TELEGRAM_PENDING_FILE).catch(() => {});
      return null;
    }

    return pending;
  } catch (err) {
    console.error('Failed to parse pending state:', err);
    return null;
  }
}

/**
 * Read the chat ID for responses
 */
async function getChatId() {
  const content = await safeRead(TELEGRAM_CHAT_ID_FILE);
  if (!content) {
    return null;
  }

  try {
    const state = JSON.parse(content);
    return state.chatId;
  } catch {
    return null;
  }
}

/**
 * Characters that need escaping in Telegram MarkdownV2
 */
const TELEGRAM_ESCAPE_CHARS = /[_*[\]()~`>#+=|{}.!-]/g;

/**
 * Escape special characters for Telegram MarkdownV2
 */
function escapeTelegram(text) {
  return text.replace(TELEGRAM_ESCAPE_CHARS, '\\$&');
}

/**
 * Escape only backticks and backslashes for inline code
 */
function escapeInlineCode(text) {
  return text.replace(/[`\\]/g, '\\$&');
}

/**
 * Maximum length for code blocks before truncation
 */
const MAX_CODE_BLOCK_LENGTH = 3500;

/**
 * Parse markdown and convert to Telegram MarkdownV2 format
 */
function markdownToTelegram(markdown) {
  if (!markdown) return '';

  let result = '';
  let i = 0;

  while (i < markdown.length) {
    // Code block (triple backtick)
    if (markdown.slice(i, i + 3) === '```') {
      const endIndex = markdown.indexOf('```', i + 3);
      if (endIndex !== -1) {
        const codeContent = markdown.slice(i + 3, endIndex);
        // Extract language identifier if present
        const firstNewline = codeContent.indexOf('\n');
        const language = firstNewline !== -1 ? codeContent.slice(0, firstNewline).trim() : '';
        const code = firstNewline !== -1 ? codeContent.slice(firstNewline + 1) : codeContent;

        // Build code block with optional language label
        let codeBlock = '```\n';
        if (language) {
          codeBlock += `// ${language}\n`;
        }

        // Truncate very long code blocks
        if (code.length > MAX_CODE_BLOCK_LENGTH) {
          const truncated = code.slice(0, MAX_CODE_BLOCK_LENGTH);
          const lines = truncated.split('\n');
          // Remove last potentially incomplete line
          if (lines.length > 1) {
            lines.pop();
          }
          codeBlock += lines.join('\n');
          codeBlock += '\n\n// ... (truncated, see terminal for full code)';
        } else {
          codeBlock += code;
        }

        codeBlock += '\n```';
        result += codeBlock;
        i = endIndex + 3;
        continue;
      }
    }

    // Inline code (single backtick) - not at start of code block
    if (markdown[i] === '`' && markdown.slice(i, i + 3) !== '```') {
      const endIndex = markdown.indexOf('`', i + 1);
      if (endIndex !== -1 && endIndex !== i + 1) {
        const code = markdown.slice(i + 1, endIndex);
        // Don't include newlines in inline code
        if (!code.includes('\n')) {
          result += '`' + escapeInlineCode(code) + '`';
          i = endIndex + 1;
          continue;
        }
      }
    }

    // Link [text](url)
    if (markdown[i] === '[') {
      const textEnd = markdown.indexOf(']', i);
      if (textEnd !== -1 && markdown[textEnd + 1] === '(') {
        const urlEnd = markdown.indexOf(')', textEnd + 2);
        if (urlEnd !== -1) {
          const linkText = markdown.slice(i + 1, textEnd);
          const url = markdown.slice(textEnd + 2, urlEnd);
          result += '[' + escapeTelegram(linkText) + '](' + url + ')';
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // Bold (**text**)
    if (markdown.slice(i, i + 2) === '**') {
      const endIndex = markdown.indexOf('**', i + 2);
      if (endIndex !== -1) {
        const boldText = markdown.slice(i + 2, endIndex);
        result += '*' + escapeTelegram(boldText) + '*';
        i = endIndex + 2;
        continue;
      }
    }

    // Bold (__text__)
    if (markdown.slice(i, i + 2) === '__') {
      const endIndex = markdown.indexOf('__', i + 2);
      if (endIndex !== -1) {
        const boldText = markdown.slice(i + 2, endIndex);
        result += '*' + escapeTelegram(boldText) + '*';
        i = endIndex + 2;
        continue;
      }
    }

    // Italic (*text* or _text_) - single only
    if ((markdown[i] === '*' || markdown[i] === '_') &&
        markdown[i + 1] !== '*' && markdown[i + 1] !== '_') {
      const char = markdown[i];
      const endIndex = markdown.indexOf(char, i + 1);
      if (endIndex !== -1 && !markdown.slice(i + 1, endIndex).includes('\n')) {
        const italicText = markdown.slice(i + 1, endIndex);
        result += '_' + escapeTelegram(italicText) + '_';
        i = endIndex + 1;
        continue;
      }
    }

    // Regular character - escape if needed
    result += escapeTelegram(markdown[i]);
    i++;
  }

  return result;
}

/**
 * Format message for Telegram
 */
function formatMessage(text) {
  return markdownToTelegram(text);
}

/**
 * Count occurrences of a substring
 */
function countOccurrences(str, substr) {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(substr, pos)) !== -1) {
    count++;
    pos += substr.length;
  }
  return count;
}

/**
 * Split message into chunks (Telegram limit: 4096 chars)
 * Tries to break at sensible points without breaking code blocks
 * Adds continuation markers for multi-part messages
 */
function chunkMessage(text, maxLength = 4000) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;
  const totalLength = text.length;
  let processedLength = 0;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      // Last chunk - add continuation footer if there were previous chunks
      if (chunks.length > 0) {
        chunks.push('─────────\n' + remaining);
      } else {
        chunks.push(remaining);
      }
      break;
    }

    let breakPoint = maxLength;
    let isInsideCodeBlock = false;

    // Check if we're inside a code block at the maxLength position
    const codeBlockCount = countOccurrences(remaining.slice(0, maxLength), '```');
    if (codeBlockCount % 2 === 1) {
      isInsideCodeBlock = true;
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
    processedLength += breakPoint;

    // Add continuation marker
    if (chunks.length === 0) {
      // First chunk - add "continued" indicator at the end
      chunk += '\n\n_\\.\\.\\. continued_';
    } else {
      // Middle chunk - add header and footer
      const remainingPercent = Math.round((remaining.length - breakPoint) / totalLength * 100);
      chunk = `_\\.\\.\\. continued \\(${remainingPercent}% remaining\\)_\n─────────\n` + chunk;
      if (remaining.length > breakPoint) {
        chunk += '\n\n_\\.\\.\\. continued_';
      }
    }

    // Account for continuation markers in length calculation
    // (they're added after we've already determined the break point)

    chunks.push(chunk);
    remaining = remaining.slice(breakPoint);
  }

  return chunks;
}

/**
 * Send message to Telegram
 */
async function sendToTelegram(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not set');
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const chunks = chunkMessage(text);

  for (let i = 0; i < chunks.length; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunks[i],
          parse_mode: 'MarkdownV2',
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        console.error('Telegram API error:', data.description);
        return false;
      }

      // Small delay between chunks
      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (err) {
      console.error('Failed to send to Telegram:', err);
      return false;
    }
  }

  return true;
}

/**
 * Clear the pending state
 */
async function clearPending() {
  try {
    await unlink(TELEGRAM_PENDING_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Extract the last assistant message with text content from Claude transcript (JSONL format)
 */
function extractAssistantMessage(transcriptContent) {
  if (!transcriptContent) {
    return null;
  }

  // Parse JSONL - each line is a separate JSON object
  const lines = transcriptContent.trim().split('\n');
  const entries = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  // Find the last assistant message with actual text content
  const reversedEntries = [...entries].reverse();
  for (const entry of reversedEntries) {
    if (entry.type === 'assistant' && entry.message?.content) {
      const content = entry.message.content;

      // Extract only text blocks (skip thinking, tool_use, etc.)
      const textParts = [];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
      } else if (typeof content === 'string') {
        textParts.push(content);
      }

      // Only return if we found actual text content
      if (textParts.length > 0) {
        return textParts.join('\n\n');
      }
    }
  }

  return null;
}

/**
 * Expand tilde in path
 */
function expandPath(filePath) {
  if (filePath.startsWith('~/')) {
    return join(homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Main entry point
 */
async function main() {
  const log = (msg) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ${msg}`);
  };

  log('Stop hook triggered');

  // Load token from .env file first
  TELEGRAM_BOT_TOKEN = await getTokenFromEnv();
  if (!TELEGRAM_BOT_TOKEN) {
    log('ERROR: TELEGRAM_BOT_TOKEN not found in .env or environment');
    process.exit(1);
  }

  // Load PENDING_TIMEOUT_MS from .env
  const timeoutStr = await getEnv('PENDING_TIMEOUT_MS', '86400000');
  PENDING_TIMEOUT_MS = parseInt(timeoutStr, 10);
  log(`PENDING_TIMEOUT_MS loaded: ${PENDING_TIMEOUT_MS}ms (${PENDING_TIMEOUT_MS / 3600000}h)`);

  // Check for pending message
  const pending = await checkPending();
  if (!pending) {
    log('No pending message to respond to');
    return;
  }
  log(`Found pending message from chat ${pending.chatId}`);

  // Get chat ID
  const chatId = await getChatId();
  if (!chatId) {
    log('ERROR: No chat ID available');
    return;
  }

  // Read hook input from stdin (contains transcript_path)
  let hookInput = null;
  try {
    const stdin = [];
    for await (const chunk of process.stdin) {
      stdin.push(chunk);
    }
    const input = Buffer.concat(stdin).toString('utf-8');
    log(`Received stdin (${input.length} bytes): ${input.slice(0, 200)}...`);
    if (input) {
      hookInput = JSON.parse(input);
    }
  } catch (err) {
    log(`ERROR: Failed to parse stdin: ${err.message}`);
  }

  // Read transcript from the path provided in hook input
  let transcriptContent = null;

  if (hookInput?.transcript_path) {
    const transcriptPath = expandPath(hookInput.transcript_path);
    log(`Reading transcript from: ${transcriptPath}`);

    // Wait a bit for the transcript to be flushed to disk
    await new Promise(resolve => setTimeout(resolve, 500));

    transcriptContent = await safeRead(transcriptPath);
    if (!transcriptContent) {
      log(`ERROR: Failed to read transcript file: ${transcriptPath}`);
    } else {
      log(`Transcript size: ${transcriptContent.length} bytes`);
    }
  } else {
    log('ERROR: No transcript_path in hook input');
  }

  // Extract message
  let message;
  if (transcriptContent) {
    message = extractAssistantMessage(transcriptContent);
    log(`Extracted message length: ${message?.length || 0}`);
  }

  if (!message) {
    // Fallback: send acknowledgment
    message = '✅ Done';
    log('Using fallback message');
  }

  // Format and send
  const formattedMessage = formatMessage(message);
  log(`Sending message (${formattedMessage.length} chars)...`);
  const success = await sendToTelegram(chatId, formattedMessage);

  // Clear pending state on success
  if (success) {
    await clearPending();
    log('Response sent to Telegram successfully');
  } else {
    log('ERROR: Failed to send response');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Hook error:', err);
  process.exit(1);
});
