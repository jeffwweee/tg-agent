#!/usr/bin/env node

/**
 * Sync Telegram Bot Commands
 *
 * Usage:
 *   node scripts/sync-commands.mjs         # Sync commands
 *   node scripts/sync-commands.mjs list    # List current commands
 *   node scripts/sync-commands.mjs clear   # Delete all commands
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Load environment from .env file
async function loadEnv() {
  const envPath = join(PROJECT_ROOT, '.env');
  if (existsSync(envPath)) {
    const content = await readFile(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        process.env[key] = value;
      }
    }
  }
}

// Bot commands configuration
const BOT_COMMANDS = [
  { command: 'start', description: 'Start the bot and show welcome message' },
  { command: 'help', description: 'Show available commands and usage' },
  { command: 'status', description: 'Check bridge and server status' },
  { command: 'clear', description: 'Clear Claude Code screen' },
  { command: 'stop', description: 'Cancel current Claude operation' },
  { command: 'reset', description: 'Reset context and return to workspace' },
];

// Telegram API helpers
const getToken = () => process.env.TELEGRAM_BOT_TOKEN;

async function apiCall(method, params = {}) {
  const token = getToken();
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not set');
  }

  const url = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Object.keys(params).length > 0 ? JSON.stringify(params) : undefined,
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }
  return data.result;
}

async function listCommands() {
  console.log('📋 Current bot commands:\n');
  const commands = await apiCall('getMyCommands');
  if (commands.length === 0) {
    console.log('  (no commands set)');
  } else {
    for (const cmd of commands) {
      console.log(`  /${cmd.command} - ${cmd.description}`);
    }
  }
}

async function syncCommands() {
  console.log('🔄 Syncing bot commands...\n');
  console.log('Commands to set:');
  for (const cmd of BOT_COMMANDS) {
    console.log(`  /${cmd.command} - ${cmd.description}`);
  }
  console.log('');

  await apiCall('setMyCommands', { commands: BOT_COMMANDS });
  console.log('✅ Commands synced successfully!\n');

  // Verify
  const current = await apiCall('getMyCommands');
  console.log(`Verified: ${current.length} commands registered`);
}

async function clearCommands() {
  console.log('🗑️  Clearing bot commands...\n');
  await apiCall('deleteMyCommands');
  console.log('✅ All commands cleared');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'sync';

  try {
    await loadEnv();

    switch (command) {
      case 'list':
        await listCommands();
        break;
      case 'clear':
        await clearCommands();
        break;
      case 'sync':
        await syncCommands();
        break;
      default:
        console.log('Usage: node sync-commands.mjs [sync|list|clear]');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
