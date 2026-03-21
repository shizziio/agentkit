import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { registerHistoryCommand } from '../../../src/cli/History.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

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

vi.mock('@core/db/schema.js', () => ({
  projects: {},
}));

vi.mock('@core/Logger.js', () => ({
  Logger: {
    getOrNoop: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
  },
}));

vi.mock('@core/HistoryService.js', () => ({
  HistoryService: vi.fn().mockImplementation(() => ({
    getStatistics: vi.fn(() => ({ totalCompleted: 0, averageDurationPerStage: [], mostReworkedStories: [] })),
    getStories: vi.fn(() => []),
  })),
}));

vi.mock('@ui/history/HistoryWizard.js', () => ({
  HistoryWizard: vi.fn(),
}));

vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
    unmount: vi.fn(),
  }),
}));

function makeProjectChain(project: { id: number } | undefined) {
  return {
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn(() => project),
  };
}

function buildProgram(): Command {
  const program = new Command('agentkit');
  registerHistoryCommand(program);
  return program;
}

describe('History command — terminal clear (story 11.7)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    mockSelect.mockReturnValue(makeProjectChain({ id: 1 }));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('process.exit called');
    });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('writes \\x1Bc before render() in TTY mode with no filter flags', async () => {
    const { render } = await import('ink');
    const renderMock = vi.mocked(render);
    const callOrder: string[] = [];

    stdoutSpy.mockImplementation((chunk) => {
      if (chunk === '\x1Bc') callOrder.push('stdout.write(\\x1Bc)');
      return true;
    });
    renderMock.mockImplementation(() => {
      callOrder.push('render()');
      return { waitUntilExit: vi.fn().mockResolvedValue(undefined), unmount: vi.fn() } as unknown as ReturnType<typeof render>;
    });

    const program = buildProgram();
    await program.parseAsync(['history'], { from: 'user' });

    expect(callOrder).toContain('stdout.write(\\x1Bc)');
    expect(callOrder).toContain('render()');
    expect(callOrder.indexOf('stdout.write(\\x1Bc)')).toBeLessThan(callOrder.indexOf('render()'));
  });

  it('does NOT write \\x1Bc in non-TTY mode', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    // non-TTY sets isPlainText=true → plain-text path → exits
    await expect(
      buildProgram().parseAsync(['history'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });

  it('does NOT write \\x1Bc when --last is passed (plain-text mode)', async () => {
    await expect(
      buildProgram().parseAsync(['history', '--last', '5'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });

  it('does NOT write \\x1Bc when not initialized (requireInitialized fails)', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await expect(
      buildProgram().parseAsync(['history'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });
});
