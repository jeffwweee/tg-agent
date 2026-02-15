/**
 * Retry Utility Module
 *
 * Provides retry logic with exponential backoff for API calls and other
 * operations that may fail transiently.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Whether to retry on all errors or just retryable ones */
  retryOn?: (error: Error) => boolean;
  /** Callback for retry attempts */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Check if an error is retryable (network errors, 5xx, rate limits)
 */
export function isRetryableError(error: Error): boolean {
  // Network errors
  if (error.message.includes('ECONNREFUSED')) return true;
  if (error.message.includes('ETIMEDOUT')) return true;
  if (error.message.includes('ENOTFOUND')) return true;
  if (error.message.includes('ECONNRESET')) return true;

  // HTTP errors that are retryable
  if (error.message.includes('429')) return true; // Rate limit
  if (error.message.includes('500')) return true;
  if (error.message.includes('502')) return true;
  if (error.message.includes('503')) return true;
  if (error.message.includes('504')) return true;

  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for a given attempt with exponential backoff
 */
function calculateDelay(attempt: number, options: RetryOptions): number {
  const delay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1);
  return Math.min(delay, options.maxDelayMs);
}

/**
 * Execute a function with retry logic and exponential backoff
 *
 * @param fn - The async function to execute
 * @param options - Retry options
 * @returns The result of the function
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      const shouldRetry = attempt < opts.maxRetries &&
        (!opts.retryOn || opts.retryOn(lastError));

      if (!shouldRetry) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delayMs = calculateDelay(attempt, opts);

      // Notify callback if provided
      if (opts.onRetry) {
        opts.onRetry(attempt, lastError, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Execute a function with a timeout
 *
 * @param fn - The async function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param message - Custom timeout error message
 * @returns The result of the function
 * @throws TimeoutError if the function takes too long
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${message} (${timeoutMs}ms)`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Execute a function with both retry and timeout
 *
 * @param fn - The async function to execute
 * @param options - Retry and timeout options
 * @returns The result of the function
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = 30000, ...retryOptions } = options;

  return withRetry(
    () => withTimeout(fn, timeoutMs),
    retryOptions
  );
}
