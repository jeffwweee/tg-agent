import Fastify from 'fastify';
import { config } from 'dotenv';
import { z } from 'zod';
import { registerTelegramRoutes } from './routes/telegram.js';
import { setStateDir, getPending, getChatId } from '../state/files.js';
import { getTelegramClient } from '../telegram/client.js';
import { sessionExists, getSessionName } from '../tmux/inject.js';
import {
  runStartupChecks,
  formatHealthReportForLog,
  formatHealthReportForTelegram,
} from '../health/startup-checks.js';

// Load environment variables (override existing env vars with .env values)
config({ override: true });

// Environment schema validation
const envSchema = z.object({
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_ALLOWED_USERS: z.string().default(''),
  TMUX_SESSION_NAME: z.string().default('claude'),
  STATE_DIR: z.string().optional(),
  DEFAULT_WORKSPACE: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.string().transform((val) => val === 'true').default('true'),
  PENDING_TIMEOUT_MS: z.string().transform((val) => parseInt(val, 10)).default('600000'),
  NOTIFY_STARTUP: z.string().transform((val) => val === 'true').default('false'),
  USE_TUNNEL: z.string().transform((val) => val === 'true').default('false'),
});

type Env = z.infer<typeof envSchema>;

// Parse and validate environment
const env = envSchema.parse(process.env);

// Set state directory
if (env.STATE_DIR) {
  setStateDir(env.STATE_DIR);
}

// Create Fastify server
const fastify = Fastify({
  logger: process.env.LOG_PRETTY === 'true',
});

// Health check endpoint - basic
fastify.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
  };
});

// Health check endpoint - detailed
fastify.get('/health/detailed', async (request) => {
  const log = request.log;
  const checks: Record<string, { status: 'ok' | 'error' | 'degraded'; details?: string }> = {};

  // Check tmux session
  try {
    const tmuxOk = await sessionExists();
    checks.tmux = {
      status: tmuxOk ? 'ok' : 'error',
      details: tmuxOk ? `Session "${getSessionName()}" running` : `Session "${getSessionName()}" not found`,
    };
  } catch (err) {
    log.warn({ err }, 'Health check: tmux check failed');
    checks.tmux = { status: 'error', details: (err as Error).message };
  }

  // Check Telegram API
  try {
    const client = getTelegramClient();
    await client.getMe();
    checks.telegram = { status: 'ok', details: 'API reachable' };
  } catch (err) {
    log.warn({ err }, 'Health check: Telegram check failed');
    checks.telegram = { status: 'error', details: (err as Error).message };
  }

  // Check pending state
  try {
    const pending = await getPending();
    checks.pending = {
      status: 'ok',
      details: pending ? `Message pending for ${Math.round((Date.now() - pending.timestamp) / 1000)}s` : 'No pending messages',
    };
  } catch (err) {
    log.warn({ err }, 'Health check: pending check failed');
    checks.pending = { status: 'error', details: (err as Error).message };
  }

  // Determine overall status
  const hasError = Object.values(checks).some((c) => c.status === 'error');
  const hasDegraded = Object.values(checks).some((c) => c.status === 'degraded');
  const overallStatus = hasError ? 'error' : hasDegraded ? 'degraded' : 'ok';

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
    uptime: process.uptime(),
    checks,
  };
});

// Root endpoint
fastify.get('/', async () => {
  return {
    name: 'tg-agent',
    description: 'Telegram ↔ Claude Code Bridge',
    version: process.env.npm_package_version || '0.1.0',
    endpoints: {
      health: '/health',
      healthDetailed: '/health/detailed',
      webhook: '/telegram/webhook',
    },
  };
});

// Register routes
const start = async () => {
  try {
    // Run startup health checks
    const healthReport = await runStartupChecks();
    fastify.log.info(formatHealthReportForLog(healthReport));

    // Send Telegram notification if enabled
    if (env.NOTIFY_STARTUP) {
      try {
        const chatId = await getChatId();
        if (chatId) {
          const client = getTelegramClient();
          await client.sendMessage(chatId, formatHealthReportForTelegram(healthReport), {
            parse_mode: 'Markdown',
          });
          fastify.log.info('Startup notification sent to Telegram');
        }
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to send startup notification');
      }
    }

    // Check for critical errors and log warning
    if (healthReport.criticalErrors > 0) {
      fastify.log.warn('Starting in degraded mode due to critical errors');
    }

    // Register Telegram routes
    await registerTelegramRoutes(fastify);

    // Start server
    await fastify.listen({ port: parseInt(env.PORT, 10), host: env.HOST });
    fastify.log.info(`🤖 tg-agent listening on ${env.HOST}:${env.PORT}`);
    fastify.log.info(`📡 Webhook endpoint: http://${env.HOST}:${env.PORT}/telegram/webhook`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (signal: string) => {
  fastify.log.info(`Received ${signal}, shutting down...`);
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();

export { env, fastify };
export type { Env };
