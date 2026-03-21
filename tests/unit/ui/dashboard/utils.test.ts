import { describe, it, expect } from 'vitest';

import { formatDuration } from '@ui/dashboard/shared/utils';

describe('formatDuration', () => {
  describe('seconds only (< 60 seconds)', () => {
    it('returns 0s for 0 milliseconds', () => {
      expect(formatDuration(0)).toBe('0s');
    });

    it('returns Xs for durations under 60 seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(30000)).toBe('30s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('rounds down partial seconds', () => {
      expect(formatDuration(5999)).toBe('5s');
      expect(formatDuration(5500)).toBe('5s');
    });
  });

  describe('minutes and seconds (>= 60 seconds)', () => {
    it('returns 1m 0s for exactly 60 seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
    });

    it('returns Xm Ys for durations >= 60 seconds', () => {
      expect(formatDuration(61000)).toBe('1m 1s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(120000)).toBe('2m 0s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('handles large durations', () => {
      expect(formatDuration(3661000)).toBe('61m 1s');
      expect(formatDuration(3600000)).toBe('60m 0s');
    });

    it('rounds down seconds in minute format', () => {
      expect(formatDuration(125999)).toBe('2m 5s');
      expect(formatDuration(125500)).toBe('2m 5s');
    });
  });

  describe('edge cases', () => {
    it('handles very large millisecond values', () => {
      const oneHourMs = 3600000;
      expect(formatDuration(oneHourMs)).toBe('60m 0s');

      const twoHoursMs = 7200000;
      expect(formatDuration(twoHoursMs)).toBe('120m 0s');
    });

    it('always returns Xs or Xm Ys format', () => {
      const result1 = formatDuration(5000);
      expect(result1).toMatch(/^\d+s$/);

      const result2 = formatDuration(65000);
      expect(result2).toMatch(/^\d+m \d+s$/);
    });
  });
});
