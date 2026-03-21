import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerDiagnoseCommand } from '../../../src/cli/Diagnose.js';

vi.mock('../../../src/cli/RequireInitialized.js', () => ({
  requireInitialized: vi.fn(),
}));

vi.mock('../../../src/core/ConfigLoader.js', () => ({
  ConfigLoader: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockReturnValue({
      version: 1,
      project: { name: 'test-project', owner: '' },
      team: 'agentkit',
      provider: 'claude-cli',
      stages: [],
      displayName: 'Test Pipeline',
      models: { allowed: [], resolved: {} },
    }),
  })),
}));

vi.mock('../../../src/core/db/Connection.js', () => ({
  openDatabase: vi.fn().mockReturnValue({}),
}));

vi.mock('../../../src/core/Logger.js', () => ({
  Logger: {
    getOrNoop: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
  },
}));

vi.mock('../../../src/core/DiagnoseService.js', () => ({
  DiagnoseService: vi.fn().mockImplementation(() => ({
    diagnose: vi.fn().mockReturnValue({ issues: [], summary: { stuckCount: 0, orphanedCount: 0, queueGapCount: 0, loopBlockedCount: 0 } }),
    autoFix: vi.fn().mockReturnValue({ resetCount: 0, reroutedCount: 0, skippedCount: 0 }),
  })),
}));

vi.mock('../../../src/ui/diagnose/DiagnoseWizard.js', () => ({
  DiagnoseWizard: vi.fn(() => null),
}));

vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
    unmount: vi.fn(),
  }),
}));

function buildProgram(): Command {
  const program = new Command('agentkit');
  program.exitOverride();
  registerDiagnoseCommand(program);
  return program;
}

describe('Diagnose command — terminal clear (story 11.7)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('writes \\x1Bc before render() when TTY=true and no --auto-fix', async () => {
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
    await program.parseAsync(['node', 'agentkit', 'diagnose']);

    expect(callOrder).toContain('stdout.write(\\x1Bc)');
    expect(callOrder).toContain('render()');
    expect(callOrder.indexOf('stdout.write(\\x1Bc)')).toBeLessThan(callOrder.indexOf('render()'));
  });

  it('does NOT write \\x1Bc when TTY=false and no --auto-fix', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const program = buildProgram();
    await program.parseAsync(['node', 'agentkit', 'diagnose']);

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });

  it('does NOT write \\x1Bc when --auto-fix flag present (exits before render)', async () => {
    await expect(
      buildProgram().parseAsync(['node', 'agentkit', 'diagnose', '--auto-fix']),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });
});
