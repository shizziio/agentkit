import { describe, it, expect } from 'vitest';
import { getBundledTeamsDir, getBundledTeamDir, getBundledWorkflowPath } from '@shared/ResourcePath.js';

describe('ResourcePath', () => {
  describe('getBundledTeamsDir', () => {
    it('returns a string ending in resources/teams', () => {
      const result = getBundledTeamsDir();
      expect(typeof result).toBe('string');
      expect(result.replace(/\\/g, '/')).toMatch(/resources\/teams$/);
    });

    it('returns a non-empty string', () => {
      const result = getBundledTeamsDir();
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns the same value on repeated calls (pure/deterministic)', () => {
      expect(getBundledTeamsDir()).toBe(getBundledTeamsDir());
    });
  });

  describe('getBundledTeamDir', () => {
    it('returns a string ending in resources/teams/<teamName>', () => {
      const result = getBundledTeamDir('agentkit');
      expect(typeof result).toBe('string');
      expect(result.replace(/\\/g, '/')).toMatch(/resources\/teams\/agentkit$/);
    });

    it('includes the team name in the returned path', () => {
      const result = getBundledTeamDir('my-team');
      expect(result.replace(/\\/g, '/')).toContain('my-team');
    });

    it('path ends with the provided team name', () => {
      const result = getBundledTeamDir('alpha');
      const normalized = result.replace(/\\/g, '/');
      expect(normalized.endsWith('/alpha')).toBe(true);
    });

    it('result is a subdirectory of getBundledTeamsDir()', () => {
      const teamsDir = getBundledTeamsDir().replace(/\\/g, '/');
      const teamDir = getBundledTeamDir('agentkit').replace(/\\/g, '/');
      expect(teamDir.startsWith(teamsDir)).toBe(true);
    });
  });

  describe('getBundledWorkflowPath', () => {
    it('returns a string ending in resources/workflows/<name>.md', () => {
      const result = getBundledWorkflowPath('create-team');
      expect(typeof result).toBe('string');
      expect(result.replace(/\\/g, '/')).toMatch(/resources\/workflows\/create-team\.md$/);
    });

    it('appends .md extension to the workflow name', () => {
      const result = getBundledWorkflowPath('my-workflow');
      expect(result.replace(/\\/g, '/')).toMatch(/my-workflow\.md$/);
    });

    it('result contains the workflow name before the .md extension', () => {
      const name = 'setup-pipeline';
      const result = getBundledWorkflowPath(name);
      const normalized = result.replace(/\\/g, '/');
      expect(normalized).toContain(`/${name}.md`);
    });

    it('returns different paths for different workflow names', () => {
      const a = getBundledWorkflowPath('workflow-a');
      const b = getBundledWorkflowPath('workflow-b');
      expect(a).not.toBe(b);
    });
  });

  describe('path traversal guard', () => {
    // --- getBundledTeamDir ---
    it('getBundledTeamDir throws on ".." in team name', () => {
      expect(() => getBundledTeamDir('../../etc')).toThrow('Invalid team name');
    });

    it('getBundledTeamDir throws on "/" in team name', () => {
      expect(() => getBundledTeamDir('foo/bar')).toThrow('Invalid team name');
    });

    it('getBundledTeamDir throws on "\\" in team name', () => {
      expect(() => getBundledTeamDir('foo\\bar')).toThrow('Invalid team name');
    });

    it('getBundledTeamDir throws ConfigError with message containing the invalid name', () => {
      expect(() => getBundledTeamDir('../../etc')).toThrow('../../etc');
    });

    it('getBundledTeamDir throws when name is only ".."', () => {
      expect(() => getBundledTeamDir('..')).toThrow('Invalid team name');
    });

    it('getBundledTeamDir throws when name starts with "/"', () => {
      expect(() => getBundledTeamDir('/absolute/path')).toThrow('Invalid team name');
    });

    it('getBundledTeamDir throws when name contains embedded ".."', () => {
      expect(() => getBundledTeamDir('a..b')).toThrow('Invalid team name');
    });

    it('getBundledTeamDir throws when name contains Windows-style backslash traversal', () => {
      expect(() => getBundledTeamDir('..\\windows')).toThrow('Invalid team name');
    });

    // --- getBundledWorkflowPath ---
    it('getBundledWorkflowPath throws on ".." in workflow name', () => {
      expect(() => getBundledWorkflowPath('../../etc/passwd')).toThrow('Invalid workflow name');
    });

    it('getBundledWorkflowPath throws on "/" in workflow name', () => {
      expect(() => getBundledWorkflowPath('foo/bar')).toThrow('Invalid workflow name');
    });

    it('getBundledWorkflowPath throws on "\\" in workflow name', () => {
      expect(() => getBundledWorkflowPath('foo\\bar')).toThrow('Invalid workflow name');
    });

    it('getBundledWorkflowPath throws ConfigError with message containing the invalid name', () => {
      expect(() => getBundledWorkflowPath('foo/bar')).toThrow('foo/bar');
    });

    it('getBundledWorkflowPath throws when name is only ".."', () => {
      expect(() => getBundledWorkflowPath('..')).toThrow('Invalid workflow name');
    });

    it('getBundledWorkflowPath throws when name starts with "/"', () => {
      expect(() => getBundledWorkflowPath('/etc/passwd')).toThrow('Invalid workflow name');
    });

    it('getBundledWorkflowPath throws when name contains embedded ".."', () => {
      expect(() => getBundledWorkflowPath('a..b')).toThrow('Invalid workflow name');
    });

    it('getBundledWorkflowPath throws when name contains Windows-style backslash traversal', () => {
      expect(() => getBundledWorkflowPath('..\\system32')).toThrow('Invalid workflow name');
    });
  });
});
