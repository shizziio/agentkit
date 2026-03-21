import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { Logger } from '../../../src/core/Logger.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
    renameSync: vi.fn(),
  };
});

vi.mock('../../../src/core/EventBus.js', () => {
  const emit = vi.fn();
  return {
    default: { emit },
    eventBus: { emit },
  };
});

const mockFs = fs as unknown as {
  mkdirSync: ReturnType<typeof vi.fn>;
  appendFileSync: ReturnType<typeof vi.fn>;
  statSync: ReturnType<typeof vi.fn>;
  unlinkSync: ReturnType<typeof vi.fn>;
  renameSync: ReturnType<typeof vi.fn>;
};

function initLogger(level: 'DEBUG' | 'INFO' = 'INFO'): void {
  Logger.init({ logDir: '/tmp/_agent_kit/logs', level });
}

beforeEach(() => {
  process.env['NODE_ENV'] = 'test';
  Logger.reset();
  vi.clearAllMocks();
  mockFs.statSync.mockReturnValue({ size: 0 });
});

afterEach(() => {
  Logger.reset();
});

describe('file rotation', () => {
  beforeEach(() => initLogger());

  it('no rotation when file size is below 10MB', () => {
    mockFs.statSync.mockReturnValue({ size: 1024 });
    const log = Logger.getLogger('Pipeline');
    log.info('msg');
    expect(mockFs.renameSync).not.toHaveBeenCalled();
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it('rotation occurs when file size is exactly 10MB', () => {
    mockFs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 });
    const log = Logger.getLogger('Pipeline');
    log.info('msg');
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it('rotation occurs when file size exceeds 10MB', () => {
    mockFs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 + 1 });
    const log = Logger.getLogger('Pipeline');
    log.info('msg');
    expect(mockFs.renameSync).toHaveBeenCalled();
  });

  it('rotation: deletes .log.3, renames .log.2->.log.3, .log.1->.log.2, .log->.log.1', () => {
    mockFs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 });
    const log = Logger.getLogger('Pipeline');
    log.info('msg');

    const unlinkCalls = mockFs.unlinkSync.mock.calls as [string][];
    const renameCalls = mockFs.renameSync.mock.calls as [string, string][];

    expect(unlinkCalls.some(([f]) => f.endsWith('.log.3'))).toBe(true);
    expect(renameCalls.some(([from, to]) => from.endsWith('.log.2') && to.endsWith('.log.3'))).toBe(true);
    expect(renameCalls.some(([from, to]) => from.endsWith('.log.1') && to.endsWith('.log.2'))).toBe(true);
    expect(renameCalls.some(([from, to]) => from.endsWith('agentkit.log') && to.endsWith('.log.1'))).toBe(true);
  });

  it('rotation continues even if intermediate backup files are missing (ENOENT ignored)', () => {
    mockFs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 });
    mockFs.renameSync.mockImplementation((from: string) => {
      if (from.endsWith('.log.2')) {
        const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        throw err;
      }
    });

    const log = Logger.getLogger('Pipeline');
    expect(() => log.info('msg')).not.toThrow();
    expect(mockFs.appendFileSync).toHaveBeenCalledOnce();
  });

  it('rotation: non-ENOENT error on renameSync propagates', () => {
    mockFs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 });
    mockFs.renameSync.mockImplementation((from: string) => {
      if (from.endsWith('.log.2')) {
        const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
        throw err;
      }
    });

    const log = Logger.getLogger('Pipeline');
    expect(() => log.info('msg')).toThrow('EACCES');
  });

  it('rotation: non-ENOENT error on unlinkSync propagates', () => {
    mockFs.statSync.mockReturnValue({ size: 10 * 1024 * 1024 });
    mockFs.unlinkSync.mockImplementation(() => {
      const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      throw err;
    });

    const log = Logger.getLogger('Pipeline');
    expect(() => log.info('msg')).toThrow('EACCES');
  });

  it('rotation: ENOENT on statSync (first write) is treated as size 0', () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockFs.statSync.mockImplementation(() => { throw enoent; });
    const log = Logger.getLogger('Pipeline');
    expect(() => log.info('first write')).not.toThrow();
    expect(mockFs.renameSync).not.toHaveBeenCalled();
    expect(mockFs.appendFileSync).toHaveBeenCalledOnce();
  });

  it('statSync non-ENOENT error propagates', () => {
    const permErr = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockFs.statSync.mockImplementation(() => { throw permErr; });
    const log = Logger.getLogger('Pipeline');
    expect(() => log.info('msg')).toThrow('EACCES');
  });
});
