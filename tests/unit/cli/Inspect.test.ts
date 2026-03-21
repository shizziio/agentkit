import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerInspectCommand } from '@cli/Inspect';

const { mockGetTaskInspect } = vi.hoisted(() => ({
  mockGetTaskInspect: vi.fn(),
}));

vi.mock('@cli/RequireInitialized.js', () => ({
  requireInitialized: vi.fn(),
}));

vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(() => ({})),
}));

vi.mock('@core/db/RunMigrations.js', () => ({
  runMigrations: vi.fn(),
}));

vi.mock('@core/InspectService.js', () => ({
  InspectService: vi.fn().mockImplementation(() => ({
    getTaskInspect: mockGetTaskInspect,
  })),
}));

vi.mock('ink', () => ({
  render: vi.fn(() => ({ app: { waitUntilExit: vi.fn().mockResolvedValue(undefined) }, unmount: vi.fn() })),
}));

const mockSampleData = {
  task: { id: 42, stageName: 'dev', status: 'done', workerModel: null, attempt: 1, maxAttempts: 3, durationMs: 1000, startedAt: null, completedAt: null, inputTokens: null, outputTokens: null, prompt: 'do work', input: '{"x":1}', output: '{"result":"ok"}' },
  story: { id: 1, storyKey: 'S1.1', title: 'My Story', status: 'in_progress' },
  epic: { id: 1, epicKey: 'E1', title: 'My Epic' },
  ancestors: [],
  children: [],
  eventLog: [],
  chainTruncated: false,
};

describe('registerInspectCommand', () => {
  let program: Command;

  beforeEach(() => {
    mockGetTaskInspect.mockReset();
    mockGetTaskInspect.mockReturnValue(mockSampleData);
    program = new Command();
    program.exitOverride();
    registerInspectCommand(program);
  });

  it('registers the inspect command', () => {
    const cmd = program.commands.find((c) => c.name() === 'inspect');
    expect(cmd).toBeDefined();
  });

  it('has <taskId> argument', () => {
    const cmd = program.commands.find((c) => c.name() === 'inspect')!;
    const args = cmd.registeredArguments;
    expect(args.length).toBeGreaterThan(0);
    expect(args[0].name()).toBe('taskId');
  });

  it('has --json option', () => {
    const cmd = program.commands.find((c) => c.name() === 'inspect')!;
    const opt = cmd.options.find((o) => o.long === '--json');
    expect(opt).toBeDefined();
  });

  it('has --output-only option', () => {
    const cmd = program.commands.find((c) => c.name() === 'inspect')!;
    const opt = cmd.options.find((o) => o.long === '--output-only');
    expect(opt).toBeDefined();
  });

  it('has --input-only option', () => {
    const cmd = program.commands.find((c) => c.name() === 'inspect')!;
    const opt = cmd.options.find((o) => o.long === '--input-only');
    expect(opt).toBeDefined();
  });

  it('has --prompt-only option', () => {
    const cmd = program.commands.find((c) => c.name() === 'inspect')!;
    const opt = cmd.options.find((o) => o.long === '--prompt-only');
    expect(opt).toBeDefined();
  });

  it('requireInitialized is imported from RequireInitialized', async () => {
    const { requireInitialized } = await import('@cli/RequireInitialized.js');
    expect(requireInitialized).toBeDefined();
  });

  describe('action behavior', () => {
    it('exits with error when taskId is NaN', async () => {
      const stderrOutput: string[] = [];
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => { stderrOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', 'abc']);
      } catch {
        // expected
      }

      expect(stderrOutput.join('')).toContain('taskId must be a valid integer');
      expect(exitCalls).toContain(1);

      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('writes JSON to stdout and exits 0 when --json flag is set', async () => {
      const stdoutOutput: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdoutOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '42', '--json']);
      } catch {
        // expected
      }

      const allOut = stdoutOutput.join('');
      expect(allOut.length).toBeGreaterThan(0);
      const parsed = JSON.parse(allOut);
      expect(parsed.task.id).toBe(42);
      expect(exitCalls).toContain(0);

      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('writes plain-text summary when stdout is not a TTY', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      const stdoutOutput: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdoutOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '42']);
      } catch {
        // expected
      }

      const allOut = stdoutOutput.join('');
      expect(allOut).toContain('Task #42');
      expect(allOut).toContain('S1.1');
      expect(exitCalls).toContain(0);

      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('writes error to stderr and exits 1 when InspectService throws', async () => {
      mockGetTaskInspect.mockImplementationOnce(() => { throw new Error('Task 999 not found'); });

      const stderrOutput: string[] = [];
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => { stderrOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '999']);
      } catch {
        // expected
      }

      expect(stderrOutput.join('')).toContain('Task 999 not found');
      expect(exitCalls).toContain(1);

      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('outputs task output as JSON when --output-only flag is set with valid JSON', async () => {
      const stdoutOutput: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdoutOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '42', '--output-only']);
      } catch {
        // expected
      }

      const allOut = stdoutOutput.join('');
      const parsed = JSON.parse(allOut);
      expect(parsed.result).toBe('ok');
      expect(exitCalls).toContain(0);

      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('outputs task input as JSON when --input-only flag is set', async () => {
      const stdoutOutput: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdoutOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '42', '--input-only']);
      } catch {
        // expected
      }

      const allOut = stdoutOutput.join('');
      const parsed = JSON.parse(allOut);
      expect(parsed.x).toBe(1);
      expect(exitCalls).toContain(0);

      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('outputs task prompt when --prompt-only flag is set', async () => {
      const stdoutOutput: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdoutOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '42', '--prompt-only']);
      } catch {
        // expected
      }

      const allOut = stdoutOutput.join('');
      expect(allOut).toContain('do work');
      expect(exitCalls).toContain(0);

      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('outputs (none) when --output-only flag is set but output is null', async () => {
      mockGetTaskInspect.mockReturnValueOnce({
        ...mockSampleData,
        task: { ...mockSampleData.task, output: null },
      });

      const stdoutOutput: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdoutOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '42', '--output-only']);
      } catch {
        // expected
      }

      const allOut = stdoutOutput.join('');
      expect(allOut).toContain('(none)');
      expect(exitCalls).toContain(0);

      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('outputs (none) when --prompt-only flag is set but prompt is null', async () => {
      mockGetTaskInspect.mockReturnValueOnce({
        ...mockSampleData,
        task: { ...mockSampleData.task, prompt: null },
      });

      const stdoutOutput: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdoutOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '42', '--prompt-only']);
      } catch {
        // expected
      }

      const allOut = stdoutOutput.join('');
      expect(allOut).toContain('(none)');
      expect(exitCalls).toContain(0);

      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('respects --json flag priority over --output-only', async () => {
      const stdoutOutput: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdoutOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '42', '--json', '--output-only']);
      } catch {
        // expected
      }

      const allOut = stdoutOutput.join('');
      const parsed = JSON.parse(allOut);
      expect(parsed.task.id).toBe(42);
      expect(exitCalls).toContain(0);

      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('outputs plain text for malformed JSON output when --output-only is set', async () => {
      mockGetTaskInspect.mockReturnValueOnce({
        ...mockSampleData,
        task: { ...mockSampleData.task, output: 'not valid json' },
      });

      const stdoutOutput: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => { stdoutOutput.push(String(s)); return true; });
      const exitCalls: (string | number | null | undefined)[] = [];
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalls.push(code);
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'agentkit', 'inspect', '42', '--output-only']);
      } catch {
        // expected
      }

      const allOut = stdoutOutput.join('');
      expect(allOut).toContain('not valid json');
      expect(exitCalls).toContain(0);

      stdoutSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});
