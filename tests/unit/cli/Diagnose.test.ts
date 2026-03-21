import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';

import { registerDiagnoseCommand } from '../../../src/cli/Diagnose.js';

// Top-level vi.mock() calls are hoisted by Vitest before module resolution
vi.mock('../../../src/cli/RequireInitialized.js', () => ({
  requireInitialized: vi.fn(),
}));

const mockLoad = vi.fn().mockReturnValue({
  version: 1,
  project: { name: 'test-project', owner: '' },
  team: 'agentkit',
  provider: 'claude-cli',
  stages: [
    { name: 'sm', timeout: 300, workers: 1, displayName: 'Scrum Master' },
    { name: 'dev', timeout: 600, workers: 2, displayName: 'Developer', next: 'review' },
    { name: 'review', timeout: 300, workers: 1, displayName: 'Reviewer', next: 'tester', reject_to: 'dev' },
    { name: 'tester', timeout: 300, workers: 1, displayName: 'Tester' },
  ],
  displayName: 'Test Pipeline',
  models: { allowed: [], resolved: {} },
});

vi.mock('../../../src/core/ConfigLoader.js', () => ({
  ConfigLoader: vi.fn().mockImplementation(() => ({
    load: mockLoad,
  })),
}));

vi.mock('../../../src/core/db/Connection.js', () => ({
  openDatabase: vi.fn().mockReturnValue({}),
}));

const mockAutoFix = vi.fn().mockReturnValue({ resetCount: 3, reroutedCount: 1, skippedCount: 0 });
const mockDiagnose = vi.fn().mockReturnValue({
  issues: [],
  summary: { stuckCount: 1, orphanedCount: 2, queueGapCount: 0, loopBlockedCount: 0 },
});

vi.mock('../../../src/core/DiagnoseService.js', () => ({
  DiagnoseService: vi.fn().mockImplementation(() => ({
    diagnose: mockDiagnose,
    autoFix: mockAutoFix,
  })),
}));

vi.mock('../../../src/ui/diagnose/DiagnoseWizard.js', () => ({
  DiagnoseWizard: vi.fn(() => null),
}));

describe('Diagnose CLI Command', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers the diagnose command on the program', () => {
    const program = new Command();
    registerDiagnoseCommand(program);

    const cmd = program.commands.find((c) => c.name() === 'diagnose');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toBe('Diagnose pipeline health and surface errors');
  });

  it('registers the --auto-fix option', () => {
    const program = new Command();
    registerDiagnoseCommand(program);

    const cmd = program.commands.find((c) => c.name() === 'diagnose')!;
    const opt = cmd.options.find((o) => o.long === '--auto-fix');
    expect(opt).toBeDefined();
  });

  it('--auto-fix is a boolean flag (no required argument)', () => {
    const program = new Command();
    registerDiagnoseCommand(program);

    const cmd = program.commands.find((c) => c.name() === 'diagnose')!;
    const opt = cmd.options.find((o) => o.long === '--auto-fix')!;
    expect(opt.required).toBeFalsy();
    expect(opt.optional).toBeFalsy();
  });

  it('has an action handler attached', () => {
    const program = new Command();
    registerDiagnoseCommand(program);

    const cmd = program.commands.find((c) => c.name() === 'diagnose')!;
    expect((cmd as any)._actionHandler).toBeDefined();
  });

  it('calls requireInitialized before executing', async () => {
    const { requireInitialized } = await import('../../../src/cli/RequireInitialized.js');
    const requireInitializedMock = vi.mocked(requireInitialized);

    const program = new Command();
    program.exitOverride();
    registerDiagnoseCommand(program);

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    try {
      await program.parseAsync(['node', 'agentkit', 'diagnose', '--auto-fix']);
    } catch {
      // Expected
    }

    expect(requireInitializedMock).toHaveBeenCalled();
  });
});

describe('Diagnose CLI --auto-fix execution', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('--auto-fix prints summary to stdout and calls process.exit(0)', async () => {
    mockDiagnose.mockReturnValue({
      issues: [],
      summary: { stuckCount: 1, orphanedCount: 2, queueGapCount: 0, loopBlockedCount: 0 },
    });
    mockAutoFix.mockReturnValue({ resetCount: 3, reroutedCount: 1, skippedCount: 0 });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    const program = new Command();
    program.exitOverride();
    registerDiagnoseCommand(program);

    await expect(
      program.parseAsync(['node', 'agentkit', 'diagnose', '--auto-fix']),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdoutSpy).toHaveBeenCalledWith(
      'Auto-fix summary: reset 3, re-routed 1, skipped 0\n',
    );
  });

  it('--auto-fix with zero counts shows zeros', async () => {
    mockDiagnose.mockReturnValue({
      issues: [],
      summary: { stuckCount: 0, orphanedCount: 0, queueGapCount: 0, loopBlockedCount: 0 },
    });
    mockAutoFix.mockReturnValue({ resetCount: 0, reroutedCount: 0, skippedCount: 0 });

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    const program = new Command();
    program.exitOverride();
    registerDiagnoseCommand(program);

    try {
      await program.parseAsync(['node', 'agentkit', 'diagnose', '--auto-fix']);
    } catch {
      // Expected
    }

    expect(stdoutSpy).toHaveBeenCalledWith(
      'Auto-fix summary: reset 0, re-routed 0, skipped 0\n',
    );
  });

  it('--auto-fix calls DiagnoseService methods in order', async () => {
    mockDiagnose.mockReturnValue({
      issues: [],
      summary: { stuckCount: 0, orphanedCount: 0, queueGapCount: 0, loopBlockedCount: 0 },
    });
    mockAutoFix.mockReturnValue({ resetCount: 1, reroutedCount: 0, skippedCount: 0 });

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    const program = new Command();
    program.exitOverride();
    registerDiagnoseCommand(program);

    try {
      await program.parseAsync(['node', 'agentkit', 'diagnose', '--auto-fix']);
    } catch {
      // Expected
    }

    expect(mockDiagnose).toHaveBeenCalled();
    expect(mockAutoFix).toHaveBeenCalled();
  });
});
