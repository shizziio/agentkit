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

vi.mock('ink', () => ({
  render: vi.fn(() => ({
    waitUntilExit: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
  })),
}));

function buildProgram(): Command {
  const program = new Command('agentkit');
  registerReplayCommand(program);
  return program;
}

describe('Replay CLI Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    mockGetTask.mockReturnValue({ id: 1, stageName: 'dev', workerModel: 'sonnet' });
    mockGetTotalLogCount.mockReturnValue(5);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers replay command on program', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'replay');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe('Replay a task execution visually');
  });

  it('exits 1 with stderr message when task-id is non-numeric', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1');
    });

    const program = buildProgram();
    await expect(
      program.parseAsync(['replay', 'abc'], { from: 'user' }),
    ).rejects.toThrow('exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(stderrOutput).toContain('task-id must be a number');

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits 1 with stderr message when task is not found', async () => {
    mockGetTask.mockReturnValue(null);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1');
    });

    const program = buildProgram();
    await expect(
      program.parseAsync(['replay', '999'], { from: 'user' }),
    ).rejects.toThrow('exit 1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(stderrOutput).toContain('Task 999 not found');

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits 0 when task exists but has no logs', async () => {
    mockGetTotalLogCount.mockReturnValue(0);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildProgram();
    await expect(
      program.parseAsync(['replay', '1'], { from: 'user' }),
    ).rejects.toThrow('exit 0');

    expect(exitSpy).toHaveBeenCalledWith(0);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(stderrOutput).toContain('No logs found for task 1');

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits 1 when not initialized', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    const program = buildProgram();
    await expect(
      program.parseAsync(['replay', '1'], { from: 'user' }),
    ).rejects.toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('renders ReplayApp and awaits exit for valid task with logs', async () => {
    const { render } = await import('ink');

    const program = buildProgram();
    await program.parseAsync(['replay', '1'], { from: 'user' });

    expect(vi.mocked(render)).toHaveBeenCalled();
  });
});
