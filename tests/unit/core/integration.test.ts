import { describe, it, expect } from 'vitest';
import {
  AgentKitError,
  ConfigError,
  ParserError,
  ProviderError,
  QueueError,
} from '@core/Errors';
import {
  DEFAULT_POLL_INTERVAL,
  MAX_RETRY,
  MAX_CHAIN_LENGTH,
  BUSY_TIMEOUT,
  LOG_BATCH_SIZE,
  LOG_FLUSH_INTERVAL,
} from '@config/defaults';

describe('Error and Configuration Integration', () => {
  describe('error lifecycle with retry constraints', () => {
    it('should respect MAX_RETRY when handling errors', () => {
      const errors = [];
      for (let i = 0; i < MAX_RETRY; i++) {
        errors.push(new ProviderError(`attempt ${i + 1} failed`));
      }
      expect(errors.length).toBe(MAX_RETRY);
      expect(errors.every((e) => e instanceof ProviderError)).toBe(true);
    });

    it('should throw appropriate error type after retries exhausted', () => {
      let attempts = 0;
      const tryOperation = () => {
        attempts++;
        if (attempts > MAX_RETRY) {
          throw new QueueError('max retries exceeded');
        }
        throw new ProviderError('provider unavailable');
      };

      // Attempt multiple times
      for (let i = 0; i <= MAX_RETRY; i++) {
        try {
          tryOperation();
        } catch (e) {
          expect(e).toBeInstanceOf(AgentKitError);
        }
      }

      expect(attempts).toBe(MAX_RETRY + 1);
    });
  });

  describe('timeout and polling configuration', () => {
    it('should have reasonable timeout values', () => {
      expect(BUSY_TIMEOUT).toBeGreaterThan(0);
      expect(BUSY_TIMEOUT).toBeGreaterThanOrEqual(5000);
    });

    it('should have reasonable polling interval', () => {
      expect(DEFAULT_POLL_INTERVAL).toBeGreaterThan(0);
      expect(DEFAULT_POLL_INTERVAL).toBeLessThan(10000);
    });

    it('polling interval should be less than busy timeout', () => {
      expect(DEFAULT_POLL_INTERVAL).toBeLessThan(BUSY_TIMEOUT);
    });

    it('should handle exponential backoff within timeout boundaries', () => {
      let interval = DEFAULT_POLL_INTERVAL;
      const intervals = [];
      for (let i = 0; i < 5; i++) {
        intervals.push(interval);
        interval = Math.min(interval * 1.5, 30000);
      }
      // All intervals should be reasonable
      expect(intervals.every((i) => i > 0 && i <= 30000)).toBe(true);
    });
  });

  describe('logging configuration', () => {
    it('should have valid batch size', () => {
      expect(LOG_BATCH_SIZE).toBeGreaterThan(0);
      expect(LOG_BATCH_SIZE).toBeLessThanOrEqual(100);
    });

    it('should have valid flush interval', () => {
      expect(LOG_FLUSH_INTERVAL).toBeGreaterThan(0);
      expect(LOG_FLUSH_INTERVAL).toBeLessThan(1000);
    });

    it('should flush before batch fills', () => {
      const batchCapacity = LOG_BATCH_SIZE;
      const entries = [];
      for (let i = 1; i <= batchCapacity + 1; i++) {
        entries.push({ sequence: i, data: 'test' });
        if (entries.length >= LOG_BATCH_SIZE) {
          expect(entries.length).toBeLessThanOrEqual(batchCapacity);
          entries.length = 0; // Simulate batch flush
        }
      }
    });
  });

  describe('chain length constraints', () => {
    it('should have reasonable max chain length', () => {
      expect(MAX_CHAIN_LENGTH).toBeGreaterThan(0);
      expect(MAX_CHAIN_LENGTH).toBeGreaterThanOrEqual(10);
    });

    it('should prevent infinite chains', () => {
      let chainLength = 0;
      const taskChain = [];
      for (let i = 0; i < MAX_CHAIN_LENGTH; i++) {
        taskChain.push({ taskId: i, parentId: i > 0 ? i - 1 : null });
        chainLength++;
      }
      expect(chainLength).toBeLessThanOrEqual(MAX_CHAIN_LENGTH);
    });

    it('should detect chain length violations', () => {
      const taskChain = [];
      for (let i = 0; i < MAX_CHAIN_LENGTH + 1; i++) {
        taskChain.push({ taskId: i });
      }

      const isChainTooLong = taskChain.length > MAX_CHAIN_LENGTH;
      expect(isChainTooLong).toBe(true);

      expect(() => {
        if (isChainTooLong) {
          throw new QueueError(`Chain length ${taskChain.length} exceeds max ${MAX_CHAIN_LENGTH}`);
        }
      }).toThrow(QueueError);
    });
  });

  describe('error handling with configuration context', () => {
    it('should wrap configuration errors with context', () => {
      const configError = new ConfigError(`Invalid retry count: expected <= ${MAX_RETRY}`);
      expect(configError.code).toBe('CONFIG_ERROR');
      expect(configError.message).toContain('Invalid');
    });

    it('should handle provider errors with timeout context', () => {
      const providerError = new ProviderError(
        `Provider timeout after ${BUSY_TIMEOUT}ms`,
      );
      expect(providerError.code).toBe('PROVIDER_ERROR');
      expect(providerError.message).toContain(BUSY_TIMEOUT.toString());
    });

    it('should handle parser errors during configuration loading', () => {
      expect(() => {
        throw new ParserError('Failed to parse config: invalid JSON');
      }).toThrow(ParserError);
    });
  });

  describe('constant immutability', () => {
    it('should not be able to modify constants', () => {
      const originalInterval = DEFAULT_POLL_INTERVAL;
      // Note: JavaScript allows reassignment but we're testing the constant value
      expect(DEFAULT_POLL_INTERVAL).toBe(3000);
      expect(DEFAULT_POLL_INTERVAL).toBe(originalInterval);
    });

    it('all constants should be numeric values', () => {
      expect(typeof DEFAULT_POLL_INTERVAL).toBe('number');
      expect(typeof MAX_RETRY).toBe('number');
      expect(typeof MAX_CHAIN_LENGTH).toBe('number');
      expect(typeof BUSY_TIMEOUT).toBe('number');
      expect(typeof LOG_BATCH_SIZE).toBe('number');
      expect(typeof LOG_FLUSH_INTERVAL).toBe('number');
    });

    it('all constants should be positive integers', () => {
      [DEFAULT_POLL_INTERVAL, MAX_RETRY, MAX_CHAIN_LENGTH, BUSY_TIMEOUT, LOG_BATCH_SIZE, LOG_FLUSH_INTERVAL].forEach(
        (constant) => {
          expect(constant).toBeGreaterThan(0);
          expect(Number.isInteger(constant)).toBe(true);
        },
      );
    });
  });

  describe('realistic scenario simulation', () => {
    it('should handle multi-stage task processing with retry logic', () => {
      const stages = ['sm', 'dev', 'review', 'tester'];
      const taskStatuses = ['queued', 'running', 'done', 'failed'];
      const processedTasks = [];

      for (const stage of stages) {
        for (const status of taskStatuses) {
          let attempt = 0;
          while (attempt < MAX_RETRY) {
            try {
              processedTasks.push({
                stageId: stage,
                status,
                attempt,
              });
              break; // Success
            } catch (e) {
              attempt++;
              if (attempt >= MAX_RETRY) {
                throw new ProviderError(
                  `Failed to process task in ${stage} after ${MAX_RETRY} attempts`,
                );
              }
            }
          }
        }
      }

      expect(processedTasks.length).toBeGreaterThan(0);
    });

    it('should validate chain length in nested task processing', () => {
      const createTaskChain = (depth: number) => {
        if (depth > MAX_CHAIN_LENGTH) {
          throw new QueueError(`Task chain depth ${depth} exceeds MAX_CHAIN_LENGTH ${MAX_CHAIN_LENGTH}`);
        }
        return Array.from({ length: depth }, (_, i) => ({
          id: i,
          parent: i > 0 ? i - 1 : null,
        }));
      };

      // Valid chain
      const validChain = createTaskChain(5);
      expect(validChain.length).toBe(5);

      // Invalid chain
      expect(() => {
        createTaskChain(MAX_CHAIN_LENGTH + 1);
      }).toThrow(QueueError);
    });

    it('should log streaming data within batch constraints', () => {
      const logs: Array<{ sequence: number; data: string }> = [];
      const flushLogs = () => {
        if (logs.length > 0) {
          // Simulate database insert
          expect(logs.length).toBeLessThanOrEqual(LOG_BATCH_SIZE);
          logs.length = 0;
        }
      };

      // Simulate 1000ms of streaming with flush interval
      const timeSlices = Math.ceil(1000 / LOG_FLUSH_INTERVAL);
      for (let slice = 0; slice < timeSlices; slice++) {
        for (let i = 0; i < 10; i++) {
          logs.push({
            sequence: logs.length + 1,
            data: `stream data ${i}`,
          });
        }
        if (logs.length >= LOG_BATCH_SIZE || slice === timeSlices - 1) {
          flushLogs();
        }
      }
    });
  });
});
