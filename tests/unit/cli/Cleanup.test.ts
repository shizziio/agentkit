import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerCleanupCommand } from '../../../src/cli/Cleanup.js';
import { CleanupService } from '@core/CleanupService';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ size: 1024 }),
  };
});

vi.mock('./RequireInitialized.js', () => ({
  requireInitialized: vi.fn(),
}));

vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(),
}));

vi.mock('@core/CleanupService.js', () => ({
  CleanupService: vi.fn(),
}));

const mockStats = {
  fileSizeBytes: 1024 * 1024,
  tableCounts: { projects: 1, epics: 2, stories: 5, tasks: 10, taskLogs: 100 },
};

function buildMockService(overrides: Partial<InstanceType<typeof CleanupService>> = {}) {
  return {
    getDatabaseStats: vi.fn().mockReturnValue(mockStats),
    previewOlderThan: vi.fn().mockReturnValue({ taskLogCount: 50, cutoffDate: '2025-01-01T00:00:00.000Z' }),
    previewKeepLast: vi.fn().mockReturnValue({ storiesToDelete: 3, tasksToDelete: 9, taskLogsToDelete: 45, totalCompleted: 10 }),
    cleanupOlderThan: vi.fn().mockReturnValue({ taskLogsDeleted: 50, tasksDeleted: 0, storiesDeleted: 0 }),
    cleanupKeepLast: vi.fn().mockReturnValue({ taskLogsDeleted: 45, tasksDeleted: 9, storiesDeleted: 3 }),
    ...overrides,
  };
}

// Helper to parse with { from: 'user' } so Commander doesn't strip node/script args
function parse(program: Command, args: string[]) {
  return program.parseAsync(args, { from: 'user' });
}

describe('registerCleanupCommand', () => {
  let program: Command;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();

    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  describe('command registration', () => {
    it('registers cleanup command on the program', () => {
      registerCleanupCommand(program);
      const cmd = program.commands.find((c) => c.name() === 'cleanup');
      expect(cmd).toBeDefined();
      expect(cmd!.description()).toBe('Inspect database size and prune old data');
    });

    it('has --older-than, --keep-last, --dry-run, --force options', () => {
      registerCleanupCommand(program);
      const cmd = program.commands.find((c) => c.name() === 'cleanup')!;
      const optionNames = cmd.options.map((o) => o.long);
      expect(optionNames).toContain('--older-than');
      expect(optionNames).toContain('--keep-last');
      expect(optionNames).toContain('--dry-run');
      expect(optionNames).toContain('--force');
    });
  });

  describe('stats-only mode (no deletion flags)', () => {
    it('prints stats and exits 0 when no deletion flags are provided', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(parse(program, ['cleanup'])).rejects.toThrow('process.exit(0)');

      expect(mockSvc.getDatabaseStats).toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Database:'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Table counts:'));
    });
  });

  describe('mutual exclusion validation', () => {
    it('errors when --older-than and --keep-last are both provided', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--older-than', '30', '--keep-last', '10']),
      ).rejects.toThrow('process.exit(1)');

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cannot use --older-than and --keep-last together'),
      );
    });
  });

  describe('--older-than validation', () => {
    it('errors on --older-than 0 (must be positive)', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--older-than', '0']),
      ).rejects.toThrow('process.exit(1)');

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid value for --older-than'),
      );
    });

    it('errors on --older-than with non-integer value', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--older-than', 'abc']),
      ).rejects.toThrow('process.exit(1)');

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid value for --older-than'),
      );
    });

    it('errors on --older-than with negative value', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--older-than', '-5']),
      ).rejects.toThrow('process.exit(1)');

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid value for --older-than'),
      );
    });
  });

  describe('--keep-last validation', () => {
    it('errors on --keep-last with negative value', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--keep-last', '-1']),
      ).rejects.toThrow('process.exit(1)');

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid value for --keep-last'),
      );
    });

    it('accepts --keep-last 0 as valid', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      // With --force to skip confirmation
      await expect(
        parse(program, ['cleanup', '--keep-last', '0', '--force']),
      ).rejects.toThrow('process.exit');

      expect(stderrSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Invalid value for --keep-last'),
      );
    });
  });

  describe('--dry-run flag', () => {
    it('prints preview and exits without deleting when --older-than --dry-run', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--older-than', '30', '--dry-run']),
      ).rejects.toThrow('process.exit(0)');

      expect(mockSvc.previewOlderThan).toHaveBeenCalledWith(30);
      expect(mockSvc.cleanupOlderThan).not.toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('[dry-run] No changes made.'));
    });

    it('prints preview and exits without deleting when --keep-last --dry-run', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--keep-last', '5', '--dry-run']),
      ).rejects.toThrow('process.exit(0)');

      expect(mockSvc.previewKeepLast).toHaveBeenCalledWith(5);
      expect(mockSvc.cleanupKeepLast).not.toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('[dry-run] No changes made.'));
    });

    it('dry-run takes precedence over --force', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--older-than', '30', '--dry-run', '--force']),
      ).rejects.toThrow('process.exit(0)');

      expect(mockSvc.cleanupOlderThan).not.toHaveBeenCalled();
    });
  });

  describe('--force flag (skips confirmation)', () => {
    it('deletes immediately without prompting when --force is provided with --older-than', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--older-than', '30', '--force']),
      ).rejects.toThrow('process.exit');

      expect(mockSvc.cleanupOlderThan).toHaveBeenCalledWith(30);
    });

    it('deletes immediately without prompting when --force is provided with --keep-last', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--keep-last', '5', '--force']),
      ).rejects.toThrow('process.exit');

      expect(mockSvc.cleanupKeepLast).toHaveBeenCalledWith(5);
    });
  });

  describe('nothing to delete', () => {
    it('prints Nothing to delete when taskLogCount=0 for --older-than', async () => {
      const mockSvc = buildMockService({
        previewOlderThan: vi.fn().mockReturnValue({ taskLogCount: 0, cutoffDate: '2025-01-01T00:00:00.000Z' }),
      });
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--older-than', '30']),
      ).rejects.toThrow('process.exit(0)');

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing to delete.'));
      expect(mockSvc.cleanupOlderThan).not.toHaveBeenCalled();
    });

    it('prints Nothing to delete when storiesToDelete=0 for --keep-last', async () => {
      const mockSvc = buildMockService({
        previewKeepLast: vi.fn().mockReturnValue({ storiesToDelete: 0, tasksToDelete: 0, taskLogsToDelete: 0, totalCompleted: 3 }),
      });
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--keep-last', '10']),
      ).rejects.toThrow('process.exit(0)');

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Nothing to delete.'));
      expect(mockSvc.cleanupKeepLast).not.toHaveBeenCalled();
    });
  });

  describe('result output', () => {
    it('prints cleanup complete with counts after successful --older-than deletion', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--older-than', '30', '--force']),
      ).rejects.toThrow('process.exit');

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Cleanup complete.'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Task logs deleted'));
    });

    it('prints cleanup complete with counts after successful --keep-last deletion', async () => {
      const mockSvc = buildMockService();
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(
        parse(program, ['cleanup', '--keep-last', '5', '--force']),
      ).rejects.toThrow('process.exit');

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Cleanup complete.'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Stories deleted'));
    });
  });

  describe('formatBytes helper (via stats output)', () => {
    it('shows 0 B for zero byte file', async () => {
      const mockSvc = buildMockService({
        getDatabaseStats: vi.fn().mockReturnValue({
          fileSizeBytes: 0,
          tableCounts: { projects: 0, epics: 0, stories: 0, tasks: 0, taskLogs: 0 },
        }),
      });
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(parse(program, ['cleanup'])).rejects.toThrow('process.exit(0)');

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('0 B'));
    });

    it('shows MB for megabyte-sized file', async () => {
      const mockSvc = buildMockService({
        getDatabaseStats: vi.fn().mockReturnValue({
          fileSizeBytes: 5 * 1024 * 1024,
          tableCounts: { projects: 0, epics: 0, stories: 0, tasks: 0, taskLogs: 0 },
        }),
      });
      vi.mocked(CleanupService).mockImplementation(() => mockSvc as unknown as CleanupService);

      registerCleanupCommand(program);
      await expect(parse(program, ['cleanup'])).rejects.toThrow('process.exit(0)');

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('MB'));
    });
  });
});
