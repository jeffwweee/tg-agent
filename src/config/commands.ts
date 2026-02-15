/**
 * Telegram Bot Commands Configuration
 *
 * These commands are synced with Telegram using the setMyCommands API.
 * Run `./bin/commands.sh sync` to update commands on Telegram.
 */

export interface BotCommand {
  command: string;
  description: string;
}

export const BOT_COMMANDS: BotCommand[] = [
  {
    command: 'start',
    description: 'Start the bot and show welcome message',
  },
  {
    command: 'help',
    description: 'Show available commands and usage',
  },
  {
    command: 'status',
    description: 'Check bridge and server status',
  },
  {
    command: 'clear',
    description: 'Clear Claude Code screen',
  },
  {
    command: 'stop',
    description: 'Cancel current Claude operation',
  },
  {
    command: 'reset',
    description: 'Reset context and return to workspace',
  },
];
