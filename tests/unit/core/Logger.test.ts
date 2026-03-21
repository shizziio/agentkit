import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoggerError } from '../../../src/core/Errors.js';
import * as fs from 'node:fs';
import { Logger, LoggerInstance } from '../../../src/core/Logger.js';
import eventBus from '../../../src/core/EventBus.js';

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
  // Default: statSync returns size 0 (file exists but small)
  mockFs.statSync.mockReturnValue({ size: 0 });
});

afterEach(() => {
  Logger.reset();
});

describe('Logger initialization', () => {
  it('getLogger() before init() throws LoggerError with descriptive message', () => {
    expect(() => Logger.getLogger('Test')).toThrow(LoggerError);
    expect(() => Logger.getLogger('Test')).toThrow('Logger not initialized. Call Logger.init() first.');
  });

  it('init() creates the log directory', () => {
    initLogger();
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('logs'), { recursive: true });
  });

  it('init() called twice is a no-op (singleton)', () => {
    initLogger('INFO');
    initLogger('DEBUG'); // second call ignored
    expect(mockFs.mkdirSync).toHaveBeenCalledTimes(1);
  });

  it('getLogger() returns a LoggerInstance', () => {
    initLogger();
    const log = Logger.getLogger('Pipeline');
    expect(log).toBeInstanceOf(LoggerInstance);
  });

  it('LoggerInstance has debug/info/warn/error methods', () => {
    initLogger();
    const log = Logger.getLogger('Pipeline');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });
});

describe('log line format', () => {
  beforeEach(() => initLogger());

  it('info() writes correct format to file', () => {
    const log = Logger.getLogger('Pipeline');
    log.info('msg');
    expect(mockFs.appendFileSync).toHaveBeenCalledOnce();
    const [, line] = mockFs.appendFileSync.mock.calls[0] as [string, string];
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[INFO\]  \[Pipeline\] msg\n$/);
  });

  it('warn() writes correct format to file', () => {
    const log = Logger.getLogger('Worker');
    log.warn('something odd');
    const [, line] = mockFs.appendFileSync.mock.calls[0] as [string, string];
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[WARN\]  \[Worker\] something odd\n$/);
  });

  it('error() writes correct format to file', () => {
    const log = Logger.getLogger('Queue');
    log.error('crash');
    const [, line] = mockFs.appendFileSync.mock.calls[0] as [string, string];
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[ERROR\]  \[Queue\] crash\n$/);
  });

  it('data object is appended as JSON after a space', () => {
    const log = Logger.getLogger('Pipeline');
    log.info('task done', { taskId: 5, exitCode: 0 });
    const [, line] = mockFs.appendFileSync.mock.calls[0] as [string, string];
    expect(line).toContain(' {"taskId":5,"exitCode":0}');
  });

  it('no data — line does not contain trailing JSON', () => {
    const log = Logger.getLogger('Pipeline');
    log.info('simple message');
    const [, line] = mockFs.appendFileSync.mock.calls[0] as [string, string];
    const tsMatch = line.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)?.[0];
    expect(line.trim()).toBe('[' + (tsMatch ?? '') + '] [INFO]  [Pipeline] simple message');
  });
});

describe('EventBus emission rules', () => {
  beforeEach(() => initLogger('DEBUG'));

  it('info() emits app:log event', () => {
    const log = Logger.getLogger('Pipeline');
    log.info('hello');
    expect(eventBus.emit).toHaveBeenCalledWith('app:log', expect.objectContaining({
      level: 'INFO',
      module: 'Pipeline',
      message: 'hello',
    }));
  });

  it('warn() emits app:log event', () => {
    const log = Logger.getLogger('SM');
    log.warn('watch out');
    expect(eventBus.emit).toHaveBeenCalledWith('app:log', expect.objectContaining({
      level: 'WARN',
      module: 'SM',
      message: 'watch out',
    }));
  });

  it('error() emits app:log event', () => {
    const log = Logger.getLogger('Dev');
    log.error('fail');
    expect(eventBus.emit).toHaveBeenCalledWith('app:log', expect.objectContaining({
      level: 'ERROR',
    }));
  });

  it('debug() NEVER emits app:log event even when level is DEBUG', () => {
    const log = Logger.getLogger('Pipeline');
    log.debug('polling');
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('emitted payload includes timestamp and data', () => {
    const log = Logger.getLogger('Pipeline');
    log.info('msg', { key: 'val' });
    expect(eventBus.emit).toHaveBeenCalledWith('app:log', expect.objectContaining({
      data: { key: 'val' },
      timestamp: expect.stringMatching(/\d{4}-\d{2}-\d{2}T.*Z/),
    }));
  });
});

describe('level filtering', () => {
  it('INFO level: debug() does NOT write to file', () => {
    initLogger('INFO');
    const log = Logger.getLogger('Pipeline');
    log.debug('verbose detail');
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });

  it('INFO level: debug() does NOT emit event', () => {
    initLogger('INFO');
    const log = Logger.getLogger('Pipeline');
    log.debug('verbose detail');
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('DEBUG level: debug() writes to file', () => {
    initLogger('DEBUG');
    const log = Logger.getLogger('Pipeline');
    log.debug('polling queue');
    expect(mockFs.appendFileSync).toHaveBeenCalledOnce();
  });

  it('DEBUG level: info/warn/error all write to file', () => {
    initLogger('DEBUG');
    const log = Logger.getLogger('Pipeline');
    log.info('a');
    log.warn('b');
    log.error('c');
    expect(mockFs.appendFileSync).toHaveBeenCalledTimes(3);
  });
});

describe('EventBus error handling', () => {
  beforeEach(() => initLogger());

  it('EventBus emit error does not throw from logger methods', () => {
    (eventBus.emit as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('subscriber crashed');
    });
    const log = Logger.getLogger('Pipeline');
    expect(() => log.info('msg')).not.toThrow();
  });
});

describe('data serialization edge cases', () => {
  beforeEach(() => initLogger());

  it('circular reference in data is handled gracefully', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const log = Logger.getLogger('Pipeline');
    expect(() => log.info('circular', circular)).not.toThrow();
    const [, line] = mockFs.appendFileSync.mock.calls[0] as [string, string];
    expect(line).toContain('_serializationError');
  });
});

describe('Logger.reset() for testing', () => {
  it('reset() allows re-initialization', () => {
    initLogger('INFO');
    Logger.reset();
    expect(() => Logger.getLogger('X')).toThrow('Logger not initialized');
    initLogger('DEBUG');
    expect(() => Logger.getLogger('X')).not.toThrow();
  });

  it('reset() is a no-op outside test environment', () => {
    initLogger('INFO');
    const original = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    Logger.reset();
    process.env['NODE_ENV'] = original;
    // Should still be initialized
    expect(() => Logger.getLogger('X')).not.toThrow();
  });
});

describe('Logger.getOrNoop()', () => {
  it('returns a noop logger when Logger is not initialized', () => {
    // Logger.reset() called in beforeEach — not initialized
    const noop = Logger.getOrNoop('SomeModule');
    expect(typeof noop.debug).toBe('function');
    expect(typeof noop.info).toBe('function');
    expect(typeof noop.warn).toBe('function');
    expect(typeof noop.error).toBe('function');
  });

  it('noop logger methods do not throw', () => {
    const noop = Logger.getOrNoop('SomeModule');
    expect(() => noop.debug('msg')).not.toThrow();
    expect(() => noop.info('msg')).not.toThrow();
    expect(() => noop.warn('msg')).not.toThrow();
    expect(() => noop.error('msg')).not.toThrow();
  });

  it('noop logger methods do not write to file or emit events', () => {
    const noop = Logger.getOrNoop('SomeModule');
    noop.info('should be silent');
    noop.warn('also silent');
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('noop logger methods accept optional data without throwing', () => {
    const noop = Logger.getOrNoop('SomeModule');
    expect(() => noop.info('with data', { key: 'value' })).not.toThrow();
    expect(() => noop.error('with data', { err: 'oops' })).not.toThrow();
  });

  it('returns a real LoggerInstance when Logger is initialized', () => {
    initLogger();
    const instance = Logger.getOrNoop('Pipeline');
    expect(instance).toBeInstanceOf(LoggerInstance);
  });

  it('real instance returned by getOrNoop() writes to file', () => {
    initLogger();
    const instance = Logger.getOrNoop('Pipeline');
    instance.info('hello from real logger');
    expect(mockFs.appendFileSync).toHaveBeenCalledOnce();
  });

  it('real instance returned by getOrNoop() emits app:log event', () => {
    initLogger();
    const instance = Logger.getOrNoop('Pipeline');
    instance.warn('a warning');
    expect(eventBus.emit).toHaveBeenCalledWith('app:log', expect.objectContaining({
      level: 'WARN',
      module: 'Pipeline',
      message: 'a warning',
    }));
  });

  it('can be called multiple times before init without throwing', () => {
    expect(() => {
      Logger.getOrNoop('A');
      Logger.getOrNoop('B');
      Logger.getOrNoop('C');
    }).not.toThrow();
  });
});
