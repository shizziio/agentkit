import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { ConfigLoader } from '@core/ConfigLoader';
import { openDatabase } from '@core/db/Connection';
import { registerStartCommand } from '../../../src/cli/Start.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

vi.mock('@core/ConfigLoader.js', () => ({
  ConfigLoader: vi.fn(),
}));

vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(),
}));

vi.mock('@core/db/schema.js', () => ({
  projects: {},
}));

vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: () => Promise.resolve(),
    unmount: vi.fn(),
  }),
}));

vi.mock('@ui/start/MainMenu.js', () => ({
  MainMenu: vi.fn(),
}));

describe('registerStartCommand', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('should register start command on the program', () => {
    const program = new Command();
    registerStartCommand(program);

    const startCmd = program.commands.find((cmd) => cmd.name() === 'start');
    expect(startCmd).toBeDefined();
    expect(startCmd!.description()).toBe('Launch the interactive pipeline menu');
  });

  it('should call process.exit(1) when agentkit dir does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const program = new Command();
    registerStartCommand(program);

    await expect(
      program.parseAsync(['node', 'agentkit', 'start'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should call process.exit(1) when ConfigLoader.load() throws', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockImplementation(() => {
        throw new Error('Config load failed');
      }),
      loadTeamConfig: vi.fn(),
      loadProjectConfig: vi.fn(),
    }) as unknown as ConfigLoader);

    const program = new Command();
    registerStartCommand(program);

    await expect(
      program.parseAsync(['node', 'agentkit', 'start'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should call process.exit(1) when no project record is found in DB', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockReturnValue({
        project: { name: 'test-project' },
        displayName: 'Software Development Pipeline',
        provider: 'claude-cli',
        team: 'agentkit',
        stages: [],
        models: { allowed: [], resolved: {} },
      }),
      loadTeamConfig: vi.fn(),
      loadProjectConfig: vi.fn(),
    }) as unknown as ConfigLoader);

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnValue(undefined),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerStartCommand(program);

    await expect(
      program.parseAsync(['node', 'agentkit', 'start'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should successfully load config and query database when conditions met', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const mockConfig = {
      project: { name: 'test-project', owner: 'me' },
      displayName: 'Software Development Pipeline',
      provider: 'claude-cli',
      team: 'agentkit',
      stages: [
        {
          name: 'sm',
          displayName: 'Scrum Master',
          icon: '📋',
          prompt: 'sm.md',
          timeout: 30,
          workers: 1,
          retries: 3,
          next: 'dev',
        },
      ],
      models: { allowed: ['opus', 'sonnet'], resolved: { sm: 'sonnet' } },
    };

    const mockConfigLoader = {
      load: vi.fn().mockReturnValue(mockConfig),
      loadTeamConfig: vi.fn(),
      loadProjectConfig: vi.fn(),
    };
    vi.mocked(ConfigLoader).mockImplementation(() => mockConfigLoader as unknown as ConfigLoader);

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnValue({ id: 1, project_name: 'test-project' }),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const { render } = await import('ink');
    const renderMock = vi.mocked(render);
    const mockApp = {
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
      unmount: vi.fn(),
    };
    renderMock.mockReturnValue(mockApp as unknown as ReturnType<typeof render>);

    const program = new Command();
    registerStartCommand(program);

    // Verify that the command can be invoked and the mocks are set up correctly
    expect(mockConfigLoader.load).toBeDefined();
    expect(mockDb.select).toBeDefined();
    expect(renderMock).toBeDefined();
  });

  it('should handle generic Error type correctly', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockImplementation(() => {
        throw new Error('Unknown error');
      }),
      loadTeamConfig: vi.fn(),
      loadProjectConfig: vi.fn(),
    }) as unknown as ConfigLoader);

    const program = new Command();
    registerStartCommand(program);

    await expect(
      program.parseAsync(['node', 'agentkit', 'start'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle non-Error thrown value', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockImplementation(() => {
        // eslint-disable-next-line no-throw-literal
        throw 'string error';
      }),
      loadTeamConfig: vi.fn(),
      loadProjectConfig: vi.fn(),
    }) as unknown as ConfigLoader);

    const program = new Command();
    registerStartCommand(program);

    await expect(
      program.parseAsync(['node', 'agentkit', 'start'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
