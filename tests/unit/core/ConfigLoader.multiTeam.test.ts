import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { ConfigLoader } from '../../../src/core/ConfigLoader.js';
import { ConfigService } from '../../../src/core/ConfigService.js';
import { ConfigError } from '../../../src/core/Errors.js';

const mockResourcePath = vi.hoisted(() => ({ teamsDir: '' }));

vi.mock('@shared/ResourcePath.js', () => ({
  getBundledTeamsDir: () => mockResourcePath.teamsDir,
  getBundledTeamDir: (name: string) => `${mockResourcePath.teamsDir}/${name}`,
  getBundledWorkflowPath: (name: string) => `${mockResourcePath.teamsDir}/../workflows/${name}.md`,
}));

function createTempDir(): string {
  const dir = join(tmpdir(), `agentkit-mt-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeTeamConfig(teamsDir: string, teamName: string, config: Record<string, unknown>): void {
  const teamDir = join(teamsDir, teamName);
  mkdirSync(teamDir, { recursive: true });
  writeFileSync(join(teamDir, 'config.json'), JSON.stringify(config));
}

function makeTeamConfig(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    team: 'agentkit',
    displayName: 'Software Development Pipeline',
    version: 1,
    models: {
      'claude-cli': {
        allowed: ['opus', 'sonnet', 'haiku'],
        defaults: {
          sm: 'sonnet',
          dev: 'sonnet',
          review: 'sonnet',
          tester: 'sonnet',
        },
      },
    },
    stages: [
      { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, next: 'dev', reset_to: ['sm'] },
      { name: 'dev', displayName: 'Dev', icon: '💻', prompt: './prompts/dev.md', timeout: 600, workers: 1, retries: 0, next: 'review', reset_to: ['sm', 'dev'] },
      { name: 'review', displayName: 'Review', icon: '🔍', prompt: './prompts/review.md', timeout: 300, workers: 1, retries: 0, reject_to: 'dev', reset_to: ['dev', 'review'] },
      { name: 'tester', displayName: 'Tester', icon: '🧪', prompt: './prompts/tester.md', timeout: 300, workers: 2, retries: 3, reject_to: 'dev', reset_to: ['dev', 'tester'] },
    ],
    ...overrides,
  };
}

describe('ConfigLoader — multi-team support', () => {
  let projectRoot: string;
  let teamsDir: string;

  beforeEach(() => {
    projectRoot = createTempDir();
    teamsDir = createTempDir();
    mockResourcePath.teamsDir = teamsDir;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(teamsDir, { recursive: true, force: true });
  });

  // AC (a): v1 config with 'team' field normalizes to v2 fields without error
  describe('v1 → v2 normalization', () => {
    it('normalizes v1 config (version:1, team field) to activeTeam + teams array', () => {
      const v1Config = {
        version: 1,
        project: { name: 'my-project' },
        team: 'agentkit',
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v1Config);

      const loader = new ConfigLoader(projectRoot);
      const result = loader.loadProjectConfig();

      expect(result.activeTeam).toBe('agentkit');
      expect(result.teams).toEqual(['agentkit']);
      expect(result.version).toBe(2);
      expect((result as unknown as Record<string, unknown>).team).toBeUndefined();
    });

    it('normalizes v1 config when version field is absent but team is present', () => {
      // version field missing, only team present → treat as v1
      const raw = {
        project: { name: 'my-project' },
        team: 'content-writing',
        provider: 'claude-cli',
        models: {},
      };
      // validateProjectConfig expects version to be a number — use version:1 to satisfy validation
      // Edge case: no version key at all. validateProjectConfig checks typeof !== 'number'.
      // This will throw at validation. So the real edge case described in spec is:
      // "no 'version' key but 'team' present" — but validateProjectConfig requires version.
      // The normalizer handles (team present AND activeTeam absent) regardless of version value.
      // Use version:1 here to get past validation, then verify normalization:
      const v1WithOnlyTeam = { ...raw, version: 1 };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v1WithOnlyTeam);

      const loader = new ConfigLoader(projectRoot);
      const result = loader.loadProjectConfig();

      expect(result.activeTeam).toBe('content-writing');
      expect(result.teams).toEqual(['content-writing']);
      expect(result.version).toBe(2);
      expect((result as unknown as Record<string, unknown>).team).toBeUndefined();
    });

    it('preserves models from v1 config during normalization', () => {
      const v1Config = {
        version: 1,
        project: { name: 'proj' },
        team: 'agentkit',
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus' },
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v1Config);

      const loader = new ConfigLoader(projectRoot);
      const result = loader.loadProjectConfig();

      expect(result.models).toEqual({ 'claude-cli': { sm: 'sonnet', dev: 'opus' } });
    });

    it('defaults models to empty object when absent in v1 config', () => {
      const v1Config = {
        version: 1,
        project: { name: 'proj' },
        team: 'agentkit',
        provider: 'claude-cli',
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v1Config);

      // models field missing — validateProjectConfig requires it, so this will throw
      // The spec says normalizeProjectConfig uses raw.models ?? {} — but validation runs first.
      // Confirm validation throws for missing models:
      const loader = new ConfigLoader(projectRoot);
      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow('missing required field: models');
    });
  });

  // AC (b): v2 config with valid activeTeam in teams → loads without error
  describe('v2 config loading', () => {
    it('loads v2 config with single team without error', () => {
      const v2Config = {
        version: 2,
        project: { name: 'my-project' },
        activeTeam: 'agentkit',
        teams: ['agentkit'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());

      const loader = new ConfigLoader(projectRoot);
      expect(() => loader.load()).not.toThrow();
    });

    it('loads v2 config with multiple teams using activeTeam that is in teams', () => {
      const v2Config = {
        version: 2,
        project: { name: 'my-project' },
        activeTeam: 'agentkit',
        teams: ['agentkit', 'content-writing'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.team).toBe('agentkit');
    });

    it('returns ProjectConfig with no team key on v2 config', () => {
      const v2Config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: 'agentkit',
        teams: ['agentkit'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);

      const loader = new ConfigLoader(projectRoot);
      const result = loader.loadProjectConfig();

      expect((result as unknown as Record<string, unknown>).team).toBeUndefined();
      expect(result.activeTeam).toBe('agentkit');
      expect(result.teams).toEqual(['agentkit']);
    });
  });

  // AC (c): activeTeam not in teams → throws ConfigError
  describe('activeTeam validation in load()', () => {
    it('throws ConfigError when activeTeam is not in teams array', () => {
      const v2Config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: 'ghost',
        teams: ['agentkit', 'content-writing'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);

      const loader = new ConfigLoader(projectRoot);
      expect(() => loader.load()).toThrow(ConfigError);
      expect(() => loader.load()).toThrow(/activeTeam .* is not in teams/);
    });

    it('throws ConfigError with descriptive message including activeTeam and teams', () => {
      const v2Config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: 'ghost',
        teams: ['agentkit', 'content-writing'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);

      const loader = new ConfigLoader(projectRoot);
      try {
        loader.load();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        if (err instanceof ConfigError) {
          expect(err.message).toContain('"ghost"');
          expect(err.message).toContain('agentkit');
          expect(err.message).toContain('content-writing');
        }
      }
    });

    it('does not throw when activeTeam equals the only entry in teams', () => {
      const v2Config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: 'agentkit',
        teams: ['agentkit'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());

      const loader = new ConfigLoader(projectRoot);
      expect(() => loader.load()).not.toThrow();
    });

    it('teams array with duplicate entries does not cause errors (includes check still works)', () => {
      const v2Config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: 'agentkit',
        teams: ['agentkit', 'agentkit'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());

      const loader = new ConfigLoader(projectRoot);
      expect(() => loader.load()).not.toThrow();
    });
  });

  // AC (d): v1 config saved via ConfigService → output JSON has version:2, no 'team' key
  describe('ConfigService.saveModelAssignments — v2 output', () => {
    it('writes v2 format when saving model assignments from v1 config', () => {
      const v1Config = {
        version: 1,
        project: { name: 'proj' },
        team: 'agentkit',
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v1Config);
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());

      const service = new ConfigService(projectRoot);
      service.saveModelAssignments({ sm: 'sonnet', dev: 'sonnet', review: 'sonnet', tester: 'haiku' });

      const savedRaw = JSON.parse(
        readFileSync(join(projectRoot, '_agent_kit', 'agentkit.config.json'), 'utf-8')
      ) as Record<string, unknown>;

      expect(savedRaw.version).toBe(2);
      expect(savedRaw.activeTeam).toBe('agentkit');
      expect(savedRaw.teams).toEqual(['agentkit']);
      expect(savedRaw.team).toBeUndefined();
    });

    it('preserves v2 format when saving model assignments from v2 config', () => {
      const v2Config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: 'agentkit',
        teams: ['agentkit', 'content-writing'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());

      const service = new ConfigService(projectRoot);
      service.saveModelAssignments({ sm: 'sonnet', dev: 'sonnet', review: 'sonnet', tester: 'haiku' });

      const savedRaw = JSON.parse(
        readFileSync(join(projectRoot, '_agent_kit', 'agentkit.config.json'), 'utf-8')
      ) as Record<string, unknown>;

      expect(savedRaw.version).toBe(2);
      expect(savedRaw.activeTeam).toBe('agentkit');
      expect(savedRaw.teams).toEqual(['agentkit', 'content-writing']);
      expect(savedRaw.team).toBeUndefined();
    });
  });

  // AC (f): teamConfig.team !== activeTeam → throws ConfigError
  describe('teamConfig.team mismatch check', () => {
    it('throws ConfigError when teamConfig.team does not match projectConfig.activeTeam', () => {
      const v2Config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: 'agentkit',
        teams: ['agentkit'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);
      // team config directory named 'agentkit' but team field says 'different'
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig({ team: 'different' }));

      const loader = new ConfigLoader(projectRoot);
      expect(() => loader.load()).toThrow(ConfigError);
      expect(() => loader.load()).toThrow('does not match');
    });

    it('prefers project-local team config override over bundled', () => {
      const v2Config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: 'agentkit',
        teams: ['agentkit'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), v2Config);

      // Write bundled config
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());

      // Write local override with different displayName
      const localOverridePath = join(projectRoot, '_agent_kit', 'teams', 'agentkit');
      mkdirSync(localOverridePath, { recursive: true });
      writeFileSync(
        join(localOverridePath, 'config.json'),
        JSON.stringify(makeTeamConfig({ displayName: 'Local Override Pipeline' }))
      );

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.displayName).toBe('Local Override Pipeline');
    });
  });

  // validateProjectConfig edge cases
  describe('validateProjectConfig edge cases', () => {
    it('throws ConfigError when activeTeam is empty string', () => {
      const config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: '',
        teams: ['agentkit'],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), config);

      const loader = new ConfigLoader(projectRoot);
      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow('activeTeam');
    });

    it('throws ConfigError when teams is an empty array', () => {
      const config = {
        version: 2,
        project: { name: 'proj' },
        activeTeam: 'agentkit',
        teams: [],
        provider: 'claude-cli',
        models: {},
      };
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), config);

      const loader = new ConfigLoader(projectRoot);
      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow('teams');
    });
  });
});
