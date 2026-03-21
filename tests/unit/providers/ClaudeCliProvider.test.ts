import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { ChildProcess } from 'node:child_process';

import { ClaudeCliProvider } from '../../../src/providers/agent/ClaudeCliProvider.js';
import { processManager } from '../../../src/providers/agent/ProcessManager.js';
import type { ProviderConfig } from '../../../src/providers/interfaces/BaseProvider.js';
import type { StreamEvent } from '../../../src/core/EventTypes.js';

// Module-level mock for Logger so the module-scoped `logger` constant picks it up at import time.
// vi.hoisted() is required because vi.mock factories are hoisted before variable declarations.
const { mockLoggerDebug, mockLoggerInstance } = vi.hoisted(() => {
  const mockLoggerDebug = vi.fn();
  const mockLoggerInstance = {
    debug: mockLoggerDebug,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { mockLoggerDebug, mockLoggerInstance };
});

vi.mock('../../../src/core/Logger.js', () => ({
  Logger: { getOrNoop: vi.fn(() => mockLoggerInstance) },
}));

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:readline', () => ({
  default: { createInterface: vi.fn() },
  createInterface: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

class MockChild extends EventEmitter {
  pid: number | undefined;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  // No default — pass explicit pid so undefined is preserved when intentionally omitted
  constructor(pid?: number) {
    super();
    this.pid = pid;
  }
}

class MockRl extends EventEmitter {
  close = vi.fn();
}

function makeMockChild(pid?: number) {
  const child = new MockChild(pid);
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}

function makeMockRl() {
  const rl = new MockRl();
  vi.mocked(readline.createInterface).mockReturnValue(rl as unknown as ReturnType<typeof readline.createInterface>);
  return rl;
}

async function collectEvents(gen: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const defaultConfig: ProviderConfig = { taskId: 42, stageName: 'dev', model: 'opus', timeout: 30_000, permissions: 'default' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeCliProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // isAvailable
  describe('isAvailable()', () => {
    it('returns true when claude --version exits with code 0', async () => {
      const child = makeMockChild(12345);
      const provider = new ClaudeCliProvider();
      const result = provider.isAvailable();
      child.emit('close', 0);
      expect(await result).toBe(true);
    });

    it('returns false when claude --version exits with non-zero code', async () => {
      const child = makeMockChild(12345);
      const provider = new ClaudeCliProvider();
      const result = provider.isAvailable();
      child.emit('close', 1);
      expect(await result).toBe(false);
    });

    it('returns false when spawn throws (claude not found)', async () => {
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('ENOENT: spawn claude');
      });
      const provider = new ClaudeCliProvider();
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns false when child emits error event', async () => {
      const child = makeMockChild(12345);
      const provider = new ClaudeCliProvider();
      const result = provider.isAvailable();
      child.emit('error', new Error('ENOENT'));
      expect(await result).toBe(false);
    });
  });

  // validateConfig
  describe('validateConfig()', () => {
    it('returns valid=true for a supported model', () => {
      const provider = new ClaudeCliProvider();
      const result = provider.validateConfig(defaultConfig);
      expect(result).toEqual({ valid: true, errors: [] });
    });

    it('returns valid=false with error message for an unsupported model', () => {
      const provider = new ClaudeCliProvider();
      const result = provider.validateConfig({ ...defaultConfig, model: 'gpt-4' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unsupported model: gpt-4');
    });

    it('returns valid=false for an empty model string', () => {
      const provider = new ClaudeCliProvider();
      const result = provider.validateConfig({ ...defaultConfig, model: '' });
      expect(result.valid).toBe(false);
    });
  });

  // execute
  describe('execute()', () => {
    beforeEach(() => {
      makeMockRl(); // default readline mock
    });

    it('yields a text event for each line including empty/whitespace lines', async () => {
      const child = makeMockChild(12345);
      const rl = makeMockRl();
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        rl.emit('line', '');
        rl.emit('line', '   ');
        rl.emit('line', '\t');
        child.emit('close', 0);
      });

      const events = await promise;
      // In plain text mode, every line (including empty/whitespace) is yielded as a text event
      const textEvents = events.filter(e => e.type === 'text');
      expect(textEvents.length).toBe(3);
      expect(textEvents[0]?.data.text).toBe('');
      expect(textEvents[1]?.data.text).toBe('   ');
      expect(textEvents[2]?.data.text).toBe('\t');
      expect(events.at(-1)?.type).toBe('done');
    });

    it('yields a plain text event for non-JSON stdout lines', async () => {
      const child = makeMockChild(12345);
      const rl = makeMockRl();
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        rl.emit('line', 'this is not json');
        child.emit('close', 0);
      });

      const events = await promise;
      const textEvent = events.find((e) => e.type === 'text' && e.data.text === 'this is not json');
      expect(textEvent).toBeDefined();
      expect(textEvent?.type).toBe('text');
    });

    it('yields an error StreamEvent when process exits with non-zero code', async () => {
      const child = makeMockChild(12345);
      const rl = makeMockRl();
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        child.emit('close', 1);
      });

      const events = await promise;
      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });

    it('yields a done StreamEvent as the final event on success', async () => {
      const child = makeMockChild(12345);
      const rl = makeMockRl();
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        child.emit('close', 0);
      });

      const events = await promise;
      expect(events.at(-1)?.type).toBe('done');
    });

    it('registers process with ProcessManager on spawn and unregisters in finally', async () => {
      const child = makeMockChild(9999);
      const rl = makeMockRl();
      const registerSpy = vi.spyOn(processManager, 'register');
      const unregisterSpy = vi.spyOn(processManager, 'unregister');

      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        child.emit('close', 0);
      });

      await promise;

      expect(registerSpy).toHaveBeenCalledWith(9999, child);
      expect(unregisterSpy).toHaveBeenCalledWith(9999);
    });

    it('sends SIGTERM then SIGKILL after timeout', async () => {
      vi.useFakeTimers();
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const child = makeMockChild(12345);
      makeMockRl();

      const config: ProviderConfig = { taskId: 42, stageName: 'dev', model: 'opus', timeout: 1000, permissions: 'default' };
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', config));

      // Fire the main timeout
      await vi.advanceTimersByTimeAsync(1000);
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');

      // Fire the inner 5s kill delay
      await vi.advanceTimersByTimeAsync(5000);
      expect(killSpy).toHaveBeenCalledWith(-12345, 'SIGKILL');

      // Let the generator finish
      child.emit('close', 1);
      await promise;

      killSpy.mockRestore();
    });

    it('yields an error StreamEvent when child.pid is undefined', async () => {
      makeMockChild(); // no pid passed → pid === undefined
      makeMockRl();
      const provider = new ClaudeCliProvider();

      const events = await collectEvents(provider.execute('prompt', defaultConfig));

      expect(events.length).toBe(1);
      expect(events[0]?.type).toBe('error');
    });

    it('does NOT yield error event for stderr when exitCode is 0 (diagnostic only)', async () => {
      const child = makeMockChild(12345);
      const rl = makeMockRl();
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        child.stderr.emit('data', Buffer.from('some error output from stderr'));
        child.emit('close', 0);
      });

      const events = await promise;
      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeUndefined();
      expect(events.at(-1)?.type).toBe('done');
    });

    it('calls logger.debug with correct args when exitCode is 0 and stderr has content', async () => {
      const stderrContent = 'some diagnostic output from stderr';
      const child = makeMockChild(12345);
      const rl = makeMockRl();
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        child.stderr.emit('data', Buffer.from(stderrContent));
        child.emit('close', 0);
      });

      await promise;

      expect(mockLoggerDebug).toHaveBeenCalledWith(
        'claudeCliProvider: stderr diagnostic (exit 0)',
        expect.objectContaining({ taskId: 42, snippet: stderrContent }),
      );
    });

    it('yields raw_trace event before done event', async () => {
      const child = makeMockChild(12345);
      const rl = makeMockRl();
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        rl.emit('line', 'some plain text output');
        child.emit('close', 0);
      });

      const events = await promise;
      const rawTraceIdx = events.findIndex((e) => e.type === 'raw_trace');
      const doneIdx = events.map(e => e.type).lastIndexOf('done');
      expect(rawTraceIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(rawTraceIdx);
    });

    it('yields each stdout line as a text StreamEvent', async () => {
      const child = makeMockChild(12345);
      const rl = makeMockRl();
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        rl.emit('line', 'line one');
        rl.emit('line', 'line two');
        rl.emit('line', 'line three');
        child.emit('close', 0);
      });

      const events = await promise;
      const textEvents = events.filter(e => e.type === 'text');
      expect(textEvents).toHaveLength(3);
      expect(textEvents[0]?.data.text).toBe('line one');
      expect(textEvents[1]?.data.text).toBe('line two');
      expect(textEvents[2]?.data.text).toBe('line three');
    });

    it('spawn args do not include stream-json flags', async () => {
      const child = makeMockChild(12345);
      const rl = makeMockRl();
      const provider = new ClaudeCliProvider();
      const promise = collectEvents(provider.execute('prompt', defaultConfig));

      setImmediate(() => {
        child.emit('close', 0);
      });

      await promise;

      const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
      expect(spawnArgs).not.toContain('--output-format');
      expect(spawnArgs).not.toContain('stream-json');
      expect(spawnArgs).not.toContain('--include-partial-messages');
      expect(spawnArgs).toContain('--verbose');
    });
  });
});
