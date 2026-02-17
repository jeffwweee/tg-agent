#!/usr/bin/env node

/**
 * Claude Code PreToolUse Hook - Permission Request & Selection via Telegram
 *
 * This script runs before Claude uses a tool that requires permission.
 * It handles two types of requests:
 *
 * 1. Tool Permission: Sends approve/deny buttons for tool execution
 * 2. AskUserQuestion: Sends selection options for multi-choice questions
 *
 * Usage: Configured in Claude Code settings as a PreToolUse hook
 *
 * Exit codes:
 *   0 - Approved/Answered (tool can proceed)
 *   2 - Denied/Cancelled (tool should not proceed)
 *   1 - Error or timeout (tool should not proceed)
 */

import { readFile, writeFile, unlink, mkdir, rename, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir, tmpdir } from 'os';
import { fileURLToPath } from 'url';

// Get the directory of this script for finding .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Configuration
const STATE_DIR = process.env.STATE_DIR || join(homedir(), '.claude');
const PERMISSION_DIR = join(STATE_DIR, 'permissions');
const SELECTION_DIR = join(STATE_DIR, 'selections');
const PERMISSION_INDEX_FILE = join(STATE_DIR, 'permission_index');
const SELECTION_INDEX_FILE = join(STATE_DIR, 'selection_index');
const TELEGRAM_CHAT_ID_FILE = join(STATE_DIR, 'telegram_chat_id');
const PERMISSION_RULES_FILE = join(STATE_DIR, 'tool_permissions.json');
const TIMEOUT_MS = parseInt(process.env.PERMISSION_TIMEOUT_MS || '300000', 10); // 5 min default
const SELECTION_TIMEOUT_MS = parseInt(process.env.SELECTION_TIMEOUT_MS || '300000', 10); // 5 min default
const POLL_INTERVAL_MS = 500;

// Token will be loaded asynchronously
let TELEGRAM_BOT_TOKEN = null;

/**
 * Read token from .env file
 */
async function getTokenFromEnv() {
  const envPath = join(PROJECT_ROOT, '.env');
  if (existsSync(envPath)) {
    const content = await readFile(envPath, 'utf-8');
    const match = content.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    if (match) {
      return match[1].trim();
    }
  }
  return process.env.TELEGRAM_BOT_TOKEN;
}

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
 * Ensure directory exists
 */
async function ensureDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Simple glob pattern matcher (supports **, *, ?)
 */
function matchPattern(pattern, str) {
  // Convert glob to regex
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special regex chars
    .replace(/\*\*/g, '<<DOUBLE_STAR>>')    // Temp placeholder
    .replace(/\*/g, '[^/]*')                // * matches anything except /
    .replace(/<<DOUBLE_STAR>>/g, '.*')      // ** matches anything including /
    .replace(/\?/g, '[^/]');                // ? matches single char except /
  regex = '^' + regex + '$';
  return new RegExp(regex).test(str);
}

/**
 * Load permission rules from config file
 */
async function loadPermissionRules() {
  const content = await safeRead(PERMISSION_RULES_FILE);
  if (!content) {
    return { rules: [], defaultAction: 'ask' };
  }
  try {
    const config = JSON.parse(content);
    return {
      rules: config.rules || [],
      defaultAction: config.defaultAction || 'ask'
    };
  } catch {
    return { rules: [], defaultAction: 'ask' };
  }
}

/**
 * Check if tool use matches a rule
 */
function matchesRule(rule, toolName, toolInput) {
  // Check tool match
  if (rule.tools && !rule.tools.includes(toolName)) {
    return false;
  }

  // Check path match (for Write/Edit)
  if (rule.paths) {
    const targetPath = toolInput.file_path || toolInput.path;
    if (!targetPath) return false;

    const matchesPath = rule.paths.some(pattern => matchPattern(pattern, targetPath));
    if (!matchesPath) return false;
  }

  // Check pattern match (for Bash)
  if (rule.patterns) {
    const command = toolInput.command || '';
    const matchesPattern = rule.patterns.some(pattern => {
      // Simple substring match for bash patterns
      return command.includes(pattern);
    });
    if (!matchesPattern) return false;
  }

  return true;
}

/**
 * Check permission rules and return action
 */
function checkPermissionRules(rulesConfig, toolName, toolInput) {
  // Check rules in order (first match wins)
  for (const rule of rulesConfig.rules) {
    if (matchesRule(rule, toolName, toolInput)) {
      return rule.action;
    }
  }
  // Return default action if no rule matches
  return rulesConfig.defaultAction || 'ask';
}

/**
 * Read chat ID from state file
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
 * Generate unique request ID
 */
async function generateRequestId() {
  await ensureDir(STATE_DIR);

  let index = { lastId: 0 };
  const content = await safeRead(PERMISSION_INDEX_FILE);
  if (content) {
    try {
      index = JSON.parse(content);
    } catch {
      // Use default
    }
  }

  index.lastId += 1;
  await atomicWrite(PERMISSION_INDEX_FILE, JSON.stringify(index));

  const timestamp = Date.now().toString(36);
  return `perm_${timestamp}_${index.lastId}`;
}

/**
 * Format tool input for display
 */
function formatToolInput(toolName, input, maxLength = 500) {
  let display = '';

  switch (toolName) {
    case 'Write':
    case 'Edit':
      display = `file: ${input.file_path || 'unknown'}`;
      if (input.content) {
        const content = String(input.content);
        if (content.length > 100) {
          display += `\ncontent: ${content.slice(0, 100)}...`;
        } else {
          display += `\ncontent: ${content}`;
        }
      }
      break;

    case 'Bash':
      display = `command: ${input.command || 'unknown'}`;
      break;

    default:
      const entries = Object.entries(input || {});
      if (entries.length === 0) {
        display = '(no parameters)';
      } else {
        display = entries
          .map(([key, value]) => {
            const strValue = String(value);
            if (strValue.length > 100) {
              return `${key}: ${strValue.slice(0, 100)}...`;
            }
            return `${key}: ${strValue}`;
          })
          .join('\n');
      }
  }

  if (display.length > maxLength) {
    display = display.slice(0, maxLength) + '...';
  }

  return display;
}

/**
 * Escape special characters for Telegram MarkdownV2
 */
function escapeTelegram(text) {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Escape for inline code
 */
function escapeCode(text) {
  return text.replace(/[`\\.]/g, '\\$&');
}

/**
 * Send permission request to Telegram with inline keyboard
 */
async function sendPermissionRequest(chatId, requestId, toolName, toolInput) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN not set');
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const displayInput = formatToolInput(toolName, toolInput);
  const text = `🔧 *Tool Permission Request*\n\n` +
    `*Tool:* ${escapeTelegram(toolName)}\n` +
    `*Parameters:*\n\`\`\`\n${escapeCode(displayInput)}\n\`\`\`\n\n` +
    `_Waiting for your response\\.\\.\\._`;

  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve:${requestId}` },
          { text: '❌ Deny', callback_data: `deny:${requestId}` },
        ],
      ],
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }

  return data.result.message_id;
}

/**
 * Save permission request to state file
 */
async function savePermissionRequest(request) {
  await ensureDir(PERMISSION_DIR);
  const filePath = join(PERMISSION_DIR, `${request.requestId}.json`);
  await atomicWrite(filePath, JSON.stringify(request, null, 2));
}

/**
 * Get permission request from state file
 */
async function getPermissionRequest(requestId) {
  const filePath = join(PERMISSION_DIR, `${requestId}.json`);
  const content = await safeRead(filePath);
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Update permission request
 */
async function updatePermissionRequest(requestId, updates) {
  const request = await getPermissionRequest(requestId);
  if (!request) return null;

  const updated = { ...request, ...updates };
  const filePath = join(PERMISSION_DIR, `${requestId}.json`);
  await atomicWrite(filePath, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Delete permission request
 */
async function deletePermissionRequest(requestId) {
  const filePath = join(PERMISSION_DIR, `${requestId}.json`);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }
}

/**
 * Update Telegram message to show timeout
 */
async function sendTimeoutMessage(chatId, messageId, toolName) {
  if (!TELEGRAM_BOT_TOKEN) return;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;

  const text = `🔧 *Tool Permission Request*\n\n` +
    `*Tool:* ${escapeTelegram(toolName)}\n\n` +
    `⏰ *TIMED OUT* \\- No response received`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'MarkdownV2',
    }),
  }).catch(() => {}); // Ignore errors
}

// ============================================================
// Selection Request Functions (for AskUserQuestion tool)
// ============================================================

/**
 * Generate unique selection request ID
 */
async function generateSelectionRequestId() {
  await ensureDir(STATE_DIR);

  let index = { lastId: 0 };
  const content = await safeRead(SELECTION_INDEX_FILE);
  if (content) {
    try {
      index = JSON.parse(content);
    } catch {
      // Use default
    }
  }

  index.lastId += 1;
  await atomicWrite(SELECTION_INDEX_FILE, JSON.stringify(index));

  const timestamp = Date.now().toString(36);
  return `sel_${timestamp}_${index.lastId}`;
}

/**
 * Save selection request to state file
 */
async function saveSelectionRequest(request) {
  await ensureDir(SELECTION_DIR);
  const filePath = join(SELECTION_DIR, `${request.requestId}.json`);
  await atomicWrite(filePath, JSON.stringify(request, null, 2));
}

/**
 * Get selection request from state file
 */
async function getSelectionRequest(requestId) {
  const filePath = join(SELECTION_DIR, `${requestId}.json`);
  const content = await safeRead(filePath);
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Update selection request
 */
async function updateSelectionRequest(requestId, updates) {
  const request = await getSelectionRequest(requestId);
  if (!request) return null;

  const updated = { ...request, ...updates };
  const filePath = join(SELECTION_DIR, `${requestId}.json`);
  await atomicWrite(filePath, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Delete selection request
 */
async function deleteSelectionRequest(requestId) {
  const filePath = join(SELECTION_DIR, `${requestId}.json`);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }
}

/**
 * Build inline keyboard for selection
 */
function buildSelectionKeyboard(requestId, options, multiSelect) {
  const keyboard = [];

  if (multiSelect) {
    // Multi-select: each button toggles selection
    for (const option of options) {
      const prefix = option.selected ? '☑️ ' : '⬜ ';
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
 * Truncate label for button display
 */
function truncateLabel(label, maxLength) {
  if (label.length <= maxLength) {
    return label;
  }
  return label.slice(0, maxLength - 3) + '...';
}

/**
 * Format selection question for Telegram
 */
function formatSelectionQuestion(question, header, options) {
  let text = '';

  if (header) {
    text += `📋 *${escapeTelegram(header)}*\n\n`;
  } else {
    text += '📋 ';
  }

  text += `${escapeTelegram(question)}\n\n`;

  for (const option of options) {
    text += `*${escapeTelegram(option.label)}*`;
    if (option.description) {
      text += `\n   _${escapeTelegram(option.description)}_`;
    }
    text += '\n\n';
  }

  text += '─────────────────';

  return text;
}

/**
 * Send selection request to Telegram with inline keyboard
 */
async function sendSelectionRequest(chatId, requestId, question, header, options, multiSelect) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN not set');
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const text = formatSelectionQuestion(question, header, options);

  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2',
    reply_markup: buildSelectionKeyboard(requestId, options, multiSelect),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }

  return data.result.message_id;
}

/**
 * Send selection timeout message
 */
async function sendSelectionTimeoutMessage(chatId, messageId, question) {
  if (!TELEGRAM_BOT_TOKEN) return;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`;

  const text = `📋 *Selection Request*\n\n` +
    `${escapeTelegram(question.slice(0, 100))}\n\n` +
    `⏰ *TIMED OUT* \\- No response received`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'MarkdownV2',
    }),
  }).catch(() => {}); // Ignore errors
}

/**
 * Wait for selection response (polling)
 */
async function waitForSelectionResponse(requestId, timeoutMs, pollIntervalMs) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const request = await getSelectionRequest(requestId);

    if (!request) {
      return { status: 'timeout', selectedIndices: [], selectedLabels: [] };
    }

    if (request.status === 'answered') {
      const selectedLabels = request.selectedIndices.map(i => request.options[i]?.label || '');
      const result = {
        status: 'answered',
        selectedIndices: request.selectedIndices,
        selectedLabels,
        customInput: request.customInput,
      };
      await deleteSelectionRequest(requestId);
      return result;
    }

    if (request.status === 'cancelled') {
      await deleteSelectionRequest(requestId);
      return { status: 'cancelled', selectedIndices: [], selectedLabels: [] };
    }

    if (request.status === 'expired') {
      await deleteSelectionRequest(requestId);
      return { status: 'timeout', selectedIndices: [], selectedLabels: [] };
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  // Mark as expired
  await updateSelectionRequest(requestId, { status: 'expired' });
  return { status: 'timeout', selectedIndices: [], selectedLabels: [] };
}

/**
 * Handle AskUserQuestion tool
 */
async function handleAskUserQuestion(chatId, toolInput, log) {
  // Extract questions - Claude sends as array with single question typically
  const questions = toolInput.questions || [];
  if (questions.length === 0) {
    log('ERROR: No questions in AskUserQuestion input');
    console.log(JSON.stringify({ decision: 'block', reason: 'No questions provided' }));
    process.exit(0);
  }

  // Get first question
  const questionData = questions[0];
  const question = questionData.question || 'Please select an option';
  const header = questionData.header;
  const rawOptions = questionData.options || [];
  const multiSelect = toolInput.multiSelect || questionData.multiSelect || false;

  // Convert options to our format
  const options = rawOptions.map((opt, idx) => ({
    index: idx,
    label: opt.label || opt.text || `Option ${idx + 1}`,
    description: opt.description,
    selected: false,
  }));

  log(`Question: ${question.slice(0, 100)}...`);
  log(`Options: ${options.length}, Multi-select: ${multiSelect}`);

  // Generate request ID
  const requestId = await generateSelectionRequestId();
  log(`Selection request ID: ${requestId}`);

  // Save selection request to state
  await saveSelectionRequest({
    requestId,
    question,
    header,
    options,
    multiSelect,
    chatId,
    timestamp: Date.now(),
    status: 'pending',
    selectedIndices: [],
  });

  // Send to Telegram
  let messageId;
  try {
    messageId = await sendSelectionRequest(chatId, requestId, question, header, options, multiSelect);
    log(`Selection message sent (ID: ${messageId})`);

    // Update request with message ID
    await updateSelectionRequest(requestId, { messageId });
  } catch (err) {
    log(`ERROR: Failed to send selection message: ${err.message}`);
    await deleteSelectionRequest(requestId);
    console.log(JSON.stringify({ decision: 'block', reason: `Failed to send selection: ${err.message}` }));
    process.exit(0);
  }

  // Wait for response
  log(`Waiting for selection response (timeout: ${SELECTION_TIMEOUT_MS}ms)...`);
  const result = await waitForSelectionResponse(requestId, SELECTION_TIMEOUT_MS, POLL_INTERVAL_MS);

  if (result.status === 'timeout') {
    log('Selection request timed out');
    await sendSelectionTimeoutMessage(chatId, messageId, question);
    console.log(JSON.stringify({ decision: 'block', reason: 'Selection request timed out' }));
    process.exit(0);
  }

  if (result.status === 'cancelled') {
    log('Selection cancelled');
    console.log(JSON.stringify({ decision: 'block', reason: 'User cancelled selection' }));
    process.exit(0);
  }

  // Answered - return selection to Claude
  log(`Selection answered: indices=${result.selectedIndices.join(',')}, custom=${result.customInput || 'none'}`);

  // Return the selection as the tool output
  const output = {
    selectedIndices: result.selectedIndices,
    selectedLabels: result.selectedLabels,
    customInput: result.customInput || null,
  };

  console.log(JSON.stringify(output));
  process.exit(0);
}

/**
 * Wait for permission response (polling)
 */
async function waitForResponse(requestId, timeoutMs, pollIntervalMs) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const request = await getPermissionRequest(requestId);

    if (!request) {
      return { approved: false, response: 'timeout' };
    }

    if (request.status === 'approved') {
      await deletePermissionRequest(requestId);
      return { approved: true, response: 'approve' };
    }

    if (request.status === 'denied') {
      await deletePermissionRequest(requestId);
      return { approved: false, response: 'deny' };
    }

    if (request.status === 'expired') {
      await deletePermissionRequest(requestId);
      return { approved: false, response: 'timeout' };
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  // Mark as expired
  await updatePermissionRequest(requestId, { status: 'expired' });
  return { approved: false, response: 'timeout' };
}

/**
 * Main entry point
 */
async function main() {
  const log = (msg) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ${msg}`);
  };

  log('Permission hook triggered');

  // Load token
  TELEGRAM_BOT_TOKEN = await getTokenFromEnv();
  if (!TELEGRAM_BOT_TOKEN) {
    log('ERROR: TELEGRAM_BOT_TOKEN not found');
    process.exit(1);
  }

  // Get chat ID
  const chatId = await getChatId();
  if (!chatId) {
    log('ERROR: No chat ID available - send a message first to register chat');
    process.exit(1);
  }

  // Read hook input from stdin
  let hookInput = null;
  try {
    const stdin = [];
    for await (const chunk of process.stdin) {
      stdin.push(chunk);
    }
    const input = Buffer.concat(stdin).toString('utf-8');
    log(`Received stdin (${input.length} bytes)`);
    if (input) {
      hookInput = JSON.parse(input);
    }
  } catch (err) {
    log(`ERROR: Failed to parse stdin: ${err.message}`);
    process.exit(1);
  }

  // Extract tool info
  const toolName = hookInput?.tool_name || hookInput?.tool || 'Unknown';
  const toolInput = hookInput?.tool_input || hookInput?.input || {};

  log(`Tool: ${toolName}`);
  log(`Input: ${JSON.stringify(toolInput).slice(0, 200)}...`);

  // Handle AskUserQuestion tool specially (selection list)
  if (toolName === 'AskUserQuestion') {
    log('Handling AskUserQuestion as selection request');
    await handleAskUserQuestion(chatId, toolInput, log);
    return; // handleAskUserQuestion exits on its own
  }

  // Check permission rules
  const rulesConfig = await loadPermissionRules();
  const action = checkPermissionRules(rulesConfig, toolName, toolInput);
  log(`Rule action: ${action}`);

  if (action === 'allow') {
    log('Auto-approved by rule');
    console.log(JSON.stringify({ decision: 'approve', reason: 'Matched allow rule' }));
    process.exit(0);
  }

  if (action === 'deny') {
    log('Auto-denied by rule');
    console.log(JSON.stringify({ decision: 'block', reason: 'Matched deny rule' }));
    process.exit(0);
  }

  // action === 'ask': proceed to Telegram approval

  // Generate request ID
  const requestId = await generateRequestId();
  log(`Request ID: ${requestId}`);

  // Save request to state
  await savePermissionRequest({
    requestId,
    toolName,
    toolInput,
    chatId,
    timestamp: Date.now(),
    status: 'pending',
  });

  // Send to Telegram
  let messageId;
  try {
    messageId = await sendPermissionRequest(chatId, requestId, toolName, toolInput);
    log(`Message sent (ID: ${messageId})`);

    // Update request with message ID
    await updatePermissionRequest(requestId, { messageId });
  } catch (err) {
    log(`ERROR: Failed to send Telegram message: ${err.message}`);
    await deletePermissionRequest(requestId);
    process.exit(1);
  }

  // Wait for response
  log(`Waiting for response (timeout: ${TIMEOUT_MS}ms)...`);
  const result = await waitForResponse(requestId, TIMEOUT_MS, POLL_INTERVAL_MS);

  if (result.response === 'timeout') {
    log('Permission request timed out');
    await sendTimeoutMessage(chatId, messageId, toolName);
    await deletePermissionRequest(requestId);
    console.log(JSON.stringify({ decision: 'block', reason: 'Permission request timed out' }));
    process.exit(0);
  }

  if (result.approved) {
    log('Permission APPROVED');
    console.log(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  } else {
    log('Permission DENIED');
    console.log(JSON.stringify({ decision: 'block', reason: 'User denied permission' }));
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Hook error:', err);
  process.exit(1);
});
