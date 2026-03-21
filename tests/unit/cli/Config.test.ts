import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { render } from 'ink';
import { registerConfigCommand } from '../../../src/cli/Config.js';
import { ConfigService } from '../../../src/core/ConfigService.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('ink', () => ({
  render: vi.fn(() => ({
    app: {
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
      unmount: vi.fn(),
    },
  })),
}));

vi.mock('../../../src/core/ConfigService.js', () => {
  const mockLoadSettings = vi.fn();
  const MockConfigService = vi.fn(() => ({
    loadSettings: mockLoadSettings,
    saveModelAssignments: vi.fn().mockResolvedValue(undefined),
  }));
  return { ConfigService: MockConfigService, mockLoadSettings };
});

const samplePipeline = {
  team: 'agentkit',
  displayName: 'Software Development Pipeline',
  provider: 'claude-cli',
  project: { name: 'my-project', owner: 'Alice' },
  stages: [
    { name: 'sm', displayName: 'Scrum Master', icon: '📋', prompt: 'sm.md', timeout: 60, workers: 1, retries: 3 },
    { name: 'dev', displayName: 'Developer', icon: '💻', prompt: 'dev.md', timeout: 120, workers: 2, retries: 3 },
  ],
  models: {
    allowed: ['opus', 'sonnet', 'haiku'],
    resolved: { sm: 'sonnet', dev: 'opus' },
  },
};

const sampleProjectConfig = {
  version: 2,
  project: { name: 'my-project', owner: 'Alice' },
  activeTeam: 'agentkit',
  teams: ['agentkit'],
  provider: 'claude-cli',
  models: { 'claude-cli': { sm: 'sonnet', dev: 'opus' } },
};

describe('Config CLI Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command registration', () => {
    it('should register config command on program', () => {
      const program = new Command();
      registerConfigCommand(program);

      const configCmd = program.commands.find((cmd) => cmd.name() === 'config');
      expect(configCmd).toBeDefined();
      expect(configCmd!.description()).toBe('View or update project configuration');
    });

    it('should accept --show option', () => {
      const program = new Command();
      registerConfigCommand(program);

      const configCmd = program.commands.find((cmd) => cmd.name() === 'config')!;
      const showOption = configCmd.options.find((opt) => opt.long === '--show');
      expect(showOption).toBeDefined();
    });
  });

  describe('--show mode', () => {
    it('should print project config to stdout and exit 0', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const mockLoadSettings = vi.fn().mockReturnValue({
        pipeline: samplePipeline,
        projectConfig: sampleProjectConfig,
        teamConfig: {},
      });
      vi.mocked(ConfigService).mockImplementation(() => ({
        loadSettings: mockLoadSettings,
        saveModelAssignments: vi.fn(),
      }) as unknown as InstanceType<typeof ConfigService>);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(0)');
      });

      const program = new Command();
      registerConfigCommand(program);
      program.exitOverride();

      await expect(
        program.parseAsync(['node', 'agentkit', 'config', '--show']),
      ).rejects.toThrow('process.exit(0)');

      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('my-project'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Alice'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('agentkit'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('claude-cli'));
      expect(logSpy).toHaveBeenCalledWith('Model Assignments:');

      logSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('should print all stage model assignments in --show mode', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const mockLoadSettings = vi.fn().mockReturnValue({
        pipeline: samplePipeline,
        projectConfig: sampleProjectConfig,
        teamConfig: {},
      });
      vi.mocked(ConfigService).mockImplementation(() => ({
        loadSettings: mockLoadSettings,
        saveModelAssignments: vi.fn(),
      }) as unknown as InstanceType<typeof ConfigService>);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(0)');
      });

      const program = new Command();
      registerConfigCommand(program);
      program.exitOverride();

      await expect(
        program.parseAsync(['node', 'agentkit', 'config', '--show']),
      ).rejects.toThrow();

      const allLogs = logSpy.mock.calls.map((c) => String(c[0]));
      const hasSm = allLogs.some((l) => l.includes('Scrum Master') && l.includes('sonnet'));
      const hasDev = allLogs.some((l) => l.includes('Developer') && l.includes('opus'));
      expect(hasSm).toBe(true);
      expect(hasDev).toBe(true);

      logSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('should exit with code 1 when project is not initialized', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(1)');
      });

      const program = new Command();
      registerConfigCommand(program);
      program.exitOverride();

      await expect(
        program.parseAsync(['node', 'agentkit', 'config', '--show']),
      ).rejects.toThrow();

      expect(exitSpy).toHaveBeenCalledWith(1);

      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('should print (none) when owner is absent', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const pipelineNoOwner = {
        ...samplePipeline,
        project: { name: 'no-owner-project' },
      };

      const mockLoadSettings = vi.fn().mockReturnValue({
        pipeline: pipelineNoOwner,
        projectConfig: sampleProjectConfig,
        teamConfig: {},
      });
      vi.mocked(ConfigService).mockImplementation(() => ({
        loadSettings: mockLoadSettings,
        saveModelAssignments: vi.fn(),
      }) as unknown as InstanceType<typeof ConfigService>);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(0)');
      });

      const program = new Command();
      registerConfigCommand(program);
      program.exitOverride();

      await expect(
        program.parseAsync(['node', 'agentkit', 'config', '--show']),
      ).rejects.toThrow();

      const allLogs = logSpy.mock.calls.map((c) => String(c[0]));
      const hasNone = allLogs.some((l) => l.includes('(none)'));
      expect(hasNone).toBe(true);

      logSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('interactive mode', () => {
    it('should call render when no --show flag is given', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const mockLoadSettings = vi.fn().mockReturnValue({
        pipeline: samplePipeline,
        projectConfig: sampleProjectConfig,
        teamConfig: {},
      });
      vi.mocked(ConfigService).mockImplementation(() => ({
        loadSettings: mockLoadSettings,
        saveModelAssignments: vi.fn(),
      }) as unknown as InstanceType<typeof ConfigService>);

      const program = new Command();
      registerConfigCommand(program);
      program.exitOverride();

      await program.parseAsync(['node', 'agentkit', 'config']);

      expect(render).toHaveBeenCalled();
    });
  });
});
