import { describe, it, expect } from 'vitest';
import { formatLocalTime, formatLocalTimeMs, formatLocalDateTime } from '@shared/FormatTime.js';

describe('formatLocalTime', () => {
  it('returns HH:mm:ss matching local timezone for a known UTC timestamp', () => {
    const utc = '2026-03-10T07:23:05.000Z';
    const d = new Date(utc);
    const expected =
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0') +
      ':' +
      String(d.getSeconds()).padStart(2, '0');
    expect(formatLocalTime(utc)).toBe(expected);
  });

  it('returns --:--:-- for empty string', () => {
    expect(formatLocalTime('')).toBe('--:--:--');
  });

  it('returns --:--:-- for invalid string', () => {
    expect(formatLocalTime('not-a-date')).toBe('--:--:--');
  });

  it('output format matches HH:mm:ss pattern', () => {
    const result = formatLocalTime('2026-01-01T00:00:00.000Z');
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('formatLocalTimeMs', () => {
  it('returns same HH:mm:ss as formatLocalTime for equivalent timestamp', () => {
    const utc = '2026-03-10T07:23:05.000Z';
    const ms = new Date(utc).getTime();
    expect(formatLocalTimeMs(ms)).toBe(formatLocalTime(utc));
  });

  it('output format matches HH:mm:ss pattern', () => {
    const result = formatLocalTimeMs(Date.now());
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('formatLocalDateTime', () => {
  it('returns YYYY-MM-DD HH:mm:ss matching local timezone for a known UTC timestamp', () => {
    const utc = '2026-03-10T07:23:05.000Z';
    const d = new Date(utc);
    const expected =
      String(d.getFullYear()).padStart(4, '0') +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0') +
      ' ' +
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0') +
      ':' +
      String(d.getSeconds()).padStart(2, '0');
    expect(formatLocalDateTime(utc)).toBe(expected);
  });

  it('returns ---- -- -- --:--:-- for empty string', () => {
    expect(formatLocalDateTime('')).toBe('---- -- -- --:--:--');
  });

  it('returns ---- -- -- --:--:-- for invalid string', () => {
    expect(formatLocalDateTime('not-a-date')).toBe('---- -- -- --:--:--');
  });

  it('output format matches YYYY-MM-DD HH:mm:ss pattern', () => {
    const result = formatLocalDateTime('2026-01-01T12:30:00.000Z');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('midnight UTC crossing: local date is derived from Date getters, not UTC string', () => {
    // '2026-03-10T00:00:00.000Z' is UTC midnight
    // In UTC-1 (getTimezoneOffset() > 0) local time is 2026-03-09 23:00:00 — previous day
    // In UTC+7 (getTimezoneOffset() < 0) local time is 2026-03-10 07:00:00 — same day
    const utc = '2026-03-10T00:00:00.000Z';
    const d = new Date(utc);
    const localDateResult = formatLocalDateTime(utc).slice(0, 10);
    // The local date in the output must match what Date getters return
    const localDateDirect =
      String(d.getFullYear()).padStart(4, '0') +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');
    expect(localDateResult).toBe(localDateDirect);

    // When local timezone is behind UTC (offset > 0), midnight UTC rolls back to the previous local day
    if (d.getTimezoneOffset() > 0) {
      expect(localDateResult).toBe('2026-03-09');
    }
  });
});
