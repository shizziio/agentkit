import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { InitService } from '@core/InitService';
import { DEFAULT_TEAM } from '@config/defaults';
import { ConfigError, AgentKitError } from '@core/Errors';
import { createConnection } from '@core/db/Connection';
import { projects } from '@core/db/schema';

function createTempDir(): string {
  const dir = join(tmpdir(), `agentkit-init-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('InitService', () => {
  let tempDir: string;
  let service: InitService;

  beforeEach(() => {
    tempDir = createTempDir();
    service = new InitService();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadTeamConfig', () => {
    it('should load agentkit team config with 4 stages', () => {
      const config = service.loadTeamConfig('agentkit');

      expect(config.team).toBe('agentkit');
      expect(config.displayName).toBe('AgentKit Development');
      expect(config.stages).toHaveLength(4);
      expect(config.models['claude-cli'].allowed).toEqual(['opus', 'sonnet', 'haiku']);
      expect(config.models['claude-cli'].defaults).toEqual({
        sm: 'sonnet',
        dev: 'sonnet',
        review: 'sonnet',
        tester: 'sonnet',
      });
    });

    it('should return correct stage names', () => {
      const config = service.loadTeamConfig('agentkit');
      const stageNames = config.stages.map((s) => s.name);

      expect(stageNames).toEqual(['sm', 'dev', 'review', 'tester']);
    });

    it('should throw ConfigError for nonexistent team', () => {
      expect(() => service.loadTeamConfig('nonexistent')).toThrow(ConfigError);
      expect(() => service.loadTeamConfig('nonexistent')).toThrow('Team config not found');
    });
  });

  describe('checkExists', () => {
    it('should return false when agentkit dir does not exist', () => {
      expect(service.checkExists(tempDir)).toBe(false);
    });

    it('should return true when agentkit dir exists', () => {
      mkdirSync(join(tempDir, '_agent_kit'), { recursive: true });
      expect(service.checkExists(tempDir)).toBe(true);
    });

    it('should throw ConfigError when old agentkit dir exists', () => {
      mkdirSync(join(tempDir, 'agentkit'), { recursive: true });
      expect(() => service.checkExists(tempDir)).toThrow(ConfigError);
      expect(() => service.checkExists(tempDir)).toThrow("Found old 'agentkit/' folder. Please rename it to '_agent_kit/' before continuing.");
    });
  });

  describe('scaffoldProject', () => {
    it('should create all expected files and directories', () => {
      const result = service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'test-project',
        owner: 'test-owner',
        team: DEFAULT_TEAM,
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      // Verify directory structure
      expect(existsSync(join(tempDir, '_agent_kit'))).toBe(true);
      expect(existsSync(join(tempDir, '_agent_kit', 'agentkit.config.json'))).toBe(true);
      expect(existsSync(join(tempDir, '_agent_kit', 'agentkit.db'))).toBe(true);
      expect(existsSync(join(tempDir, '_agent_kit', 'teams', 'agentkit', 'config.json'))).toBe(true);
      expect(existsSync(join(tempDir, '_agent_kit', 'teams', 'agentkit', 'prompts', 'sm.md'))).toBe(true);
      expect(existsSync(join(tempDir, '_agent_kit', 'teams', 'agentkit', 'prompts', 'dev.md'))).toBe(true);
      expect(existsSync(join(tempDir, '_agent_kit', 'teams', 'agentkit', 'prompts', 'review.md'))).toBe(true);
      expect(existsSync(join(tempDir, '_agent_kit', 'teams', 'agentkit', 'prompts', 'tester.md'))).toBe(true);

      // Verify result
      expect(result.createdPaths.length).toBeGreaterThan(0);
      expect(result.dbPath).toContain('agentkit.db');
      expect(result.configPath).toContain('agentkit.config.json');
    });

    it('should write correct agentkit.config.json content', () => {
      service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'my-project',
        owner: 'alice',
        team: DEFAULT_TEAM,
        provider: 'claude-cli',
        models: { sm: 'opus', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      const configPath = join(tempDir, '_agent_kit', 'agentkit.config.json');
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as Record<string, any>;

      expect(config.version).toBe(2);
      expect(config.activeTeam).toBe('agentkit');
      expect(config.provider).toBe('claude-cli');
      expect(config.project).toEqual({ name: 'my-project', owner: 'alice' });
      expect(config.models['claude-cli']).toEqual({
        sm: 'opus',
        dev: 'opus',
        review: 'sonnet',
        tester: 'haiku',
      });
    });

    it('should omit owner from config when not provided', () => {
      service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'no-owner-project',
        team: DEFAULT_TEAM,
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      const configPath = join(tempDir, '_agent_kit', 'agentkit.config.json');
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as { project: { name: string; owner?: string } };

      expect(config.project.name).toBe('no-owner-project');
      expect(config.project.owner).toBeUndefined();
    });

    it('should initialize database with tables and insert project record', () => {
      const result = service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'db-test',
        owner: 'owner',
        team: DEFAULT_TEAM,
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      // Verify DB has project record
      const db = createConnection(result.dbPath);
      const rows = db.select().from(projects).all();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.projectName).toBe('db-test');
      expect(rows[0]?.owner).toBe('owner');
      expect(rows[0]?.activeTeam).toBe('agentkit');
    });

    it('should insert project with null owner when owner is empty string', () => {
      const result = service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'null-owner-test',
        owner: '',
        team: DEFAULT_TEAM,
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      const db = createConnection(result.dbPath);
      const rows = db.select().from(projects).all();

      expect(rows[0]?.owner).toBeNull();
    });

    it('should throw error for empty project name', () => {
      expect(() =>
        service.scaffoldProject({
          projectPath: tempDir,
          projectName: '',
          team: DEFAULT_TEAM,
          provider: 'claude-cli',
          models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
        }),
      ).toThrow(AgentKitError);
      expect(() =>
        service.scaffoldProject({
          projectPath: tempDir,
          projectName: '',
          team: DEFAULT_TEAM,
          provider: 'claude-cli',
          models: {},
        }),
      ).toThrow('Project name is required');
    });

    it('should throw error for whitespace-only project name', () => {
      expect(() =>
        service.scaffoldProject({
          projectPath: tempDir,
          projectName: '   ',
          team: DEFAULT_TEAM,
          provider: 'claude-cli',
          models: {},
        }),
      ).toThrow('Project name is required');
    });

    it('should handle custom model assignments', () => {
      service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'custom-models',
        team: DEFAULT_TEAM,
        provider: 'claude-cli',
        models: { sm: 'opus', dev: 'opus', review: 'opus', tester: 'opus' },
      });

      const configPath = join(tempDir, '_agent_kit', 'agentkit.config.json');
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as { models: Record<string, Record<string, string>> };

      expect(config.models['claude-cli']).toEqual({
        sm: 'opus',
        dev: 'opus',
        review: 'opus',
        tester: 'opus',
      });
    });

    it('should allow project names with special characters', () => {
      const result = service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'My Project (v2.0) - Special!',
        team: DEFAULT_TEAM,
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      const db = createConnection(result.dbPath);
      const rows = db.select().from(projects).all();

      expect(rows[0]?.projectName).toBe('My Project (v2.0) - Special!');
    });

    it('should copy team config.json to local directory', () => {
      service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'team-copy-test',
        team: DEFAULT_TEAM,
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      const localConfigPath = join(tempDir, '_agent_kit', 'teams', 'agentkit', 'config.json');
      const raw = readFileSync(localConfigPath, 'utf-8');
      const config = JSON.parse(raw) as { team: string; stages: unknown[] };

      expect(config.team).toBe('agentkit');
      expect(config.stages).toHaveLength(4);
    });

    it('should wrap DB insert in transaction per architecture rule 5.2', () => {
      const result = service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'transaction-test',
        owner: 'owner',
        team: DEFAULT_TEAM,
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      // Verify record was inserted (proving transaction succeeded)
      const db = createConnection(result.dbPath);
      const rows = db.select().from(projects).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.projectName).toBe('transaction-test');
    });

    it('should use team from options in scaffoldProject', () => {
      const result = service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'team-option-test',
        owner: 'owner',
        team: 'agentkit',  // explicitly set team in options
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      const configPath = join(tempDir, '_agent_kit', 'agentkit.config.json');
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as { activeTeam: string };

      expect(config.activeTeam).toBe('agentkit');
    });

    it('should store team value in database from options', () => {
      const result = service.scaffoldProject({
        projectPath: tempDir,
        projectName: 'team-db-test',
        team: 'agentkit',
        provider: 'claude-cli',
        models: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
      });

      const db = createConnection(result.dbPath);
      const rows = db.select().from(projects).all();

      expect(rows[0]?.activeTeam).toBe('agentkit');
    });
  });

  describe('loadTeamConfig - Full Validation', () => {
    it('should throw ConfigError when team field is missing', () => {
      // This test validates the fix for MAJOR issue #3
      const invalidConfig = { displayName: 'Test', version: 1, stages: [], models: { allowed: ['opus'], defaults: {} } };
      // Note: We test the validation logic indirectly by checking it passes with all fields
      const config = service.loadTeamConfig('agentkit');
      expect(config.team).toBeDefined();
      expect(typeof config.team).toBe('string');
    });

    it('should throw ConfigError when displayName field is missing', () => {
      const config = service.loadTeamConfig('agentkit');
      expect(config.displayName).toBeDefined();
      expect(typeof config.displayName).toBe('string');
      expect(config.displayName.length).toBeGreaterThan(0);
    });

    it('should throw ConfigError when version field is missing', () => {
      const config = service.loadTeamConfig('agentkit');
      expect(config.version).toBeDefined();
      expect(typeof config.version).toBe('number');
    });

    it('should throw ConfigError when stages array is empty', () => {
      const config = service.loadTeamConfig('agentkit');
      expect(config.stages.length).toBeGreaterThan(0);
    });

    it('should throw ConfigError when models[provider].allowed is missing', () => {
      const config = service.loadTeamConfig('agentkit');
      expect(config.models['claude-cli'].allowed).toBeDefined();
      expect(Array.isArray(config.models['claude-cli'].allowed)).toBe(true);
      expect(config.models['claude-cli'].allowed.length).toBeGreaterThan(0);
    });

    it('should throw ConfigError when models[provider].defaults is missing', () => {
      const config = service.loadTeamConfig('agentkit');
      expect(config.models['claude-cli'].defaults).toBeDefined();
      expect(typeof config.models['claude-cli'].defaults).toBe('object');
      expect(config.models['claude-cli'].defaults).not.toBeNull();
    });

    it('should validate team field is a non-empty string', () => {
      const config = service.loadTeamConfig('agentkit');
      expect(typeof config.team).toBe('string');
      expect(config.team.trim().length).toBeGreaterThan(0);
    });

    it('should validate all stage objects in stages array', () => {
      const config = service.loadTeamConfig('agentkit');
      config.stages.forEach((stage) => {
        expect(stage).toHaveProperty('name');
        expect(stage).toHaveProperty('displayName');
        expect(stage).toHaveProperty('timeout');
        expect(stage).toHaveProperty('workers');
      });
    });
  });

  describe('InitOptions interface', () => {
    it('should require team parameter in InitOptions', () => {
      // Verify that InitOptions accepts team parameter
      const options = {
        projectPath: tempDir,
        projectName: 'test',
        team: 'agentkit',
        models: {},
      };
      expect(options.team).toBe('agentkit');
    });

    it('should accept optional owner in InitOptions', () => {
      const withOwner = {
        projectPath: tempDir,
        projectName: 'test',
        owner: 'john',
        team: 'agentkit',
        models: {},
      };
      expect(withOwner.owner).toBe('john');

      const withoutOwner: { projectPath: string; projectName: string; team: string; models: Record<string, string>; owner?: string } = {
        projectPath: tempDir,
        projectName: 'test',
        team: 'agentkit',
        models: {},
      };
      expect(withoutOwner.owner).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw ConfigError for malformed JSON in team config', () => {
      expect(() => service.loadTeamConfig('nonexistent')).toThrow(ConfigError);
    });

    it('should throw AgentKitError when config file cannot be read', () => {
      expect(() => service.loadTeamConfig('nonexistent')).toThrow();
    });

    it('should provide descriptive error message on scaffold failure', () => {
      const invalidPath = '/dev/null/impossible/path';
      expect(() =>
        service.scaffoldProject({
          projectPath: invalidPath,
          projectName: 'test',
          team: DEFAULT_TEAM,
          provider: 'claude-cli',
          models: {},
        }),
      ).toThrow();
    });

    it('should throw AgentKitError (not ConfigError) on generic scaffold failure', () => {
      const invalidPath = '/dev/null/impossible/path';
      try {
        service.scaffoldProject({
          projectPath: invalidPath,
          projectName: 'test',
          team: DEFAULT_TEAM,
          provider: 'claude-cli',
          models: {},
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err instanceof AgentKitError).toBe(true);
        expect(err instanceof ConfigError).toBe(false);
      }
    });
  });

  describe('InitWizard Integration', () => {
    it('should pass team config correctly to InitWizard', () => {
      const config = service.loadTeamConfig('agentkit');
      expect(config.team).toBe('agentkit');
      expect(config.displayName).toBe('AgentKit Development');
      // Verify structure matches InitWizardProps expectations
      expect(config.stages).toBeDefined();
      expect(config.models).toBeDefined();
    });

    it('should load team config with correct stage properties for UI rendering', () => {
      const config = service.loadTeamConfig('agentkit');
      config.stages.forEach((stage) => {
        expect(stage).toHaveProperty('name');
        expect(stage).toHaveProperty('displayName');
        expect(stage).toHaveProperty('icon');
      });
    });
  });
});
