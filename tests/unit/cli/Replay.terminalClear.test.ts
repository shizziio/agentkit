import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { registerReplayCommand } from '../../../src/cli/Replay.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

const mockGetTask = vi.fn();
const mockGetTotalLogCount = vi.fn();

vi.mock('@core/ReplayService.js', () => ({
  ReplayService: vi.fn().mockImplementation(() => ({
    getTask: mockGetTask,
    getTotalLogCount: mockGetTotalLogCount,
    getLogsPage: vi.fn(() => []),
  })),
}));

vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(() => ({})),
}));

vi.mock('@core/Logger.js', () => ({
  Logger: {
    getOrNoop: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
  },
}));

vi.mock('@ui/replay/ReplayApp.js', () => ({
  ReplayApp: vi.fn(),
}));

vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
    unmount: vi.fn(),
  }),
}));

function buildProgram(): Command {
  const program = new Command('agentkit');
  registerReplayCommand(program);
  return program;
}

describe('Replay command — terminal clear (story 11.7)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    mockGetTask.mockReturnValue({ id: 1, stageName: 'dev', workerModel: 'sonnet' });
    mockGetTotalLogCount.mockReturnValue(5);
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

  it('writes \\x1Bc before render() when TTY=true', async () => {
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
    await program.parseAsync(['replay', '1'], { from: 'user' });

    expect(callOrder).toContain('stdout.write(\\x1Bc)');
    expect(callOrder).toContain('render()');
    expect(callOrder.indexOf('stdout.write(\\x1Bc)')).toBeLessThan(callOrder.indexOf('render()'));
  });

  it('does NOT write \\x1Bc when TTY=false', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const program = buildProgram();
    await program.parseAsync(['replay', '1'], { from: 'user' });

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });

  it('does NOT write \\x1Bc when task not found (exits before render)', async () => {
    mockGetTask.mockReturnValue(null);

    await expect(
      buildProgram().parseAsync(['replay', '999'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });

  it('does NOT write \\x1Bc when no logs found (exits before render)', async () => {
    mockGetTotalLogCount.mockReturnValue(0);

    await expect(
      buildProgram().parseAsync(['replay', '1'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });
});
