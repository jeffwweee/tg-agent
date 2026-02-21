/**
 * tg-agent v2 - Telegram Gateway + MCP Server
 *
 * Entry point that runs Gateway and/or MCP Server based on flags.
 *
 * Usage:
 *   node dist/index.js              # Run both gateway and MCP
 *   node dist/index.js --gateway    # Run gateway only
 *   node dist/index.js --mcp        # Run MCP only
 */

import { config } from 'dotenv';
config();

import { createGateway, shutdownGateway } from './gateway/server.js';
import { createMcpServer, connectMcpServer } from './mcp/server.js';
import { loadConfig, validateConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import type { Express } from 'express';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Parse command line arguments
const args = process.argv.slice(2);
const runGateway = args.includes('--gateway') || (!args.includes('--mcp') && !args.includes('--gateway'));
const runMcp = args.includes('--mcp') || (!args.includes('--gateway') && !args.includes('--mcp'));

// Track running services for graceful shutdown
let gatewayApp: Express | null = null;
let mcpServer: Server | null = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  const shutdownPromises: Promise<void>[] = [];

  // Shutdown gateway
  if (gatewayApp !== null) {
    shutdownPromises.push(
      shutdownGateway(gatewayApp)
        .then(() => {
          logger.info('Gateway shutdown complete');
        })
        .catch((error) => {
          logger.error('Gateway shutdown error', { error: error instanceof Error ? error.message : 'Unknown' });
        })
    );
  }

  // MCP server shutdown is handled by the SDK when stdin closes
  // No explicit shutdown needed for stdio transport

  await Promise.all(shutdownPromises);

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Load and validate configuration
  const cfg = loadConfig();

  try {
    validateConfig(cfg);
  } catch (error) {
    logger.error('Configuration error', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    process.exit(1);
  }

  logger.info('Starting tg-agent v2', {
    gateway: runGateway,
    mcp: runMcp,
    logLevel: cfg.log.level,
  });

  // Register shutdown handlers
  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });

  // Start Gateway
  if (runGateway) {
    gatewayApp = createGateway();
    const port = cfg.gateway.port;
    const host = cfg.gateway.host;

    await new Promise<void>((resolve) => {
      gatewayApp!.listen(port, host, () => {
        logger.info(`Gateway listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  // Start MCP Server
  if (runMcp) {
    mcpServer = createMcpServer({
      name: cfg.mcp.serverName,
      version: cfg.mcp.serverVersion,
    });

    await connectMcpServer(mcpServer);
    logger.info('MCP Server connected via stdio');
  }

  // If running both, log that we're in hybrid mode
  if (runGateway && runMcp) {
    logger.info('Running in hybrid mode (Gateway + MCP)');
  }

  // Keep the process alive if running gateway
  // MCP server keeps itself alive via stdio
  if (runGateway && !runMcp) {
    logger.info('Gateway-only mode - press Ctrl+C to stop');
  }
}

// Run main
main().catch((error) => {
  logger.error('Fatal error', {
    error: error instanceof Error ? error.message : 'Unknown',
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
