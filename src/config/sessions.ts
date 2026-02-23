/**
 * Session Configuration Module
 *
 * Loads and manages session configuration from workspace-level sessions.json.
 * Session ID is set explicitly via TG_SESSION_ID env var (by dev-workspace).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export interface SessionConfig {
  name?: string;
  bot_token_env: string;
  bot_username: string;
  chat_ids: number[];
  allowed_users: number[];
  tmux_session: string;
  tmux_wake_command: string;
  purpose?: string;
}

export interface SessionsConfig {
  sessions: Record<string, SessionConfig>;
  default: string;
}

let cachedConfig: SessionsConfig | null = null;

/**
 * Get the path to sessions.json
 */
function getSessionsConfigPath(): string {
  return process.env['TG_SESSIONS_CONFIG'] ||
    join(process.env['DEV_WORKSPACE_ROOT'] || join(process.cwd(), '..'), 'config/sessions.json');
}

/**
 * Load sessions configuration from workspace-level config file
 */
export function loadSessionsConfig(): SessionsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = getSessionsConfigPath();

  if (!existsSync(configPath)) {
    logger.warn(`Sessions config not found at ${configPath}, using empty config`);
    cachedConfig = { sessions: {}, default: '' };
    return cachedConfig;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    cachedConfig = JSON.parse(content) as SessionsConfig;
    logger.info(`Loaded ${Object.keys(cachedConfig.sessions).length} sessions from ${configPath}`);
    return cachedConfig;
  } catch (error) {
    logger.error(`Failed to load sessions config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    cachedConfig = { sessions: {}, default: '' };
    return cachedConfig;
  }
}

/**
 * Get the current session ID from environment
 */
export function getSessionId(): string {
  return process.env['TG_SESSION_ID'] || 'default';
}

/**
 * Get configuration for a specific session
 */
export function getSessionConfig(sessionId?: string): SessionConfig | null {
  const config = loadSessionsConfig();
  const id = sessionId || getSessionId();
  return config.sessions[id] || null;
}

/**
 * Get configuration for the current session
 */
export function getCurrentSessionConfig(): SessionConfig | null {
  return getSessionConfig(getSessionId());
}

/**
 * Get the default session ID
 */
export function getDefaultSessionId(): string {
  const config = loadSessionsConfig();
  return config.default;
}

/**
 * Get bot token for a session
 */
export function getSessionBotToken(sessionId?: string): string | null {
  const sessionConfig = getSessionConfig(sessionId);
  if (!sessionConfig) {
    return null;
  }
  return process.env[sessionConfig.bot_token_env] || null;
}

/**
 * Find session by bot token
 * Used by gateway to route webhooks to correct session
 */
export function findSessionByBotToken(botToken: string): string | null {
  const config = loadSessionsConfig();

  for (const [sessionId, sessionConfig] of Object.entries(config.sessions)) {
    const envToken = process.env[sessionConfig.bot_token_env];
    if (envToken === botToken) {
      return sessionId;
    }
  }

  return null;
}

/**
 * Check if a chat_id is allowed for a session
 */
export function isChatAllowed(chatId: number, sessionId?: string): boolean {
  const sessionConfig = getSessionConfig(sessionId);
  if (!sessionConfig) {
    return false;
  }
  return sessionConfig.chat_ids.includes(chatId);
}

/**
 * Check if a user_id is allowed for a session
 */
export function isUserAllowed(userId: number, sessionId?: string): boolean {
  const sessionConfig = getSessionConfig(sessionId);
  if (!sessionConfig) {
    return false;
  }
  return sessionConfig.allowed_users.includes(userId);
}

/**
 * Get all session IDs
 */
export function getAllSessionIds(): string[] {
  const config = loadSessionsConfig();
  return Object.keys(config.sessions);
}
