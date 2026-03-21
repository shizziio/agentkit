import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { ConfigLoader } from '../../../src/core/ConfigLoader.js';
import { ConfigError } from '../../../src/core/Errors.js';

const mockResourcePath = vi.hoisted(() => ({ teamsDir: '' }));

vi.mock('@shared/ResourcePath.js', () => ({
  getBundledTeamsDir: () => mockResourcePath.teamsDir,
  getBundledTeamDir: (name: string) => `${mockResourcePath.teamsDir}/${name}`,
  getBundledWorkflowPath: (name: string) => `${mockResourcePath.teamsDir}/../workflows/${name}.md`,
}));

function createTempDir(): string {
  const dir = join(tmpdir(), `agentkit-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTeamConfig(
  teamsDir: string,
  teamName: string,
  config: Record<string, unknown>,
): void {
  const teamDir = join(teamsDir, teamName);
  mkdirSync(teamDir, { recursive: true });
  writeFileSync(join(teamDir, 'config.json'), JSON.stringify(config));
}

function writeProjectConfig(
  projectRoot: string,
  config: Record<string, unknown>,
): void {
  const configDir = join(projectRoot, '_agent_kit');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'agentkit.config.json'), JSON.stringify(config));
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
          dev: 'opus',
          review: 'sonnet',
          tester: 'haiku',
        },
      },
    },
    stages: [
      { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, next: 'dev', reset_to: ['sm'] },
      { name: 'dev', displayName: 'Dev', icon: '💻', prompt: './prompts/dev.md', timeout: 600, workers: 1, retries: 0, next: 'review', reset_to: ['sm', 'dev'] },
      { name: 'review', displayName: 'Review', icon: '🔍', prompt: './prompts/review.md', timeout: 300, workers: 1, retries: 0, next: 'tester', reject_to: 'dev', reset_to: ['dev', 'review'] },
      { name: 'tester', displayName: 'Tester', icon: '🧪', prompt: './prompts/tester.md', timeout: 300, workers: 2, retries: 3, reject_to: 'dev', reset_to: ['dev', 'review', 'tester'] },
    ],
    ...overrides,
  };
}

function makeProjectConfig(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 2,
    project: { name: 'test-project' },
    activeTeam: 'agentkit',
    teams: ['agentkit'],
    provider: 'claude-cli',
    models: {},
    ...overrides,
  };
}

describe('ConfigLoader', () => {
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

  describe('load', () => {
    it('should load and merge config successfully with defaults', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.team).toBe('agentkit');
      expect(config.displayName).toBe('Software Development Pipeline');
      expect(config.provider).toBe('claude-cli');
      expect(config.project.name).toBe('test-project');
      expect(config.models.allowed).toEqual(['opus', 'sonnet', 'haiku']);
      expect(config.models.resolved).toEqual({
        sm: 'sonnet',
        dev: 'opus',
        review: 'sonnet',
        tester: 'haiku',
      });
      expect(config.stages).toHaveLength(4);
    });

    it('should allow project models to override team defaults', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());
      writeProjectConfig(projectRoot, makeProjectConfig({
        models: { 'claude-cli': { sm: 'opus', tester: 'sonnet' } },
      }));

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.models.resolved.sm).toBe('opus');
      expect(config.models.resolved.dev).toBe('opus');
      expect(config.models.resolved.review).toBe('sonnet');
      expect(config.models.resolved.tester).toBe('sonnet');
    });

    it('should throw ConfigError when project model not in allowed list', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());
      writeProjectConfig(projectRoot, makeProjectConfig({
        models: { 'claude-cli': { dev: 'gpt4' } },
      }));

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.load()).toThrow(ConfigError);
      expect(() => loader.load()).toThrow(
        'Model "gpt4" for stage "dev" is not in allowed models for claude-cli: opus, sonnet, haiku',
      );
    });

    it('should throw ConfigError when a stage has no model assigned', () => {
      const teamConfig = makeTeamConfig();
      // Remove 'dev' from defaults so it has no model
      (teamConfig.models as Record<string, any>)['claude-cli'].defaults = {
        sm: 'sonnet',
        review: 'sonnet',
        tester: 'haiku',
      };
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.load()).toThrow(ConfigError);
      expect(() => loader.load()).toThrow('Stage "dev" has no model assigned');
    });

    it('should return PipelineConfig with all stage routing info', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      const sm = config.stages.find(s => s.name === 'sm');
      expect(sm?.next).toBe('dev');
      expect(sm?.reject_to).toBeUndefined();
      expect(sm?.timeout).toBe(300);
      expect(sm?.workers).toBe(1);

      const review = config.stages.find(s => s.name === 'review');
      expect(review?.next).toBe('tester');
      expect(review?.reject_to).toBe('dev');

      const tester = config.stages.find(s => s.name === 'tester');
      expect(tester?.next).toBeUndefined();
      expect(tester?.reject_to).toBe('dev');
      expect(tester?.workers).toBe(2);
      expect(tester?.retries).toBe(3);
    });

    it('should use all team defaults when project models is empty', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());
      writeProjectConfig(projectRoot, makeProjectConfig({ models: {} }));

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.models.resolved).toEqual({
        sm: 'sonnet',
        dev: 'opus',
        review: 'sonnet',
        tester: 'haiku',
      });
    });

    it('should silently ignore project model overrides for non-existent stages', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());
      writeProjectConfig(projectRoot, makeProjectConfig({
        models: { 'claude-cli': { nonexistent: 'opus' } },
      }));

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.models.resolved.sm).toBe('sonnet');
      expect(config.models.resolved.nonexistent).toBe('opus');
    });
  });

  describe('loadTeamConfig', () => {
    it('should throw ConfigError when team config file is missing', () => {
      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('nonexistent')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('nonexistent')).toThrow(
        'Team config not found: nonexistent',
      );
    });

    it('should throw ConfigError when team config JSON is malformed', () => {
      const teamDir = join(teamsDir, 'bad');
      mkdirSync(teamDir, { recursive: true });
      writeFileSync(join(teamDir, 'config.json'), '{invalid json!!!');

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('Malformed JSON');
    });

    it('should throw ConfigError when team config has no stages', () => {
      writeTeamConfig(teamsDir, 'empty', makeTeamConfig({ stages: [] }));

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('empty')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('empty')).toThrow('at least one stage');
    });

    it('should throw ConfigError when version is not a number', () => {
      writeTeamConfig(teamsDir, 'bad', makeTeamConfig({ version: 'one' }));

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('version must be a number');
    });

    it('should tolerate extra unknown fields in team config', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig({ extraField: 'hello', customData: 42 }));

      const loader = new ConfigLoader(projectRoot);
      const config = loader.loadTeamConfig('agentkit');

      expect(config.team).toBe('agentkit');
      expect(config.stages).toHaveLength(4);
    });

    it('should throw ConfigError when stage is missing required fields', () => {
      const teamConfig = makeTeamConfig({
        stages: [{ name: 'sm' }],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('missing required field: displayName');
    });

    it('should throw ConfigError when stage timeout is not a number', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 'slow', workers: 1, retries: 0 },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('missing required field: timeout');
    });

    it('should throw ConfigError when stage references unknown next stage', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, next: 'nonexistent' },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('references unknown next stage');
    });

    it('should throw ConfigError when team name contains path traversal', () => {
      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('../etc')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('../etc')).toThrow('Invalid team name');
    });

    it('should throw ConfigError when stage next is not a string', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, next: 123 },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('"next" must be a string');
    });

    it('should throw ConfigError when stage reject_to is not a string', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, reject_to: true },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('"reject_to" must be a string');
    });

    it('should throw ConfigError when stage icon is missing', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0 },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('missing required field: icon');
    });
  });

  describe('loadProjectConfig', () => {
    it('should throw ConfigError when project config file is missing', () => {
      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow(
        'Project config not found: _agent_kit/agentkit.config.json',
      );
    });

    it('should throw ConfigError when project config JSON is malformed', () => {
      const configDir = join(projectRoot, '_agent_kit');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'agentkit.config.json'), 'not valid json');

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow('Malformed JSON');
    });

    it('should throw ConfigError when project config is empty object', () => {
      writeProjectConfig(projectRoot, {});

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
    });

    it('should throw ConfigError when project config version is not a number', () => {
      writeProjectConfig(projectRoot, makeProjectConfig({ version: 'one' }));

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow('version must be a number');
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should throw ConfigError when team field is missing from team config', () => {
      const teamConfig = makeTeamConfig();
      delete (teamConfig as Record<string, unknown>).team;
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('agentkit')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('agentkit')).toThrow('missing required field: team');
    });

    it('should throw ConfigError when displayName field is missing from team config', () => {
      const teamConfig = makeTeamConfig();
      delete (teamConfig as Record<string, unknown>).displayName;
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('agentkit')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('agentkit')).toThrow('missing required field: displayName');
    });

    it('should throw ConfigError when models.allowed is missing from team config', () => {
      const teamConfig = makeTeamConfig();
      (teamConfig.models as Record<string, any>)['claude-cli'].allowed = undefined;
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('agentkit')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('agentkit')).toThrow('Team config models for provider "claude-cli" missing required field: allowed');
    });

    it('should throw ConfigError when project.name is missing from project config', () => {
      const projectConfig = makeProjectConfig();
      (projectConfig.project as Record<string, unknown>).name = undefined;
      writeProjectConfig(projectRoot, projectConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow('missing required field: project.name');
    });

    it('should throw ConfigError when activeTeam field is missing from project config', () => {
      const projectConfig = makeProjectConfig();
      delete (projectConfig as Record<string, unknown>).activeTeam;
      writeProjectConfig(projectRoot, projectConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow('missing required field: activeTeam');
    });

    it('should throw ConfigError when provider field is missing from project config', () => {
      const projectConfig = makeProjectConfig();
      delete (projectConfig as Record<string, unknown>).provider;
      writeProjectConfig(projectRoot, projectConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow('missing required field: provider');
    });

    it('should throw ConfigError when models field is missing from project config', () => {
      const projectConfig = makeProjectConfig();
      delete (projectConfig as Record<string, unknown>).models;
      writeProjectConfig(projectRoot, projectConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadProjectConfig()).toThrow(ConfigError);
      expect(() => loader.loadProjectConfig()).toThrow('missing required field: models');
    });

    it('should throw ConfigError when team names do not match in load()', () => {
      // Create team config file in 'agentkit' directory but with mismatched team name
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig({ team: 'different-team' }));
      writeProjectConfig(projectRoot, makeProjectConfig({ activeTeam: 'agentkit' }));

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.load()).toThrow(ConfigError);
      expect(() => loader.load()).toThrow('does not match');
    });

    it('should preserve project owner field in final config', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());
      writeProjectConfig(projectRoot, makeProjectConfig({
        project: { name: 'test-project', owner: 'alice' },
      }));

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.project.owner).toBe('alice');
    });

    it('should validate ConfigError has correct code and name', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());
      writeProjectConfig(projectRoot, makeProjectConfig({ models: { 'claude-cli': { dev: 'invalid' } } }));

      const loader = new ConfigLoader(projectRoot);

      try {
        loader.load();
        expect.fail('Should have thrown ConfigError');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        if (err instanceof ConfigError) {
          expect(err.code).toBe('CONFIG_ERROR');
          expect(err.name).toBe('ConfigError');
        }
      }
    });
  });

  describe('reset_to validation and defaults', () => {
    it('should default reset_to to all stages from index 0 to current when absent', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, next: 'dev' },
          { name: 'dev', displayName: 'Dev', icon: '💻', prompt: './prompts/dev.md', timeout: 600, workers: 1, retries: 0, next: 'review' },
          { name: 'review', displayName: 'Review', icon: '🔍', prompt: './prompts/review.md', timeout: 300, workers: 1, retries: 0, next: 'tester', reject_to: 'dev' },
          { name: 'tester', displayName: 'Tester', icon: '🧪', prompt: './prompts/tester.md', timeout: 300, workers: 2, retries: 3, reject_to: 'dev' },
        ],
      });
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.stages.find(s => s.name === 'sm')?.reset_to).toEqual(['sm']);
      expect(config.stages.find(s => s.name === 'dev')?.reset_to).toEqual(['sm', 'dev']);
      expect(config.stages.find(s => s.name === 'review')?.reset_to).toEqual(['sm', 'dev', 'review']);
      expect(config.stages.find(s => s.name === 'tester')?.reset_to).toEqual(['sm', 'dev', 'review', 'tester']);
    });

    it('should preserve explicit reset_to values without modification', () => {
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig());
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.stages.find(s => s.name === 'sm')?.reset_to).toEqual(['sm']);
      expect(config.stages.find(s => s.name === 'dev')?.reset_to).toEqual(['sm', 'dev']);
      expect(config.stages.find(s => s.name === 'review')?.reset_to).toEqual(['dev', 'review']);
      expect(config.stages.find(s => s.name === 'tester')?.reset_to).toEqual(['dev', 'review', 'tester']);
    });

    it('should ensure every stage has a non-undefined reset_to after load()', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0 },
          { name: 'dev', displayName: 'Dev', icon: '💻', prompt: './prompts/dev.md', timeout: 600, workers: 1, retries: 0 },
        ],
      });
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      for (const stage of config.stages) {
        expect(stage.reset_to).toBeDefined();
        expect(Array.isArray(stage.reset_to)).toBe(true);
      }
    });

    it('should throw ConfigError when reset_to is not an array (e.g. a string)', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, reset_to: 'sm' },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('reset_to" must be an array');
    });

    it('should throw ConfigError when reset_to entry is not a string', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, reset_to: [42] },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('reset_to entries must be strings');
    });

    it('should throw ConfigError when reset_to references unknown stage', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, reset_to: ['nonexistent'] },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('reset_to references unknown stage: "nonexistent"');
    });

    it('should throw ConfigError when reset_to references a later (forward) stage', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, reset_to: ['dev'] },
          { name: 'dev', displayName: 'Dev', icon: '💻', prompt: './prompts/dev.md', timeout: 600, workers: 1, retries: 0 },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('reset_to cannot reference a later stage: "dev"');
    });

    it('should accept empty reset_to array (disables reset)', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, reset_to: [] },
          { name: 'dev', displayName: 'Dev', icon: '💻', prompt: './prompts/dev.md', timeout: 600, workers: 1, retries: 0 },
        ],
      });
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.stages.find(s => s.name === 'sm')?.reset_to).toEqual([]);
    });

    it('should accept self-reset (stage references itself in reset_to)', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, reset_to: ['sm'] },
          { name: 'dev', displayName: 'Dev', icon: '💻', prompt: './prompts/dev.md', timeout: 600, workers: 1, retries: 0 },
        ],
      });
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.stages.find(s => s.name === 'sm')?.reset_to).toEqual(['sm']);
    });

    it('should accept reset_to with duplicate stage names', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, reset_to: ['sm', 'sm'] },
          { name: 'dev', displayName: 'Dev', icon: '💻', prompt: './prompts/dev.md', timeout: 600, workers: 1, retries: 0 },
        ],
      });
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.stages.find(s => s.name === 'sm')?.reset_to).toEqual(['sm', 'sm']);
    });

    it('should default first-stage reset_to to [stage0.name] only', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0 },
        ],
      });
      writeTeamConfig(teamsDir, 'agentkit', teamConfig);
      writeProjectConfig(projectRoot, makeProjectConfig());

      const loader = new ConfigLoader(projectRoot);
      const config = loader.load();

      expect(config.stages[0].reset_to).toEqual(['sm']);
    });

    it('should validate reset_to on single-stage config (forward ref to non-existent stage must throw)', () => {
      const teamConfig = makeTeamConfig({
        stages: [
          { name: 'sm', displayName: 'SM', icon: '📋', prompt: './prompts/sm.md', timeout: 300, workers: 1, retries: 0, reset_to: ['dev'] },
        ],
      });
      writeTeamConfig(teamsDir, 'bad', teamConfig);

      const loader = new ConfigLoader(projectRoot);

      expect(() => loader.loadTeamConfig('bad')).toThrow(ConfigError);
      expect(() => loader.loadTeamConfig('bad')).toThrow('reset_to references unknown stage: "dev"');
    });
  });
});
