/**
 * Logger Utility Module
 *
 * Provides structured logging using Pino with pretty printing support.
 */

import pino from 'pino';

export interface LoggerOptions {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  pretty?: boolean;
  name?: string;
}

/**
 * Create a logger instance
 */
export function createLogger(options: LoggerOptions = {}) {
  const {
    level = process.env.LOG_LEVEL || 'info',
    pretty = process.env.LOG_PRETTY === 'true',
    name = 'tg-agent',
  } = options;

  return pino({
    name,
    level,
    transport: pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  });
}

// Default logger instance
export const logger = createLogger();

export default logger;
