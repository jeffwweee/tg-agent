import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, withTimeout, isRetryableError } from './retry.js';

describe('Retry Utility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isRetryableError', () => {
    it('should identify network errors as retryable', () => {
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
    });

    it('should identify HTTP 5xx errors as retryable', () => {
      expect(isRetryableError(new Error('500 Internal Server Error'))).toBe(true);
      expect(isRetryableError(new Error('502 Bad Gateway'))).toBe(true);
      expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isRetryableError(new Error('504 Gateway Timeout'))).toBe(true);
    });

    it('should identify rate limit (429) as retryable', () => {
      expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
    });

    it('should not identify client errors as retryable', () => {
      expect(isRetryableError(new Error('400 Bad Request'))).toBe(false);
      expect(isRetryableError(new Error('401 Unauthorized'))).toBe(false);
      expect(isRetryableError(new Error('404 Not Found'))).toBe(false);
    });

    it('should not identify unknown errors as retryable', () => {
      expect(isRetryableError(new Error('Something went wrong'))).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('should return result on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn, { maxRetries: 3 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValue('success');

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        retryOn: isRetryableError,
      });

      // Advance timers for retries
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exceeded', async () => {
      const error = new Error('ECONNREFUSED');
      const fn = vi.fn().mockRejectedValue(error);

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        retryOn: isRetryableError,
      });

      await vi.runAllTimersAsync();

      try {
        await resultPromise;
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toBe('ECONNREFUSED');
      }

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const error = new Error('400 Bad Request');
      const fn = vi.fn().mockRejectedValue(error);

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        retryOn: isRetryableError,
      });

      await vi.runAllTimersAsync();

      try {
        await resultPromise;
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toBe('400 Bad Request');
      }

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        onRetry,
        retryOn: isRetryableError,
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 100);
    });
  });

  describe('withTimeout', () => {
    it('should return result before timeout', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withTimeout(fn, 1000);

      expect(result).toBe('success');
    });

    it('should throw on timeout', async () => {
      const fn = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 2000))
      );

      const resultPromise = withTimeout(fn, 100, 'Custom timeout');

      await vi.runAllTimersAsync();

      try {
        await resultPromise;
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('Custom timeout');
      }
    });

    it('should propagate errors from function', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Function error'));

      const resultPromise = withTimeout(fn, 1000);

      try {
        await resultPromise;
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toBe('Function error');
      }
    });
  });
});
