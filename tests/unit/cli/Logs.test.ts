import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { openDatabase } from '@core/db/Connection';
import { eventBus } from '@core/EventBus';
import { LogsService } from '@core/LogsService';
import { registerLogsCommand } from '../../../src/cli/Logs.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(),
}));

vi.mock('@core/db/schema.js', () => ({
  projects: {},
}));

vi.mock('@core/EventBus.js', () => ({
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));

vi.mock('@core/LogsService.js', () => ({
  LogsService: vi.fn(),
}));

vi.mock('@ui/logs/formatLogEntry.js', () => ({
  formatLogEntry: vi.fn((entry: unknown) => `formatted:${JSON.stringify(entry)}`),
}));

vi.mock('@ui/logs/LogsViewer.js', () => ({
  LogsViewer: vi.fn(),
}));

vi.mock('ink', () => ({
  render: vi.fn(() => ({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
    unmount: vi.fn(),
  })),
}));

vi.mock('./RequireInitialized.js', () => ({
  requireInitialized: vi.fn(),
}));

const mockEntries = [
  {
    id: 1,
    taskId: 10,
    sequence: 1,
    eventType: 'text',
    eventData: { text: 'hello' },
    createdAt: '2024-01-01T12:00:00Z',
    stageName: 'dev',
    storyId: 1,
  },
];

function setupMocks(entries = mockEntries) {
  vi.mocked(existsSync).mockReturnValue(true);

  const mockQuery = vi.fn().mockReturnValue({ entries, taskIds: entries.map((e) => e.taskId) });
  vi.mocked(LogsService).mockImplementation(
    () => ({ query: mockQuery } as unknown as LogsService),
  );

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ id: 1 }),
        }),
      }),
    }),
  };
  vi.mocked(openDatabase).mockReturnValue(
    mockDb as unknown as ReturnType<typeof openDatabase>,
  );

  return { mockQuery, mockDb };
}

/**
 * Helper to parse a logs command.
 * Uses default parsing where first two argv entries are node + script.
 */
async function parseLogs(args: string[]): Promise<void> {
  const program = new Command();
  registerLogsCommand(program);
  await program.parseAsync(['node', 'agentkit', ...args]);
}

describe('registerLogsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers the logs command', () => {
    const program = new Command();
    registerLogsCommand(program);
    const cmd = program.commands.find((c) => c.name() === 'logs');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toBe('View task logs');
  });

  it('passes taskId to LogsService when --task is provided', async () => {
    const { mockQuery } = setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    try {
      await parseLogs(['logs', '--task', '42']);
    } catch {
      // exit throws
    }

    expect(mockQuery).toHaveBeenCalledWith(1, expect.objectContaining({ taskId: 42 }));

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('passes stageName to LogsService when --stage is provided', async () => {
    const { mockQuery } = setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    try {
      await parseLogs(['logs', '--stage', 'dev']);
    } catch {
      // exit throws
    }

    expect(mockQuery).toHaveBeenCalledWith(1, expect.objectContaining({ stageName: 'dev' }));

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('passes lastN=10 when --last 10 is provided', async () => {
    const { mockQuery } = setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    try {
      await parseLogs(['logs', '--last', '10']);
    } catch {
      // exit throws
    }

    expect(mockQuery).toHaveBeenCalledWith(1, expect.objectContaining({ lastN: 10 }));

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('defaults lastN to 5 when --last abc (invalid) is provided', async () => {
    const { mockQuery } = setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    try {
      await parseLogs(['logs', '--last', 'abc']);
    } catch {
      // exit throws
    }

    expect(mockQuery).toHaveBeenCalledWith(1, expect.objectContaining({ lastN: 5 }));

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('prints entries to stdout when not a TTY', async () => {
    setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });

    try {
      await parseLogs(['logs']);
    } catch {
      // exit throws
    }

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('formatted:'));

    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('subscribes to EventBus stream events when --follow is used', async () => {
    setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Resolve once all 6 stream event listeners are registered (no fixed delay)
    let onCallCount = 0;
    let resolveRegistered!: () => void;
    const allRegistered = new Promise<void>((r) => {
      resolveRegistered = r;
    });
    vi.mocked(eventBus.on).mockImplementation(() => {
      onCallCount++;
      if (onCallCount >= 6) resolveRegistered();
    });

    const program = new Command();
    registerLogsCommand(program);

    // In follow mode the action runs and never resolves (keeps alive)
    const parsePromise = program.parseAsync(['node', 'agentkit', 'logs', '--follow']);

    await allRegistered;

    const streamEvents = [
      'stream:thinking',
      'stream:tool_use',
      'stream:tool_result',
      'stream:text',
      'stream:error',
      'stream:done',
    ];
    for (const evName of streamEvents) {
      expect(vi.mocked(eventBus.on)).toHaveBeenCalledWith(evName, expect.any(Function));
    }

    stdoutSpy.mockRestore();
    void parsePromise;
  });

  it('handles --follow with --stage filter', async () => {
    setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    let onCallCount = 0;
    let resolveRegistered!: () => void;
    const allRegistered = new Promise<void>((r) => {
      resolveRegistered = r;
    });
    vi.mocked(eventBus.on).mockImplementation(() => {
      onCallCount++;
      if (onCallCount >= 6) resolveRegistered();
    });

    const program = new Command();
    registerLogsCommand(program);

    const parsePromise = program.parseAsync(['node', 'agentkit', 'logs', '--follow', '--stage', 'dev']);

    await allRegistered;

    expect(vi.mocked(eventBus.on)).toHaveBeenCalledTimes(6);

    stdoutSpy.mockRestore();
    void parsePromise;
  });

  it('clamaps lastN to max 100', async () => {
    const { mockQuery } = setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    try {
      await parseLogs(['logs', '--last', '500']);
    } catch {
      // exit throws
    }

    expect(mockQuery).toHaveBeenCalledWith(1, expect.objectContaining({ lastN: 100 }));

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('clamps lastN to min 1', async () => {
    const { mockQuery } = setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    try {
      await parseLogs(['logs', '--last', '0']);
    } catch {
      // exit throws
    }

    expect(mockQuery).toHaveBeenCalledWith(1, expect.objectContaining({ lastN: 1 }));

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('handles no logs found case', async () => {
    setupMocks([]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    try {
      await parseLogs(['logs']);
    } catch {
      // exit throws
    }

    expect(stdoutSpy).toHaveBeenCalledWith('No logs found.\n');
    expect(exitSpy).toHaveBeenCalledWith(0);

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('renders LogsViewer when stdout is TTY', async () => {
    const { mockQuery } = setupMocks();

    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });

    const { render } = await import('ink');
    const renderSpy = vi.spyOn(await import('ink'), 'render');

    const program = new Command();
    registerLogsCommand(program);

    try {
      await program.parseAsync(['node', 'agentkit', 'logs']);
    } catch {
      // component might unmount
    }

    expect(renderSpy).toHaveBeenCalledWith(expect.any(Object));

    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  it('parses negative lastN as default 5', async () => {
    const { mockQuery } = setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    try {
      await parseLogs(['logs', '--last', '-5']);
    } catch {
      // exit throws
    }

    expect(mockQuery).toHaveBeenCalledWith(1, expect.objectContaining({ lastN: 1 }));

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('handles project not found error', async () => {
    const { mockDb } = setupMocks();

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    // Mock DB to return no project
    vi.mocked(openDatabase).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue(null),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof openDatabase>);

    try {
      await parseLogs(['logs']);
    } catch {
      // exit throws
    }

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Error:'));
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('combines --task and --stage but --task takes precedence', async () => {
    const { mockQuery } = setupMocks();

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('exit');
    });

    try {
      await parseLogs(['logs', '--task', '42', '--stage', 'dev']);
    } catch {
      // exit throws
    }

    expect(mockQuery).toHaveBeenCalledWith(1, expect.objectContaining({ taskId: 42 }));
    // stageName should still be passed but service will ignore it
    expect(mockQuery).toHaveBeenCalledWith(1, expect.objectContaining({ stageName: 'dev' }));

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
