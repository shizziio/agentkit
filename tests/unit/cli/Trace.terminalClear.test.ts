import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { openDatabase } from '@core/db/Connection';
import { registerTraceCommand } from '../../../src/cli/Trace.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(),
}));

vi.mock('@core/db/schema.js', () => ({
  projects: { id: 'projects_id_field' },
}));

vi.mock('@core/Logger.js', () => ({
  Logger: {
    getOrNoop: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
  },
}));

vi.mock('@core/TraceService.js', () => ({
  TraceService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@ui/trace/TraceWizard.js', () => ({
  TraceWizard: vi.fn(),
}));

vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
    unmount: vi.fn(),
  }),
}));

function makeDb(project: { id: number } | null) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnValue(project),
  };
}

function buildProgram(): Command {
  const program = new Command('agentkit');
  registerTraceCommand(program);
  return program;
}

describe('Trace command — terminal clear (story 11.7)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(openDatabase).mockReturnValue(
      makeDb({ id: 42 }) as unknown as ReturnType<typeof openDatabase>,
    );
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error('process.exit called');
    });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('writes \\x1Bc before render() when TTY=true', async () => {
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

    const program = buildProgram();
    await program.parseAsync(['trace'], { from: 'user' });

    expect(callOrder).toContain('stdout.write(\\x1Bc)');
    expect(callOrder).toContain('render()');
    expect(callOrder.indexOf('stdout.write(\\x1Bc)')).toBeLessThan(callOrder.indexOf('render()'));
  });

  it('does NOT write \\x1Bc when TTY=false', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const program = buildProgram();
    await program.parseAsync(['trace'], { from: 'user' });

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });

  it('does NOT write \\x1Bc when project not found in DB (throws before render)', async () => {
    vi.mocked(openDatabase).mockReturnValue(
      makeDb(null) as unknown as ReturnType<typeof openDatabase>,
    );

    await expect(
      buildProgram().parseAsync(['trace'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');

    const calls = stdoutSpy.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('\x1Bc');
  });
});
