/**
 * Story 21.6 — Status CLI: Dependency Visualization
 *
 * Tests that `agentkit status` includes:
 *   - 'waiting' count in the Stories: line (AC3)
 *   - A "Waiting:" section listing each waiting story with dep statuses (AC3)
 *   - Format: "  21.4 → needs: 21.2 ✓, 21.3 ⏳"
 *   - No "Waiting:" section when there are no waiting stories (edge case)
 *   - Multiple waiting stories each get their own dep line (AC3)
 *
 * EXPECTED: Tests fail until:
 *   - Status.ts adds 'waiting' to knownStatuses and prints Waiting: section
 *   - DependencyDisplay.ts is created and imported by Status.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { registerStatusCommand } from '../../../src/cli/Status.js';

// ─── vi.hoisted: configurable mock data ──────────────────────────────────────

const { mockDbAll, mockDbGet } = vi.hoisted(() => ({
  mockDbAll: vi.fn(() => [] as Array<{ id: number; storyKey: string; epicKey: string; dependsOn: string | null }>),
  mockDbGet: vi.fn(() => ({ id: 1 } as { id: number } | null)),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

// Mock DB with a flexible chainable select builder.
// Any terminal .all() call returns mockDbAll(), and .get() returns mockDbGet().
// STRUCTURAL ASSUMPTION: the Status.ts waiting-story query follows the pattern:
//   db.select({...}).from(stories).innerJoin(epics, ...).where(...).all()
// If the implementation changes the chain shape (extra joins, different order,
// or wraps via StateManager), this mock needs to be updated to match.
vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(() => {
    const terminal = {
      all: () => mockDbAll(),
      get: () => mockDbGet(),
    };
    // withWhere also re-exposes where() so multiple .where() calls are handled
    const withWhere: Record<string, unknown> = {
      ...terminal,
      where: () => withWhere,
      and: () => withWhere,
    };
    const withInnerJoin = { ...withWhere, innerJoin: () => withWhere };
    const withFrom = {
      ...withInnerJoin,
      from: () => withInnerJoin,
      limit: () => ({ get: () => ({ id: 1 }) }),
    };
    return { select: () => withFrom };
  }),
}));

vi.mock('@core/StateManager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    getStoryCountsByStatus: vi.fn(() => ({ draft: 2, done: 3, waiting: 1 })),
    getQueueDepthByStage: vi.fn(() => ({ sm: 1 })),
    getRunningTasksByStage: vi.fn(() => ({})),
  })),
}));

// Mock DependencyDisplay — the new module created in Story 21.6
vi.mock('@core/DependencyDisplay.js', () => ({
  resolveDepStatuses: vi.fn(() => [
    { key: '21.2', status: 'done' },
    { key: '21.3', status: 'waiting' },
  ]),
  formatDepList: vi.fn(() => '21.2 ✓, 21.3 ⏳'),
}));

vi.mock('@core/ConfigLoader.js', () => ({
  ConfigLoader: vi.fn().mockImplementation(() => ({
    load: vi.fn(() => ({ team: 'agentkit', stages: [{ name: 'sm' }] })),
  })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildStatusProgram(): Command {
  const program = new Command('agentkit');
  registerStatusCommand(program);
  return program;
}

type WaitingStoryRow = { id: number; storyKey: string; epicKey: string; dependsOn: string | null };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Status CLI — dependency visualization (AC3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no waiting stories
    mockDbAll.mockReturnValue([]);
    mockDbGet.mockReturnValue({ id: 1 });
    vi.mocked(existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── AC3: Stories: line includes waiting count ─────────────────────────────

  it('should include "waiting=1" in the Stories: line when one waiting story exists', async () => {
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2', '21.3']) },
    ] as WaitingStoryRow[]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow('exit 0');

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(output).toContain('waiting=1');

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should include "waiting=N" count even when N > 1', async () => {
    // Seed the StateManager to return waiting=3
    const { StateManager } = await import('@core/StateManager.js');
    vi.mocked(StateManager).mockImplementationOnce(() => ({
      getStoryCountsByStatus: vi.fn(() => ({ draft: 1, done: 2, waiting: 3 })),
      getQueueDepthByStage: vi.fn(() => ({})),
      getRunningTasksByStage: vi.fn(() => ({})),
    }) as unknown as import('@core/StateManager').StateManager);

    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2']) },
      { id: 6, storyKey: '5', epicKey: '21', dependsOn: JSON.stringify(['21.3']) },
      { id: 7, storyKey: '6', epicKey: '21', dependsOn: null },
    ] as WaitingStoryRow[]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow('exit 0');

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(output).toContain('waiting=3');

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── AC3: "Waiting:" section header ────────────────────────────────────────

  it('should print a "Waiting:" section header when waiting stories exist', async () => {
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2', '21.3']) },
    ] as WaitingStoryRow[]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow('exit 0');

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(output).toContain('Waiting:');

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── AC3: Dep status line format ──────────────────────────────────────────

  it('should format waiting story line containing story key and dep statuses', async () => {
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2', '21.3']) },
    ] as WaitingStoryRow[]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow('exit 0');

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
    // Story key should appear in output
    expect(output).toContain('21.4');
    // Arrow separator (→ or ->) indicating waiting reason
    expect(output).toMatch(/→|needs:/);
    // Formatted dep list from formatDepList mock
    expect(output).toContain('21.2 ✓, 21.3 ⏳');

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should call resolveDepStatuses with the story dependsOn JSON and projectId', async () => {
    const depJson = JSON.stringify(['21.2', '21.3']);
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: depJson },
    ] as WaitingStoryRow[]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow('exit 0');

    const { resolveDepStatuses } = await import('@core/DependencyDisplay.js');
    expect(vi.mocked(resolveDepStatuses)).toHaveBeenCalledWith(
      expect.anything(),   // db
      depJson,             // dependsOnJson
      expect.any(Number)   // projectId
    );

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should call formatDepList with resolved dep statuses', async () => {
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2']) },
    ] as WaitingStoryRow[]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow('exit 0');

    const { formatDepList } = await import('@core/DependencyDisplay.js');
    expect(vi.mocked(formatDepList)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: expect.any(String), status: expect.any(String) }),
      ])
    );

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── Edge: No "Waiting:" section when no waiting stories ──────────────────

  it('should NOT print "Waiting:" section when no waiting stories exist', async () => {
    const { StateManager } = await import('@core/StateManager.js');
    vi.mocked(StateManager).mockImplementationOnce(() => ({
      getStoryCountsByStatus: vi.fn(() => ({ draft: 2, done: 3 })), // no waiting
      getQueueDepthByStage: vi.fn(() => ({ sm: 1 })),
      getRunningTasksByStage: vi.fn(() => ({})),
      getPipelineStatus: vi.fn(),
      getStoryProgress: vi.fn(),
      getTaskChain: vi.fn(),
      getStatistics: vi.fn(),
    }) as unknown as import('@core/StateManager').StateManager);

    // DB returns no waiting stories
    mockDbAll.mockReturnValue([]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow('exit 0');

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(output).not.toContain('Waiting:');

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── Edge: Waiting story with null dependsOn ───────────────────────────────

  it('should handle waiting story with null dependsOn without crashing', async () => {
    mockDbAll.mockReturnValue([
      { id: 6, storyKey: '5', epicKey: '21', dependsOn: null },
    ] as WaitingStoryRow[]);

    // resolveDepStatuses returns [] for null input
    const { resolveDepStatuses, formatDepList } = await import('@core/DependencyDisplay.js');
    vi.mocked(resolveDepStatuses).mockReturnValueOnce([]);
    vi.mocked(formatDepList).mockReturnValueOnce('');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    // Should not throw — just exit 0
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow();

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── Multiple waiting stories → each gets a dep line ──────────────────────

  it('should print a dep line for each of multiple waiting stories', async () => {
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2']) },
      { id: 6, storyKey: '5', epicKey: '21', dependsOn: JSON.stringify(['21.3']) },
    ] as WaitingStoryRow[]);

    const { resolveDepStatuses, formatDepList } = await import('@core/DependencyDisplay.js');
    vi.mocked(resolveDepStatuses)
      .mockReturnValueOnce([{ key: '21.2', status: 'done' }])
      .mockReturnValueOnce([{ key: '21.3', status: 'waiting' }]);
    vi.mocked(formatDepList)
      .mockReturnValueOnce('21.2 ✓')
      .mockReturnValueOnce('21.3 ⏳');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow('exit 0');

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
    // Both story keys appear in output
    expect(output).toContain('21.4');
    expect(output).toContain('21.5');
    // Both dep formatted strings appear
    expect(output).toContain('21.2 ✓');
    expect(output).toContain('21.3 ⏳');

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── Regression: existing Stories:/Queue:/Workers: lines still present ─────

  it('should still print Stories:, Queue:, Workers: lines alongside Waiting: section', async () => {
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2']) },
    ] as WaitingStoryRow[]);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow('exit 0');

    const output = stdoutSpy.mock.calls.map((c) => c[0] as string).join('');
    expect(output).toContain('Stories:');
    expect(output).toContain('Queue:');
    expect(output).toContain('Workers:');
    expect(output).toContain('Waiting:');

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── Regression: not-initialized still exits 1 ────────────────────────────

  it('should still exit 1 if not initialized (requireInitialized check unchanged)', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  // ── Edge: Waiting story with malformed dependsOn JSON ────────────────────

  it('should not crash when waiting story has malformed dependsOn JSON', async () => {
    mockDbAll.mockReturnValue([
      { id: 7, storyKey: '6', epicKey: '21', dependsOn: '[invalid json' },
    ] as WaitingStoryRow[]);

    // DependencyDisplay handles malformed JSON internally and returns []
    const { resolveDepStatuses, formatDepList } = await import('@core/DependencyDisplay.js');
    vi.mocked(resolveDepStatuses).mockReturnValueOnce([]);
    vi.mocked(formatDepList).mockReturnValueOnce('');

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildStatusProgram();
    await expect(program.parseAsync(['status'], { from: 'user' })).rejects.toThrow();

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
