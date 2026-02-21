/**
 * Process Management Utilities
 *
 * Helpers for process lifecycle management.
 */

import { logger } from './utils/logger.js';

export interface ShutdownHandler {
  name: string;
  handler: () => Promise<void>;
}

const shutdownHandlers: ShutdownHandler[] = [];
let isShuttingDown = false;

/**
 * Register a shutdown handler
 */
export function registerShutdownHandler(name: string, handler: () => Promise<void>): void {
  shutdownHandlers.push({ name, handler });
}

/**
 * Execute all shutdown handlers in reverse order
 */
export async function executeShutdownHandlers(): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Executing ${shutdownHandlers.length} shutdown handlers...`);

  // Execute in reverse order (LIFO)
  for (let i = shutdownHandlers.length - 1; i >= 0; i--) {
    const { name, handler } = shutdownHandlers[i]!;
    try {
      await handler();
      logger.debug(`Shutdown handler '${name}' complete`);
    } catch (error) {
      logger.error(`Shutdown handler '${name}' failed`, {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
  }

  logger.info('All shutdown handlers executed');
}

/**
 * Setup process signal handlers
 */
export function setupSignalHandlers(): void {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

  for (const signal of signals) {
    process.on(signal, async () => {
      logger.info(`Received ${signal}`);
      await executeShutdownHandlers();
      process.exit(0);
    });
  }

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
      error: error.message,
      stack: error.stack,
    });
    void executeShutdownHandlers().then(() => {
      process.exit(1);
    });
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

/**
 * Get process memory usage in MB
 */
export function getMemoryUsage(): { heapUsed: number; heapTotal: number; rss: number } {
  const mem = process.memoryUsage();
  return {
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    rss: Math.round(mem.rss / 1024 / 1024),
  };
}

/**
 * Log process info
 */
export function logProcessInfo(): void {
  const mem = getMemoryUsage();
  logger.debug('Process info', {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    memory: `${mem.heapUsed}MB / ${mem.heapTotal}MB (RSS: ${mem.rss}MB)`,
  });
}
