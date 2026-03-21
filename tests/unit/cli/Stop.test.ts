import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(),
}));

vi.mock('@core/db/schema.js', () => ({
  tasks: { id: 'id', status: 'status' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  sql: Object.assign(vi.fn().mockReturnValue({ mapWith: vi.fn().mockReturnValue({}) }), {
    mapWith: vi.fn(),
  }),
}));

vi.mock('@config/defaults.js', () => ({
  AGENTKIT_DIR: '_agent_kit',
  DB_FILENAME: 'agentkit.db',
}));

vi.mock('./RequireInitialized.js', () => ({
  requireInitialized: vi.fn(),
}));

vi.mock('@core/Errors.js', () => ({
  AgentKitError: class AgentKitError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.code = code; }
  },
}));

import { openDatabase } from '@core/db/Connection.js';
import { registerStopCommand } from '../../../src/cli/Stop.js';
import { Command } from 'commander';

describe('registerStopCommand', () => {
  let program: Command;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride(); // prevent process.exit in tests
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    registerStopCommand(program);
  });

  it('registers stop command', () => {
    const stopCmd = program.commands.find((c) => c.name() === 'stop');
    expect(stopCmd).toBeDefined();
    expect(stopCmd?.description()).toBe('Stop running pipeline workers');
  });

  it('outputs "Khong co workers" when count is 0', () => {
    const getMock = vi.fn().mockReturnValue({ count: 0 });
    const whereMock = vi.fn().mockReturnValue({ get: getMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    const selectMock = vi.fn().mockReturnValue({ from: fromMock });
    vi.mocked(openDatabase).mockReturnValue({ select: selectMock } as never);

    program.parse(['stop'], { from: 'user' });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Khong co workers nao dang chay'));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('outputs workers running message when count > 0', () => {
    const getMock = vi.fn().mockReturnValue({ count: 2 });
    const whereMock = vi.fn().mockReturnValue({ get: getMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    const selectMock = vi.fn().mockReturnValue({ from: fromMock });
    vi.mocked(openDatabase).mockReturnValue({ select: selectMock } as never);

    program.parse(['stop'], { from: 'user' });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('dang chay'));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
