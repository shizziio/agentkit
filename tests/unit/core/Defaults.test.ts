import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POLL_INTERVAL,
  MAX_RETRY,
  MAX_CHAIN_LENGTH,
  BUSY_TIMEOUT,
  LOG_BATCH_SIZE,
  LOG_FLUSH_INTERVAL,
} from '@config/defaults';

describe('defaults', () => {
  it('should export DEFAULT_POLL_INTERVAL as 3000', () => {
    expect(DEFAULT_POLL_INTERVAL).toBe(3000);
  });

  it('should export MAX_RETRY as 3', () => {
    expect(MAX_RETRY).toBe(3);
  });

  it('should export MAX_CHAIN_LENGTH as 10', () => {
    expect(MAX_CHAIN_LENGTH).toBe(10);
  });

  it('should export BUSY_TIMEOUT as 5000', () => {
    expect(BUSY_TIMEOUT).toBe(5000);
  });

  it('should export LOG_BATCH_SIZE as 50', () => {
    expect(LOG_BATCH_SIZE).toBe(50);
  });

  it('should export LOG_FLUSH_INTERVAL as 500', () => {
    expect(LOG_FLUSH_INTERVAL).toBe(500);
  });
});
