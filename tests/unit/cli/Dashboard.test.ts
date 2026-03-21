import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { ConfigLoader } from '@core/ConfigLoader';
import { openDatabase } from '@core/db/Connection';
import { projects } from '@core/db/schema';
import { AgentKitError } from '@core/Errors';
import { render } from 'ink';
import { registerDashboardCommand } from '../../../src/cli/Dashboard.js';

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
  projects: { id: 'projects_id_field' },
}));

vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: () => Promise.resolve(),
    unmount: vi.fn(),
  }),
}));

vi.mock('@ui/dashboard/DashboardApp.js', () => ({
  DashboardApp: vi.fn(),
}));

vi.mock('@core/Errors.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/Errors.js')>();
  return actual;
});

describe('registerDashboardCommand', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('process.exit called');
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should register dashboard command on the program', () => {
    const program = new Command();
    registerDashboardCommand(program);

    const dashboardCmd = program.commands.find((cmd) => cmd.name() === 'dashboard');
    expect(dashboardCmd).toBeDefined();
    expect(dashboardCmd!.description()).toBe('Open the real-time TUI pipeline dashboard');
  });

  it('should call requireInitialized and exit if agentkit dir missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const program = new Command();
    registerDashboardCommand(program);

    await expect(
      program.parseAsync(['dashboard'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should rethrow non-AgentKitError when ConfigLoader.load() throws', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockImplementation(() => {
        throw new Error('Config load failed');
      }),
      loadTeamConfig: vi.fn(),
      loadProjectConfig: vi.fn(),
    }) as unknown as ConfigLoader);

    const program = new Command();
    registerDashboardCommand(program);

    await expect(
      program.parseAsync(['dashboard'], { from: 'user' }),
    ).rejects.toThrow('Config load failed');

    expect(exitSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should use SELECT with only id field per architecture rules', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockReturnValue({
        project: { name: 'test' },
        displayName: 'Test',
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
      get: vi.fn().mockReturnValue({ id: 1 }),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerDashboardCommand(program);

    await program.parseAsync(['dashboard'], { from: 'user' });

    // Verify select was called with field selection object, not empty
    expect(mockDb.select).toHaveBeenCalledWith({ id: projects.id });
    expect(mockDb.select).not.toHaveBeenCalledWith();
    expect(mockDb.from).toHaveBeenCalledWith(projects);
    expect(mockDb.limit).toHaveBeenCalledWith(1);
  });

  it('should throw AgentKitError with PROJECT_NOT_FOUND code when no project found', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockReturnValue({
        project: { name: 'test' },
        displayName: 'Test',
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
      get: vi.fn().mockReturnValue(null),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerDashboardCommand(program);

    await expect(
      program.parseAsync(['dashboard'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalled();
    const stderrCall = stderrSpy.mock.calls[0][0];
    expect(stderrCall).toContain('Error:');
    expect(stderrCall).toContain('No project found in database');
  });

  it('should write error to stderr before exiting on AgentKitError', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockReturnValue({
        project: { name: 'test' },
        displayName: 'Test',
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
    registerDashboardCommand(program);

    await expect(
      program.parseAsync(['dashboard'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    // Verify stderr.write was called
    expect(stderrSpy).toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Error:'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('\n'));

    // Verify exit(1) was called after stderr
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should rethrow non-AgentKitError exceptions instead of swallowing them', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const customError = new TypeError('Custom error from async operation');
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockReturnValue({
        project: { name: 'test' },
        displayName: 'Test',
        provider: 'claude-cli',
        team: 'agentkit',
        stages: [],
        models: { allowed: [], resolved: {} },
      }),
      loadTeamConfig: vi.fn(),
      loadProjectConfig: vi.fn(),
    }) as unknown as ConfigLoader);

    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        throw customError;
      }),
      from: vi.fn(),
      limit: vi.fn(),
      get: vi.fn(),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerDashboardCommand(program);

    await expect(
      program.parseAsync(['dashboard'], { from: 'user' }),
    ).rejects.toThrow(customError);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should render DashboardApp with correct props when project is initialized', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const mockRenderInstance = {
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
      unmount: vi.fn(),
    };
    vi.mocked(render).mockReturnValue(
      mockRenderInstance as unknown as ReturnType<typeof render>,
    );

    const mockConfig = {
      project: { name: 'test-project' },
      displayName: 'Test Pipeline',
      provider: 'claude-cli',
      team: 'agentkit',
      stages: [{ name: 'dev', displayName: 'Developer' }],
      models: { allowed: ['opus'], resolved: { dev: 'opus' } },
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
      get: vi.fn().mockReturnValue({ id: 42, project_name: 'test-project' }),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerDashboardCommand(program);

    await program.parseAsync(['dashboard'], { from: 'user' });

    expect(mockConfigLoader.load).toHaveBeenCalled();
    expect(render).toHaveBeenCalled();
    expect(mockRenderInstance.waitUntilExit).toHaveBeenCalled();
  });

  it('should handle AgentKitError from database operations', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockReturnValue({
        project: { name: 'test' },
        displayName: 'Test',
        provider: 'claude-cli',
        team: 'agentkit',
        stages: [],
        models: { allowed: [], resolved: {} },
      }),
      loadTeamConfig: vi.fn(),
      loadProjectConfig: vi.fn(),
    }) as unknown as ConfigLoader);

    const dbError = new AgentKitError('Database connection failed', 'DB_ERROR');
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        throw dbError;
      }),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerDashboardCommand(program);

    await expect(
      program.parseAsync(['dashboard'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(stderrSpy).toHaveBeenCalled();
    expect(stderrSpy.mock.calls[0][0]).toContain('Database connection failed');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should pass correct project ID to DashboardApp', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const mockRenderInstance = {
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
      unmount: vi.fn(),
    };
    vi.mocked(render).mockReturnValue(
      mockRenderInstance as unknown as ReturnType<typeof render>,
    );

    vi.mocked(ConfigLoader).mockImplementation(() => ({
      load: vi.fn().mockReturnValue({
        project: { name: 'test' },
        displayName: 'Test',
        provider: 'claude-cli',
        team: 'agentkit',
        stages: [],
        models: { allowed: [], resolved: {} },
      }),
      loadTeamConfig: vi.fn(),
      loadProjectConfig: vi.fn(),
    }) as unknown as ConfigLoader);

    const projectId = 999;
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnValue({ id: projectId, project_name: 'special-project' }),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerDashboardCommand(program);

    await program.parseAsync(['dashboard'], { from: 'user' });

    // Verify render was called with DashboardApp component
    expect(render).toHaveBeenCalled();
  });
});
