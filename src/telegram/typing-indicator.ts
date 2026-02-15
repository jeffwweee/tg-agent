/**
 * Typing Indicator Manager
 *
 * Manages periodic typing indicators for Telegram while Claude processes.
 * Telegram's typing indicator expires after ~5 seconds, so we need to
 * periodically resend it while waiting for Claude's response.
 */

import { getTelegramClient } from './client.js';
import { getPending } from '../state/files.js';

// Check interval (how often to check if we should keep typing)
const CHECK_INTERVAL_MS = 4000; // 4 seconds (before 5s timeout)

// Active typing intervals by chat ID
const activeIntervals = new Map<number, NodeJS.Timeout>();

/**
 * Start sending typing indicators for a chat
 *
 * Sends typing action immediately, then periodically checks:
 * 1. If pending state still exists, resend typing
 * 2. If pending cleared (response sent), stop the interval
 */
export function startTypingIndicator(chatId: number): void {
  // Don't start if already active
  if (activeIntervals.has(chatId)) {
    return;
  }

  const client = getTelegramClient();

  // Send initial typing indicator
  client.sendChatAction(chatId, 'typing').catch((err) => {
    console.error('Failed to send initial typing indicator:', err);
  });

  // Set up periodic check
  const interval = setInterval(async () => {
    const pending = await getPending();

    if (!pending || pending.chatId !== chatId) {
      // Pending cleared, stop typing indicator
      stopTypingIndicator(chatId);
      return;
    }

    // Still pending, send another typing indicator
    try {
      await client.sendChatAction(chatId, 'typing');
    } catch (err) {
      console.error('Failed to send typing indicator:', err);
      // Don't stop on error, might be temporary
    }
  }, CHECK_INTERVAL_MS);

  activeIntervals.set(chatId, interval);
}

/**
 * Stop typing indicator for a chat
 */
export function stopTypingIndicator(chatId: number): void {
  const interval = activeIntervals.get(chatId);
  if (interval) {
    clearInterval(interval);
    activeIntervals.delete(chatId);
  }
}

/**
 * Stop all active typing indicators
 */
export function stopAllTypingIndicators(): void {
  for (const [chatId, interval] of activeIntervals) {
    clearInterval(interval);
    activeIntervals.delete(chatId);
  }
}

/**
 * Check if typing indicator is active for a chat
 */
export function isTypingIndicatorActive(chatId: number): boolean {
  return activeIntervals.has(chatId);
}
