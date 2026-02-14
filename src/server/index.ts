import Fastify from 'fastify';
import { config } from 'dotenv';
import { z } from 'zod';
import { registerTelegramRoutes } from './routes/telegram.js';
import { setStateDir } from '../state/files.js';

// Load environment variables
config();

// Environment schema validation
const envSchema = z.object({
  PORT: z.string().default('3000'),
  HOST: z.string().default('0.0.0.0'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_ALLOWED_USERS: z.string().default(''),
  TMUX_SESSION_NAME: z.string().default('claude'),
  STATE_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.string().transform((val) => val === 'true').default('true'),
  PENDING_TIMEOUT_MS: z.string().transform((val) => parseInt(val, 10)).default('600000'),
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

// Health check endpoint
fastify.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
  };
});

// Root endpoint
fastify.get('/', async () => {
  return {
    name: 'tg-agent',
    description: 'Telegram ↔ Claude Code Bridge',
    endpoints: {
      health: '/health',
      webhook: '/telegram/webhook',
    },
  };
});

// Register routes
const start = async () => {
  try {
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
