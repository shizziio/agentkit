import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { ConfigLoader } from '@core/ConfigLoader';
import { openDatabase } from '@core/db/Connection';
import { registerStartCommand } from '../../../src/cli/Start.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('@core/ConfigLoader.js', () => ({ ConfigLoader: vi.fn() }));
vi.mock('@core/db/Connection.js', () => ({ openDatabase: vi.fn() }));
vi.mock('@core/db/schema.js', () => ({ projects: {}, stories: {} }));
vi.mock('@core/EventBus.js', () => ({
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));
vi.mock('@core/Logger.js', () => ({
  Logger: {
    init: vi.fn(),
    get: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
    getOrNoop: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
    getLogger: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
  },
}));
vi.mock('../../../src/cli/WorkerToggle.js', () => ({
  WorkerToggle: vi.fn().mockImplementation(() => ({ toggle: vi.fn() })),
}));
vi.mock('@ui/UnifiedApp.js', () => ({ UnifiedApp: vi.fn() }));
vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
    unmount: vi.fn(),
  }),
}));

function makeSuccessConfig() {
  return {
    project: { name: 'test-project', owner: 'me' },
    displayName: 'Software Development Pipeline',
    provider: 'claude-cli',
    team: 'agentkit',
    stages: [],
    models: { allowed: [], resolved: {} },
  };
}

function makeSuccessDb() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnValue({ id: 42 }),
    all: vi.fn().mockReturnValue([]),
  };
}

describe('Start command — terminal clear (story 9.5)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('process.exit called');
    });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('writes \\x1Bc to stdout before render() on successful startup', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(
      () => ({ load: vi.fn().mockReturnValue(makeSuccessConfig()) }) as unknown as ConfigLoader,
    );
    vi.mocked(openDatabase).mockReturnValue(
      makeSuccessDb() as unknown as ReturnType<typeof openDatabase>,
    );

    const { render } = await import('ink');
    const renderMock = vi.mocked(render);
    const callOrder: string[] = [];

    stdoutSpy.mockImplementation((chunk) => {
      if (chunk === '\x1Bc') callOrder.push('stdout.write(\\x1Bc)');
      return true;
    });
    renderMock.mockImplementation(() => {
      callOrder.push('render()');
      return { waitUntilExit: vi.fn().mockResolvedValue(undefined), unmount: vi.fn() } as unknown as ReturnType<typeof render>;
    });

    const program = new Command();
    registerStartCommand(program);
    await program.parseAsync(['node', 'agentkit', 'start'], { from: 'node' });

    expect(callOrder).toContain('stdout.write(\\x1Bc)');
    expect(callOrder).toContain('render()');
    // clear must happen before render
    expect(callOrder.indexOf('stdout.write(\\x1Bc)')).toBeLessThan(callOrder.indexOf('render()'));
  });

  it('writes \\x1Bc with the exact escape sequence \\x1Bc', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(
      () => ({ load: vi.fn().mockReturnValue(makeSuccessConfig()) }) as unknown as ConfigLoader,
    );
    vi.mocked(openDatabase).mockReturnValue(
      makeSuccessDb() as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerStartCommand(program);
    await program.parseAsync(['node', 'agentkit', 'start'], { from: 'node' });

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain('\x1Bc');
  });

  it('does NOT write \\x1Bc when config loading fails (error before render)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(
      () => ({
        load: vi.fn().mockImplementation(() => { throw new Error('Config error'); }),
      }) as unknown as ConfigLoader,
    );

    const program = new Command();
    registerStartCommand(program);

    await expect(
      program.parseAsync(['node', 'agentkit', 'start'], { from: 'node' }),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });

  it('does NOT write \\x1Bc when no project is found in DB (error before render)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(ConfigLoader).mockImplementation(
      () => ({ load: vi.fn().mockReturnValue(makeSuccessConfig()) }) as unknown as ConfigLoader,
    );
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
    };
    vi.mocked(openDatabase).mockReturnValue(
      mockDb as unknown as ReturnType<typeof openDatabase>,
    );

    const program = new Command();
    registerStartCommand(program);

    await expect(
      program.parseAsync(['node', 'agentkit', 'start'], { from: 'node' }),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });

  it('does NOT write \\x1Bc when not initialized (requireInitialized fails)', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const program = new Command();
    registerStartCommand(program);

    await expect(
      program.parseAsync(['node', 'agentkit', 'start'], { from: 'node' }),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });
});
