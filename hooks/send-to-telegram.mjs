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
import { join, basename } from 'path';
import { homedir, tmpdir } from 'os';
import { argv } from 'process';

// Configuration
const STATE_DIR = process.env.STATE_DIR || join(homedir(), '.claude');
const TELEGRAM_CHAT_ID_FILE = join(STATE_DIR, 'telegram_chat_id');
const TELEGRAM_PENDING_FILE = join(STATE_DIR, 'telegram_pending');
const PENDING_TIMEOUT_MS = parseInt(process.env.PENDING_TIMEOUT_MS || '600000', 10);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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
 * Escape text for Telegram MarkdownV2
 */
function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Format message for Telegram
 */
function formatMessage(text) {
  // For now, just escape the text
  // TODO: Better markdown conversion from Claude's format
  return escapeMarkdown(text);
}

/**
 * Split message into chunks (Telegram limit: 4096 chars)
 */
function chunkMessage(text, maxLength = 4000) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Try to find a good break point
    let breakPoint = maxLength;

    // Look for paragraph break
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

    chunks.push(remaining.slice(0, breakPoint));
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
 * Extract assistant message from Claude transcript
 */
function extractAssistantMessage(transcript) {
  if (!transcript || !transcript.entries) {
    return null;
  }

  // Find the last assistant message
  const entries = [...transcript.entries].reverse();
  for (const entry of entries) {
    if (entry.type === 'assistant' && entry.message?.content) {
      // Extract text from content blocks
      const textParts = [];
      for (const block of entry.message.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          textParts.push(`[Tool: ${block.name}]`);
        }
      }
      return textParts.join('\n\n');
    }
  }

  return null;
}

/**
 * Main entry point
 */
async function main() {
  // Check for pending message
  const pending = await checkPending();
  if (!pending) {
    console.log('No pending message to respond to');
    return;
  }

  // Get chat ID
  const chatId = await getChatId();
  if (!chatId) {
    console.error('No chat ID available');
    return;
  }

  // Read transcript from stdin or file
  let transcriptData = null;

  // Check if transcript path is provided as argument
  const transcriptPath = argv[2];

  if (transcriptPath) {
    const content = await safeRead(transcriptPath);
    if (content) {
      try {
        transcriptData = JSON.parse(content);
      } catch {
        console.error('Failed to parse transcript file');
      }
    }
  } else {
    // Try reading from stdin
    try {
      const stdin = [];
      for await (const chunk of process.stdin) {
        stdin.push(chunk);
      }
      const input = Buffer.concat(stdin).toString('utf-8');
      if (input) {
        transcriptData = JSON.parse(input);
      }
    } catch {
      // No stdin data
    }
  }

  // Extract message
  let message;
  if (transcriptData) {
    message = extractAssistantMessage(transcriptData);
  }

  if (!message) {
    // Fallback: send acknowledgment
    message = '✅ Done';
  }

  // Format and send
  const formattedMessage = formatMessage(message);
  const success = await sendToTelegram(chatId, formattedMessage);

  // Clear pending state on success
  if (success) {
    await clearPending();
    console.log('Response sent to Telegram');
  } else {
    console.error('Failed to send response');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Hook error:', err);
  process.exit(1);
});
