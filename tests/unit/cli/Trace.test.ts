import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { openDatabase } from '@core/db/Connection';
import { projects } from '@core/db/schema';
import { AgentKitError } from '@core/Errors';
import { render } from 'ink';
import { registerTraceCommand } from '../../../src/cli/Trace.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

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

vi.mock('@ui/trace/TraceWizard.js', () => ({
  TraceWizard: vi.fn(),
}));

vi.mock('@core/Errors.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/Errors.js')>();
  return actual;
});

vi.mock('@core/TraceService.js', () => ({
  TraceService: vi.fn().mockImplementation(() => ({})),
}));

describe('registerTraceCommand', () => {
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

  it('should register trace command on the program', () => {
    const program = new Command();
    registerTraceCommand(program);

    const traceCmd = program.commands.find((cmd) => cmd.name() === 'trace');
    expect(traceCmd).toBeDefined();
    expect(traceCmd!.description()).toBe('Browse pipeline execution history in an interactive tree view');
  });

  it('should call requireInitialized and exit if agentkit dir missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const program = new Command();
    registerTraceCommand(program);

    await expect(
      program.parseAsync(['trace'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should throw AgentKitError with PROJECT_NOT_FOUND when no project found', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

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
    registerTraceCommand(program);

    await expect(
      program.parseAsync(['trace'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalled();
    const stderrCall = stderrSpy.mock.calls[0][0];
    expect(stderrCall).toContain('Error:');
    expect(stderrCall).toContain('No project found in database');
  });

  it('should use SELECT with only id field per architecture rules', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

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
    registerTraceCommand(program);

    await program.parseAsync(['trace'], { from: 'user' });

    expect(mockDb.select).toHaveBeenCalledWith({ id: projects.id });
    expect(mockDb.from).toHaveBeenCalledWith(projects);
    expect(mockDb.limit).toHaveBeenCalledWith(1);
  });

  it('should render TraceWizard when project is found', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const mockRenderInstance = {
      waitUntilExit: vi.fn().mockResolvedValue(undefined),
      unmount: vi.fn(),
    };
    vi.mocked(render).mockReturnValue(
      mockRenderInstance as unknown as ReturnType<typeof render>,
    );

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnValue({ id: 42 }),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerTraceCommand(program);

    await program.parseAsync(['trace'], { from: 'user' });

    expect(render).toHaveBeenCalled();
    expect(mockRenderInstance.waitUntilExit).toHaveBeenCalled();
  });

  it('should rethrow non-AgentKitError exceptions', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const customError = new TypeError('Custom error');

    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        throw customError;
      }),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerTraceCommand(program);

    await expect(
      program.parseAsync(['trace'], { from: 'user' }),
    ).rejects.toThrow(customError);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should write AgentKitError to stderr before exiting', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const dbError = new AgentKitError('DB connection failed', 'DB_ERROR');

    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        throw dbError;
      }),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerTraceCommand(program);

    await expect(
      program.parseAsync(['trace'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    expect(stderrSpy).toHaveBeenCalled();
    expect(stderrSpy.mock.calls[0][0]).toContain('DB connection failed');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
