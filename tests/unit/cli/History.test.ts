import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { registerHistoryCommand } from '../../../src/cli/History.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

// Mock the DB connection to avoid real SQLite
const mockSelect = vi.fn();
const mockDb = {
  select: mockSelect,
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(() => mockDb),
}));

vi.mock('@core/HistoryService.js', () => ({
  HistoryService: vi.fn().mockImplementation(() => ({
    getStatistics: vi.fn(() => ({
      totalCompleted: 5,
      averageDurationPerStage: [],
      mostReworkedStories: [],
    })),
    getStories: vi.fn(() => []),
  })),
}));

vi.mock('ink', () => ({
  render: vi.fn(() => ({
    waitUntilExit: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
  })),
}));

// Helper to chain Drizzle-like calls returning a project
function makeProjectChain(project: { id: number } | undefined) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn(() => project),
    where: vi.fn().mockReturnThis(),
    all: vi.fn(() => []),
  };
  return chain;
}

function buildHistoryProgram(): Command {
  const program = new Command('agentkit');
  registerHistoryCommand(program);
  return program;
}

describe('History CLI Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return a project row
    mockSelect.mockReturnValue(makeProjectChain({ id: 1 }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers history command on program', () => {
    const program = buildHistoryProgram();
    const cmd = program.commands.find((c) => c.name() === 'history');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe('View completed task history and reports');
  });

  it('registers --epic, --status, --last options', () => {
    const program = buildHistoryProgram();
    const cmd = program.commands.find((c) => c.name() === 'history')!;
    const longs = cmd.options.map((o) => o.long);
    expect(longs).toContain('--epic');
    expect(longs).toContain('--status');
    expect(longs).toContain('--last');
  });

  it('--epic, --status, --last options require values', () => {
    const program = buildHistoryProgram();
    const cmd = program.commands.find((c) => c.name() === 'history')!;
    const epicOpt = cmd.options.find((o) => o.long === '--epic');
    expect(epicOpt?.required).toBe(true);
    const statusOpt = cmd.options.find((o) => o.long === '--status');
    expect(statusOpt?.required).toBe(true);
    const lastOpt = cmd.options.find((o) => o.long === '--last');
    expect(lastOpt?.required).toBe(true);
  });

  it('calls requireInitialized and exits 1 if not initialized', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    const program = buildHistoryProgram();

    await expect(
      program.parseAsync(['history'], { from: 'user' }),
    ).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('exits 1 with stderr error when --status is invalid', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1');
    });

    const program = buildHistoryProgram();

    await expect(
      program.parseAsync(['history', '--status', 'invalid'], { from: 'user' }),
    ).rejects.toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(stderrOutput).toContain('Invalid --status');

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits 1 with stderr error when no project in DB', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    // Override to return no project
    mockSelect.mockReturnValueOnce(makeProjectChain(undefined));

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1');
    });

    const program = buildHistoryProgram();

    await expect(
      program.parseAsync(['history', '--last', '5'], { from: 'user' }),
    ).rejects.toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(stderrOutput).toContain('No project found');

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('in plain-text mode calls getStatistics and getStories and writes to stdout', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildHistoryProgram();

    await expect(
      program.parseAsync(['history', '--last', '5'], { from: 'user' }),
    ).rejects.toThrow('exit 0');

    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(output).toContain('Total completed');

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('in TTY mode with no flags calls Ink render', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    // Simulate TTY
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const { render } = await import('ink');

    const program = buildHistoryProgram();

    try {
      await program.parseAsync(['history'], { from: 'user' });
    } catch (_e) {
      // expected
    }

    expect(vi.mocked(render)).toHaveBeenCalled();

    Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
    exitSpy.mockRestore();
  });
});
