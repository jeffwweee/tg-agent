/**
 * Startup Health Checks Module
 *
 * Runs health checks on server startup to verify all required services
 * are running and configured correctly.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { access, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { getSessionInfo } from '../tmux/inject.js';
import { getTelegramClient } from '../telegram/client.js';
import { getStateDir } from '../state/files.js';

const execAsync = promisify(exec);

export type HealthStatus = 'ok' | 'warning' | 'error';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message: string;
  critical: boolean;
}

export interface StartupHealthReport {
  timestamp: string;
  totalChecks: number;
  passed: number;
  warnings: number;
  errors: number;
  criticalErrors: number;
  results: HealthCheckResult[];
  overallStatus: HealthStatus;
}

/**
 * Run all startup health checks
 */
export async function runStartupChecks(): Promise<StartupHealthReport> {
  const results: HealthCheckResult[] = [];

  // Run all checks
  results.push(await checkTmuxSession());
  results.push(await checkTelegramWebhook());
  results.push(await checkStateDirectory());
  results.push(await checkPhotosDirectory());

  // Optional: Check cloudflared tunnel
  if (process.env.USE_TUNNEL === 'true') {
    results.push(await checkCloudflaredTunnel());
  }

  // Calculate summary
  const passed = results.filter((r) => r.status === 'ok').length;
  const warnings = results.filter((r) => r.status === 'warning').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const criticalErrors = results.filter((r) => r.status === 'error' && r.critical).length;

  // Determine overall status
  let overallStatus: HealthStatus = 'ok';
  if (criticalErrors > 0) {
    overallStatus = 'error';
  } else if (errors > 0 || warnings > 0) {
    overallStatus = 'warning';
  }

  return {
    timestamp: new Date().toISOString(),
    totalChecks: results.length,
    passed,
    warnings,
    errors,
    criticalErrors,
    results,
    overallStatus,
  };
}

/**
 * Check if tmux session with Claude is running
 */
async function checkTmuxSession(): Promise<HealthCheckResult> {
  try {
    const info = await getSessionInfo();
    if (info.exists) {
      const windowsInfo = info.windows ? ` (${info.windows} windows)` : '';
      return {
        name: 'tmux Session',
        status: 'ok',
        message: `Session "${info.name}" is running${windowsInfo}`,
        critical: true,
      };
    }
    return {
      name: 'tmux Session',
      status: 'error',
      message: `Session "${info.name}" not found. Start with: tmux new -s ${info.name}`,
      critical: true,
    };
  } catch (err) {
    return {
      name: 'tmux Session',
      status: 'error',
      message: `Failed to check: ${(err as Error).message}`,
      critical: true,
    };
  }
}

/**
 * Check if Telegram webhook is configured
 */
async function checkTelegramWebhook(): Promise<HealthCheckResult> {
  try {
    const client = getTelegramClient();
    const info = await client.getWebhookInfo();

    if (info.url) {
      // Truncate URL for display
      const displayUrl = info.url.length > 50
        ? info.url.substring(0, 47) + '...'
        : info.url;
      return {
        name: 'Telegram Webhook',
        status: 'ok',
        message: `Configured: ${displayUrl}`,
        critical: true,
      };
    }
    return {
      name: 'Telegram Webhook',
      status: 'warning',
      message: 'No webhook configured. Run: ./bin/webhook.sh set --tunnel',
      critical: false,
    };
  } catch (err) {
    return {
      name: 'Telegram Webhook',
      status: 'error',
      message: `Failed to check: ${(err as Error).message}`,
      critical: true,
    };
  }
}

/**
 * Check if state directory is writable
 */
async function checkStateDirectory(): Promise<HealthCheckResult> {
  const stateDir = getStateDir();

  try {
    // Try to write a test file
    const testFile = join(stateDir, '.healthcheck_test');
    await writeFile(testFile, 'test');
    await unlink(testFile);

    return {
      name: 'State Directory',
      status: 'ok',
      message: `Writable: ${stateDir}`,
      critical: true,
    };
  } catch (err) {
    return {
      name: 'State Directory',
      status: 'error',
      message: `Not writable: ${stateDir} (${(err as Error).message})`,
      critical: true,
    };
  }
}

/**
 * Check if photos directory is writable
 */
async function checkPhotosDirectory(): Promise<HealthCheckResult> {
  const photosDir = process.env.PHOTOS_DIR || join(process.env.DEFAULT_WORKSPACE || process.env.HOME || '', 'photos');

  try {
    // Ensure directory exists
    try {
      await access(photosDir);
    } catch {
      // Directory doesn't exist, which is OK - it will be created on demand
      return {
        name: 'Photos Directory',
        status: 'ok',
        message: `Will be created: ${photosDir}`,
        critical: false,
      };
    }

    // Try to write a test file
    const testFile = join(photosDir, '.healthcheck_test');
    await writeFile(testFile, 'test');
    await unlink(testFile);

    return {
      name: 'Photos Directory',
      status: 'ok',
      message: `Writable: ${photosDir}`,
      critical: false,
    };
  } catch (err) {
    return {
      name: 'Photos Directory',
      status: 'warning',
      message: `Not writable: ${photosDir}`,
      critical: false,
    };
  }
}

/**
 * Check if cloudflared tunnel is running
 */
async function checkCloudflaredTunnel(): Promise<HealthCheckResult> {
  try {
    const { stdout } = await execAsync('pgrep -f cloudflared');
    if (stdout.trim()) {
      return {
        name: 'Cloudflared Tunnel',
        status: 'ok',
        message: 'Tunnel process is running',
        critical: false,
      };
    }
    return {
      name: 'Cloudflared Tunnel',
      status: 'warning',
      message: 'Tunnel not running. Start with: ./bin/start.sh -t',
      critical: false,
    };
  } catch {
    return {
      name: 'Cloudflared Tunnel',
      status: 'warning',
      message: 'Tunnel not running',
      critical: false,
    };
  }
}

/**
 * Format health report for logging
 */
export function formatHealthReportForLog(report: StartupHealthReport): string {
  const lines: string[] = ['=== Startup Health Check ==='];

  for (const result of report.results) {
    const emoji = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
    lines.push(`${emoji} ${result.name}: ${result.message}`);
  }

  lines.push('----------------------------');
  lines.push(`Total: ${report.totalChecks} | Passed: ${report.passed} | Warnings: ${report.warnings} | Errors: ${report.errors}`);

  if (report.criticalErrors > 0) {
    lines.push(`⚠️ ${report.criticalErrors} critical error(s) - running in degraded mode`);
  }

  return lines.join('\n');
}

/**
 * Format health report for Telegram message
 */
export function formatHealthReportForTelegram(report: StartupHealthReport): string {
  const lines: string[] = ['🚀 *tg-agent Started*', '', '*Health Check Results:*'];

  for (const result of report.results) {
    const emoji = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';
    lines.push(`${emoji} ${result.name}`);
  }

  lines.push('', `*Summary:* ${report.passed}/${report.totalChecks} checks passed`);

  if (report.criticalErrors > 0) {
    lines.push('', '⚠️ *Running in degraded mode*');
  }

  return lines.join('\n');
}
