/**
 * Configuration Module
 *
 * Loads and validates environment variables.
 */

export interface Config {
  telegram: {
    botToken: string;
    webhookSecret?: string;
    allowedUsers: number[];
  };
  redis: {
    url: string;
    inboxStreamKey: string;
    consumerGroup: string;
  };
  message: {
    leaseMs: number;
  };
  gateway: {
    port: number;
    host: string;
  };
  mcp: {
    serverName: string;
    serverVersion: string;
  };
  log: {
    level: string;
  };
}

function parseAllowedUsers(value?: string): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => !Number.isNaN(n));
}

export function loadConfig(): Config {
  const webhookSecret = process.env['TELEGRAM_WEBHOOK_SECRET'];
  const config: Config = {
    telegram: {
      botToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
      ...(webhookSecret ? { webhookSecret } : {}),
      allowedUsers: parseAllowedUsers(process.env['TELEGRAM_ALLOWED_USERS']),
    },
    redis: {
      url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      inboxStreamKey: process.env['INBOX_STREAM_KEY'] ?? 'tg:inbox',
      consumerGroup: process.env['INBOX_CONSUMER_GROUP'] ?? 'tg-consumer',
    },
    message: {
      leaseMs: Number(process.env['MESSAGE_LEASE_MS'] ?? '43200000'),
    },
    gateway: {
      port: Number(process.env['GATEWAY_PORT'] ?? '3000'),
      host: process.env['GATEWAY_HOST'] ?? '0.0.0.0',
    },
    mcp: {
      serverName: process.env['MCP_SERVER_NAME'] ?? 'tg-agent',
      serverVersion: process.env['MCP_SERVER_VERSION'] ?? '2.0.0',
    },
    log: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  };

  return config;
}

export function validateConfig(config: Config): void {
  const errors: string[] = [];

  if (!config.telegram.botToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required');
  }

  if (config.telegram.allowedUsers.length === 0) {
    errors.push('TELEGRAM_ALLOWED_USERS is required (comma-separated user IDs)');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

// Singleton config instance
let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
    validateConfig(_config);
  }
  return _config;
}
