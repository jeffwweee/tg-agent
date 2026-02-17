/**
 * Telegram Selection UI Module
 *
 * Provides functions for building selection UI components:
 * - Inline keyboards for single/multi-select
 * - Message formatting for selection questions
 */

import { InlineKeyboardMarkup, InlineKeyboardButton } from './client.js';
import { SelectionOption } from '../state/selection.js';

/**
 * Escape special characters for Telegram MarkdownV2
 */
export function escapeTelegramMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Escape text for inline code blocks
 */
export function escapeCodeBlock(text: string): string {
  return text.replace(/[`\\.]/g, '\\$&');
}

/**
 * Build inline keyboard for selection
 *
 * Single-select: Each option is a button, tapping submits immediately
 * Multi-select: Toggle buttons + Submit/Cancel row
 * Always includes "Type something" and "Cancel" options
 */
export function buildSelectionKeyboard(
  requestId: string,
  options: SelectionOption[],
  selectedIndices: number[],
  multiSelect: boolean
): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = [];

  if (multiSelect) {
    // Multi-select: each button toggles selection
    for (const option of options) {
      const isSelected = selectedIndices.includes(option.index);
      const prefix = isSelected ? '☑️ ' : '⬜ ';
      const text = `${prefix}${truncateLabel(option.label, 30)}`;

      keyboard.push([{
        text,
        callback_data: `toggle:${requestId}:${option.index}`,
      }]);
    }

    // Submit and Cancel row
    keyboard.push([
      { text: '✓ Submit', callback_data: `submit:${requestId}` },
      { text: '✗ Cancel', callback_data: `cancel:${requestId}` },
    ]);
  } else {
    // Single-select: each button submits immediately
    for (const option of options) {
      keyboard.push([{
        text: truncateLabel(option.label, 35),
        callback_data: `select:${requestId}:${option.index}`,
      }]);
    }

    // Type something and Cancel row
    keyboard.push([
      { text: '✏️ Type something', callback_data: `custom:${requestId}` },
      { text: '✗ Cancel', callback_data: `cancel:${requestId}` },
    ]);
  }

  return { inline_keyboard: keyboard };
}

/**
 * Format selection question for Telegram message
 */
export function formatSelectionQuestion(
  question: string,
  header: string | undefined,
  options: SelectionOption[],
  selectedIndices: number[],
  multiSelect: boolean
): string {
  let text = '';

  // Add header if present
  if (header) {
    text += `📋 *${escapeTelegramMarkdown(header)}*\n\n`;
  } else {
    text += '📋 ';
  }

  // Add question
  text += `${escapeTelegramMarkdown(question)}\n\n`;

  // Add options with descriptions
  for (const option of options) {
    const isSelected = selectedIndices.includes(option.index);

    if (multiSelect) {
      text += isSelected ? '☑️ ' : '⬜ ';
    } else {
      text += '';
    }

    text += `*${escapeTelegramMarkdown(option.label)}*`;

    if (option.description) {
      text += `\n   _${escapeTelegramMarkdown(option.description)}_`;
    }

    text += '\n\n';
  }

  text += '─────────────────';

  return text;
}

/**
 * Truncate a label to max length
 */
function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) {
    return label;
  }
  return label.slice(0, maxLength - 3) + '...';
}

/**
 * Parse callback data for selection actions
 *
 * Formats:
 * - select:{requestId}:{optionIndex} - Single-select choice
 * - toggle:{requestId}:{optionIndex} - Multi-select toggle
 * - submit:{requestId} - Submit multi-select
 * - custom:{requestId} - Request custom text input
 * - cancel:{requestId} - Cancel selection
 */
export function parseSelectionCallback(callbackData: string): {
  action: 'select' | 'toggle' | 'submit' | 'custom' | 'cancel';
  requestId: string;
  optionIndex?: number;
} | null {
  const parts = callbackData.split(':');

  if (parts.length < 2) {
    return null;
  }

  const action = parts[0] as 'select' | 'toggle' | 'submit' | 'custom' | 'cancel';
  const requestId = parts[1];

  if (!['select', 'toggle', 'submit', 'custom', 'cancel'].includes(action)) {
    return null;
  }

  const result: { action: typeof action; requestId: string; optionIndex?: number } = {
    action,
    requestId,
  };

  if ((action === 'select' || action === 'toggle') && parts.length >= 3) {
    result.optionIndex = parseInt(parts[2], 10);
    if (isNaN(result.optionIndex)) {
      return null;
    }
  }

  return result;
}

/**
 * Format the answered message (shown after user makes selection)
 */
export function formatAnsweredMessage(
  question: string,
  selectedLabels: string[],
  customInput?: string
): string {
  let text = '📋 *Selection Made*\n\n';
  text += `*Question:* ${escapeTelegramMarkdown(question)}\n\n`;

  if (customInput) {
    text += `*Your answer:*\n"${escapeTelegramMarkdown(customInput)}"`;
  } else if (selectedLabels.length > 0) {
    text += '*Selected:*\n';
    for (const label of selectedLabels) {
      text += `• ${escapeTelegramMarkdown(label)}\n`;
    }
  }

  return text;
}

/**
 * Format the cancelled message
 */
export function formatCancelledMessage(question: string): string {
  return `📋 *Selection Cancelled*\n\n*Question:* ${escapeTelegramMarkdown(question)}\n\n_Cancelled by user._`;
}

/**
 * Format the "awaiting input" prompt
 */
export function formatAwaitingInputPrompt(question: string): string {
  return `💬 *Type your answer below...*\n\n_Your next message will be used as the response to:_\n${escapeTelegramMarkdown(question)}`;
}
