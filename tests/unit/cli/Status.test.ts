import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { registerStatusCommand } from '../../../src/cli/Status.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(() => ({})),
}));

vi.mock('@core/StateManager.js', () => {
  return {
    StateManager: vi.fn().mockImplementation(() => ({
      getStoryCountsByStatus: vi.fn(() => ({ draft: 2, done: 3 })),
      getQueueDepthByStage: vi.fn(() => ({ sm: 1 })),
      getRunningTasksByStage: vi.fn(() => ({ dev: 1 })),
    })),
  };
});

function buildStatusProgram(): Command {
  const program = new Command('agentkit');
  registerStatusCommand(program);
  return program;
}

describe('Status CLI Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers status command on program', () => {
    const program = buildStatusProgram();
    const cmd = program.commands.find((c) => c.name() === 'status');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBe('Show current pipeline and task status');
  });

  it('calls requireInitialized and exits 1 if not initialized', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    const program = buildStatusProgram();

    await expect(
      program.parseAsync(['status'], { from: 'user' }),
    ).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('prints Stories:/Queue:/Workers: lines to stdout and exits 0', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();

    await expect(
      program.parseAsync(['status'], { from: 'user' }),
    ).rejects.toThrow('exit 0');

    const writes = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(writes).toContain('Stories:');
    expect(writes).toContain('Queue:');
    expect(writes).toContain('Workers:');
    expect(exitSpy).toHaveBeenCalledWith(0);

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('handles AgentKitError by writing to stderr and exiting 1', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const { AgentKitError } = await import('@core/Errors.js');
    const { StateManager } = await import('@core/StateManager.js');
    vi.mocked(StateManager).mockImplementationOnce(() => ({
      getStoryCountsByStatus: vi.fn(() => { throw new AgentKitError('DB error', 'DB_ERROR'); }),
      getQueueDepthByStage: vi.fn(() => ({})),
      getRunningTasksByStage: vi.fn(() => ({})),
      getPipelineStatus: vi.fn(),
      getStoryProgress: vi.fn(),
      getTaskChain: vi.fn(),
      getStatistics: vi.fn(),
    }) as unknown as import('@core/StateManager').StateManager);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1');
    });

    const program = buildStatusProgram();

    await expect(
      program.parseAsync(['status'], { from: 'user' }),
    ).rejects.toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrOutput = stderrSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(stderrOutput).toContain('Error:');

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
