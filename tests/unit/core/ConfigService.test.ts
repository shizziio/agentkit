import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, readdirSync, existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { ConfigService } from '../../../src/core/ConfigService.js';
import { ConfigError } from '../../../src/core/Errors.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

const teamConfig = {
  team: 'agentkit',
  displayName: 'Software Development Pipeline',
  version: 1,
  stages: [
    {
      name: 'sm',
      displayName: 'Scrum Master',
      icon: '📋',
      prompt: 'sm.md',
      timeout: 60,
      workers: 1,
      retries: 3,
      next: 'dev',
    },
    {
      name: 'dev',
      displayName: 'Developer',
      icon: '💻',
      prompt: 'dev.md',
      timeout: 120,
      workers: 2,
      retries: 3,
    },
  ],
  models: {
    'claude-cli': {
      allowed: ['opus', 'sonnet', 'haiku'],
      defaults: { sm: 'sonnet', dev: 'opus' },
    },
  },
};

const projectConfig = {
  version: 2,
  project: { name: 'test-project', owner: 'Bob' },
  activeTeam: 'agentkit',
  teams: ['agentkit'],
  provider: 'claude-cli',
  models: { 'claude-cli': { sm: 'sonnet', dev: 'opus' } },
};

function setupMocks(): void {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockImplementation((filePath: unknown) => {
    const p = String(filePath);
    if (p.includes('agentkit.config.json')) {
      return JSON.stringify(projectConfig);
    }
    if (p.includes('config.json')) {
      return JSON.stringify(teamConfig);
    }
    throw new Error(`Unexpected readFileSync call: ${p}`);
  });
}

describe('ConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadSettings()', () => {
    it('should return merged config when valid files exist', () => {
      setupMocks();

      const service = new ConfigService('/fake/root');
      const settings = service.loadSettings();

      expect(settings.projectConfig.project.name).toBe('test-project');
      expect(settings.teamConfig.team).toBe('agentkit');
      expect(settings.pipeline.team).toBe('agentkit');
      expect(settings.pipeline.models.resolved.sm).toBe('sonnet');
      expect(settings.pipeline.models.resolved.dev).toBe('opus');
    });

    it('should include stages in pipeline', () => {
      setupMocks();

      const service = new ConfigService('/fake/root');
      const { pipeline } = service.loadSettings();

      expect(pipeline.stages).toHaveLength(2);
      expect(pipeline.stages[0]!.name).toBe('sm');
      expect(pipeline.stages[1]!.name).toBe('dev');
    });
  });

  describe('saveModelAssignments()', () => {
    it('should call writeFileSync with updated JSON', () => {
      setupMocks();

      const service = new ConfigService('/fake/root');
      service.saveModelAssignments({ sm: 'haiku', dev: 'sonnet' });

      expect(writeFileSync).toHaveBeenCalledOnce();
      const [, content] = vi.mocked(writeFileSync).mock.calls[0]!;
      const written = JSON.parse(String(content)) as typeof projectConfig;
      expect(written.models['claude-cli'].sm).toBe('haiku');
      expect(written.models['claude-cli'].dev).toBe('sonnet');
    });

    it('should preserve existing project config fields', () => {
      setupMocks();

      const service = new ConfigService('/fake/root');
      service.saveModelAssignments({ sm: 'haiku', dev: 'sonnet' });

      const [, content] = vi.mocked(writeFileSync).mock.calls[0]!;
      const written = JSON.parse(String(content)) as typeof projectConfig;
      expect(written.version).toBe(2);
      expect(written.project.name).toBe('test-project');
      expect(written.project.owner).toBe('Bob');
      expect(written.activeTeam).toBe('agentkit');
      expect(written.provider).toBe('claude-cli');
    });

    it('should write JSON ending with newline', () => {
      setupMocks();

      const service = new ConfigService('/fake/root');
      service.saveModelAssignments({ sm: 'haiku', dev: 'sonnet' });

      const [, content] = vi.mocked(writeFileSync).mock.calls[0]!;
      expect(String(content)).toMatch(/\n$/);
    });

    it('should throw ConfigError when a model is not in allowed list', () => {
      setupMocks();

      const service = new ConfigService('/fake/root');
      expect(() => {
        service.saveModelAssignments({ sm: 'invalid-model', dev: 'opus' });
      }).toThrow(ConfigError);
    });

    it('should throw ConfigError with descriptive message for invalid model', () => {
      setupMocks();

      const service = new ConfigService('/fake/root');
      expect(() => {
        service.saveModelAssignments({ sm: 'gpt-4', dev: 'opus' });
      }).toThrow('not in allowed models');
    });

    it('should write all stages from the new models argument', () => {
      setupMocks();

      const service = new ConfigService('/fake/root');
      const newModels = { sm: 'haiku', dev: 'haiku' };
      service.saveModelAssignments(newModels);

      const [, content] = vi.mocked(writeFileSync).mock.calls[0]!;
      const written = JSON.parse(String(content)) as typeof projectConfig;
      expect(Object.keys(written.models['claude-cli'])).toEqual(Object.keys(newModels));
    });
  });

  describe('listBundledTeams()', () => {
    it('returns directory names from the bundled teams dir', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        { name: 'agentkit', isDirectory: () => true } as ReturnType<typeof readdirSync>[0],
        { name: 'content-writing', isDirectory: () => true } as ReturnType<typeof readdirSync>[0],
      ] as ReturnType<typeof readdirSync>);

      const service = new ConfigService('/fake/root');
      const teams = service.listBundledTeams();

      expect(teams).toEqual(['agentkit', 'content-writing']);
    });

    it('excludes non-directory entries', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([
        { name: 'agentkit', isDirectory: () => true } as ReturnType<typeof readdirSync>[0],
        { name: 'README.md', isDirectory: () => false } as ReturnType<typeof readdirSync>[0],
      ] as ReturnType<typeof readdirSync>);

      const service = new ConfigService('/fake/root');
      const teams = service.listBundledTeams();

      expect(teams).toEqual(['agentkit']);
      expect(teams).not.toContain('README.md');
    });

    it('returns empty array when bundled teams dir does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const service = new ConfigService('/fake/root');
      const teams = service.listBundledTeams();

      expect(teams).toEqual([]);
    });

    it('returns empty array when readdirSync throws', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const service = new ConfigService('/fake/root');
      const teams = service.listBundledTeams();

      expect(teams).toEqual([]);
    });
  });
});
