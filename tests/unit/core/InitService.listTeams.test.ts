import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Dirent } from 'node:fs';

// Mock node:fs before importing InitService
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: vi.fn(),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('@shared/ResourcePath.js', () => ({
  getBundledTeamsDir: vi.fn(() => '/bundled/teams'),
  getBundledTeamDir: vi.fn((name: string) => `/bundled/teams/${name}`),
}));

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { InitService } from '@core/InitService.js';
import { ConfigError } from '@core/Errors.js';

const mockReaddirSync = vi.mocked(readdirSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    path: '/bundled/teams',
    parentPath: '/bundled/teams',
  } as unknown as Dirent;
}

const validSoftwareConfig = JSON.stringify({
  team: 'agentkit',
  displayName: 'Software Development Pipeline',
  version: 1,
  stages: [
    {
      name: 'sm',
      displayName: 'Story Manager',
      icon: '📋',
      prompt: 'sm.md',
      timeout: 60,
      workers: 1,
      retries: 2,
      next: 'dev',
    },
  ],
  models: {
    'claude-cli': {
      allowed: ['opus', 'sonnet', 'haiku'],
      defaults: { sm: 'sonnet' },
    },
  },
});

const validChatjanitorConfig = JSON.stringify({
  team: 'chatjanitor',
  displayName: 'Chat Janitor',
  version: 1,
  stages: [
    {
      name: 'sm',
      displayName: 'Story Manager',
      icon: '🤖',
      prompt: 'sm.md',
      timeout: 60,
      workers: 1,
      retries: 2,
    },
  ],
  models: {
    'claude-cli': {
      allowed: ['sonnet', 'haiku'],
      defaults: { sm: 'haiku' },
    },
  },
});

describe('InitService.listTeams()', () => {
  let service: InitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InitService();
  });

  it('returns all teams when multiple valid directories exist', () => {
    mockReaddirSync.mockReturnValue([
      makeDirent('agentkit', true),
      makeDirent('chatjanitor', true),
    ] as unknown as ReturnType<typeof readdirSync>);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce(validSoftwareConfig)
      .mockReturnValueOnce(validChatjanitorConfig);

    const teams = service.listTeams();

    expect(teams).toHaveLength(2);
    expect(teams[0].team).toBe('agentkit');
    expect(teams[1].team).toBe('chatjanitor');
  });

  it('skips directories with missing or invalid config.json', () => {
    mockReaddirSync.mockReturnValue([
      makeDirent('agentkit', true),
      makeDirent('broken', true),
      makeDirent('.DS_Store', false), // not a directory
    ] as unknown as ReturnType<typeof readdirSync>);

    // agentkit config exists, broken does not
    mockExistsSync.mockImplementation((p: string) => {
      return (p as string).includes('agentkit');
    });
    mockReadFileSync.mockReturnValueOnce(validSoftwareConfig);

    const teams = service.listTeams();

    expect(teams).toHaveLength(1);
    expect(teams[0].team).toBe('agentkit');
  });

  it('throws ConfigError when readdirSync on teamsDir fails', () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => service.listTeams()).toThrowError(ConfigError);
    expect(() => {
      vi.clearAllMocks();
      mockReaddirSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      service.listTeams();
    }).toThrow('Cannot read bundled teams directory');
  });

  it('returns single-element array when only one bundled team exists', () => {
    mockReaddirSync.mockReturnValue([
      makeDirent('agentkit', true),
    ] as unknown as ReturnType<typeof readdirSync>);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValueOnce(validSoftwareConfig);

    const teams = service.listTeams();

    expect(teams).toHaveLength(1);
    expect(teams[0].team).toBe('agentkit');
    expect(teams[0].displayName).toBe('Software Development Pipeline');
  });

  it('skips non-directory entries (files, symlinks, etc.)', () => {
    mockReaddirSync.mockReturnValue([
      makeDirent('agentkit', true),
      makeDirent('README.md', false),
      makeDirent('.DS_Store', false),
    ] as unknown as ReturnType<typeof readdirSync>);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValueOnce(validSoftwareConfig);

    const teams = service.listTeams();

    expect(teams).toHaveLength(1);
    expect(teams[0].team).toBe('agentkit');
  });

  it('skips directories with malformed JSON in config.json', () => {
    mockReaddirSync.mockReturnValue([
      makeDirent('agentkit', true),
      makeDirent('malformed', true),
    ] as unknown as ReturnType<typeof readdirSync>);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce(validSoftwareConfig)
      .mockReturnValueOnce('not valid json {{{');

    const teams = service.listTeams();

    expect(teams).toHaveLength(1);
    expect(teams[0].team).toBe('agentkit');
  });
});
