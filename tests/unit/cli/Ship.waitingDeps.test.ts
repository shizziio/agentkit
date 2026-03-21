/**
 * Story 21.6 — Ship CLI: Waiting Story Dep Visualization (AC4)
 *
 * Tests that after `agentkit ship --all` (or `--epic N`) ships stories, the
 * CLI prints a line for each story that ended up waiting due to unmet deps:
 *
 *   "  Story 21.4 → waiting (needs: 21.2 ✓, 21.3 ⏳)"
 *
 * Acceptance criteria (AC4):
 *   - Given ship --all ships stories and some remain waiting due to unmet deps
 *   - When CLI output
 *   - Then shows "Story 21.4 → waiting (needs: 21.2 ✓, 21.3 ⏳)" per blocked story
 *   - And done deps have ✓, pending deps have ⏳
 *
 * EXPECTED: Tests fail until Ship.ts is modified to print waiting-story section.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { registerShipCommand } from '../../../src/cli/Ship.js';

// ─── vi.hoisted: configurable mock data ──────────────────────────────────────

const { mockDbAll, mockDbGet } = vi.hoisted(() => ({
  // Returns waiting story rows for the post-ship follow-up query
  mockDbAll: vi.fn(
    () => [] as Array<{ id: number; storyKey: string; epicKey: string; dependsOn: string | null }>
  ),
  // Returns a project row (or null)
  mockDbGet: vi.fn(() => ({ id: 1 } as { id: number } | null)),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

// Mock DB: flexible chain — any .all() returns mockDbAll(), .get() returns mockDbGet().
// NOTE: this chain mirrors the Drizzle select().from().innerJoin().where().all() pattern
// used in the post-ship waiting-story query. If the implementation uses a different
// chain shape (e.g., additional .where() calls), adjust this mock accordingly.
vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(() => {
    const terminal = {
      all: () => mockDbAll(),
      get: () => mockDbGet(),
    };
    // withWhere → final terminal (handles multiple .where() chaining)
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

vi.mock('@core/ConfigLoader.js', () => ({
  ConfigLoader: vi.fn().mockImplementation(() => ({
    load: vi.fn(() => ({ team: 'agentkit', stages: [{ name: 'sm' }] })),
  })),
}));

// ShipService mock — controls getStories + shipStories return values
const mockGetStories = vi.fn(() => [
  { id: 1, status: 'draft', hasExistingTasks: false },
]);
const mockShipStories = vi.fn(() => ({
  shippedCount: 1,
  waitingCount: 0,
  waitingStories: [] as Array<{ storyKey: string; unmetDeps: string[] }>,
}));

vi.mock('@core/ShipService.js', () => ({
  ShipService: vi.fn().mockImplementation(() => ({
    getStories: mockGetStories,
    shipStories: mockShipStories,
  })),
}));

// DependencyDisplay mock — controls formatDepList output
vi.mock('@core/DependencyDisplay.js', () => ({
  resolveDepStatuses: vi.fn(() => [
    { key: '21.2', status: 'done' },
    { key: '21.3', status: 'waiting' },
  ]),
  formatDepList: vi.fn(() => '21.2 ✓, 21.3 ⏳'),
}));

// ShipWizard is not needed for --all or --epic branches
vi.mock('@ui/ship/ShipWizard.js', () => ({
  ShipWizard: vi.fn(),
}));

// ink render only used for interactive mode; mock to avoid TTY setup
vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
    unmount: vi.fn(),
    cleanup: vi.fn(),
    rerender: vi.fn(),
    clear: vi.fn(),
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildShipProgram(): Command {
  const program = new Command('agentkit');
  registerShipCommand(program);
  return program;
}

type WaitingStoryRow = { id: number; storyKey: string; epicKey: string; dependsOn: string | null };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Ship CLI — waiting story dep visualization (AC4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    mockDbGet.mockReturnValue({ id: 1 });
    mockDbAll.mockReturnValue([]);
    mockGetStories.mockReturnValue([
      { id: 1, status: 'draft', hasExistingTasks: false },
    ]);
    mockShipStories.mockReturnValue({
      shippedCount: 1,
      waitingCount: 0,
      waitingStories: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Baseline: ship --all output still works ───────────────────────────────

  it('should print ship success message when --all ships stories', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildShipProgram();
    await program.parseAsync(['ship', '--all'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Shipped 1');

    consoleSpy.mockRestore();
  });

  // ── AC4: waiting section omitted when no waiting stories ─────────────────

  it('should NOT print waiting section when ship --all produces no waiting stories', async () => {
    mockShipStories.mockReturnValue({ shippedCount: 1, waitingCount: 0, waitingStories: [] });
    mockDbAll.mockReturnValue([]); // no waiting stories from follow-up query

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildShipProgram();
    await program.parseAsync(['ship', '--all'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).not.toContain('waiting (needs:');

    consoleSpy.mockRestore();
  });

  // ── AC4: waiting section appears with correct format ─────────────────────

  it('should print "Story X → waiting (needs: ...)" line after --all when waiting stories exist', async () => {
    mockShipStories.mockReturnValue({
      shippedCount: 1,
      waitingCount: 1,
      waitingStories: [{ storyKey: '21.4', unmetDeps: ['21.2', '21.3'] }],
    });
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2', '21.3']) },
    ] as WaitingStoryRow[]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildShipProgram();
    await program.parseAsync(['ship', '--all'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    // AC4 format: "Story 21.4 → waiting (needs: 21.2 ✓, 21.3 ⏳)"
    expect(output).toContain('21.4');
    expect(output).toContain('waiting');
    expect(output).toContain('21.2 ✓, 21.3 ⏳');

    consoleSpy.mockRestore();
  });

  it('should include "→" separator between story key and waiting reason', async () => {
    mockShipStories.mockReturnValue({
      shippedCount: 1,
      waitingCount: 1,
      waitingStories: [{ storyKey: '21.4', unmetDeps: ['21.2'] }],
    });
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2']) },
    ] as WaitingStoryRow[]);

    const { formatDepList } = await import('@core/DependencyDisplay.js');
    // Use mockReturnValueOnce so this setting does not pollute subsequent tests
    vi.mocked(formatDepList).mockReturnValueOnce('21.2 ✓');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildShipProgram();
    await program.parseAsync(['ship', '--all'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toMatch(/→|waiting.*needs/);

    consoleSpy.mockRestore();
  });

  it('should print a line for EACH waiting story when multiple exist', async () => {
    mockGetStories.mockReturnValue([
      { id: 1, status: 'draft', hasExistingTasks: false },
      { id: 2, status: 'draft', hasExistingTasks: false },
      { id: 3, status: 'draft', hasExistingTasks: false },
    ]);
    mockShipStories.mockReturnValue({
      shippedCount: 1,
      waitingCount: 2,
      waitingStories: [
        { storyKey: '21.4', unmetDeps: ['21.2'] },
        { storyKey: '21.5', unmetDeps: ['21.3'] },
      ],
    });
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2']) },
      { id: 6, storyKey: '5', epicKey: '21', dependsOn: JSON.stringify(['21.3']) },
    ] as WaitingStoryRow[]);

    const { formatDepList } = await import('@core/DependencyDisplay.js');
    vi.mocked(formatDepList)
      .mockReturnValueOnce('21.2 ✓')
      .mockReturnValueOnce('21.3 ⏳');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildShipProgram();
    await program.parseAsync(['ship', '--all'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('21.4');
    expect(output).toContain('21.5');
    expect(output).toContain('21.2 ✓');
    expect(output).toContain('21.3 ⏳');

    consoleSpy.mockRestore();
  });

  // AC4: done deps → ✓ icon in output

  it('should show ✓ for done deps in the waiting output', async () => {
    mockShipStories.mockReturnValue({
      shippedCount: 1,
      waitingCount: 1,
      waitingStories: [{ storyKey: '21.4', unmetDeps: [] }],
    });
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2']) },
    ] as WaitingStoryRow[]);

    const { resolveDepStatuses, formatDepList } = await import('@core/DependencyDisplay.js');
    vi.mocked(resolveDepStatuses).mockReturnValueOnce([{ key: '21.2', status: 'done' }]);
    // Use mockReturnValueOnce so this setting does not pollute subsequent tests
    vi.mocked(formatDepList).mockReturnValueOnce('21.2 ✓');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildShipProgram();
    await program.parseAsync(['ship', '--all'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('✓');

    consoleSpy.mockRestore();
  });

  // AC4: pending deps → ⏳ icon in output

  it('should show ⏳ for pending deps in the waiting output', async () => {
    mockShipStories.mockReturnValue({
      shippedCount: 1,
      waitingCount: 1,
      waitingStories: [{ storyKey: '21.4', unmetDeps: ['21.3'] }],
    });
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.3']) },
    ] as WaitingStoryRow[]);

    const { resolveDepStatuses, formatDepList } = await import('@core/DependencyDisplay.js');
    vi.mocked(resolveDepStatuses).mockReturnValueOnce([{ key: '21.3', status: 'waiting' }]);
    // Use mockReturnValueOnce so this setting does not pollute subsequent tests
    vi.mocked(formatDepList).mockReturnValueOnce('21.3 ⏳');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildShipProgram();
    await program.parseAsync(['ship', '--all'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('⏳');

    consoleSpy.mockRestore();
  });

  // ── AC4: --epic N branch also shows waiting section ──────────────────────

  it('should print waiting section after --epic N when waiting stories exist', async () => {
    // mock epic row lookup
    mockDbGet
      .mockReturnValueOnce({ id: 1 })   // project lookup
      .mockReturnValueOnce({ id: 10 }); // epic lookup

    mockGetStories.mockReturnValue([
      { id: 2, status: 'draft', hasExistingTasks: false },
    ]);
    mockShipStories.mockReturnValue({
      shippedCount: 1,
      waitingCount: 1,
      waitingStories: [{ storyKey: '21.4', unmetDeps: ['21.2'] }],
    });
    mockDbAll.mockReturnValue([
      { id: 5, storyKey: '4', epicKey: '21', dependsOn: JSON.stringify(['21.2']) },
    ] as WaitingStoryRow[]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildShipProgram();
    await program.parseAsync(['ship', '--epic', '21'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('21.4');
    expect(output).toContain('waiting');
    expect(output).toContain('21.2 ✓, 21.3 ⏳'); // from formatDepList mock

    consoleSpy.mockRestore();
  });

  // ── Edge: 0 eligible stories → no waiting section ────────────────────────

  it('should print "0 stories to ship." and no waiting section when no eligible stories', async () => {
    mockGetStories.mockReturnValue([]); // no eligible

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0');
    });

    const program = buildShipProgram();
    await expect(
      program.parseAsync(['ship', '--all'], { from: 'user' })
    ).rejects.toThrow('exit 0');

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('0 stories to ship');
    expect(output).not.toContain('waiting (needs:');

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── Edge: requireInitialized check unchanged ──────────────────────────────

  it('should exit 1 if not initialized (requireInitialized guard unchanged)', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1');
    });

    const program = buildShipProgram();
    await expect(
      program.parseAsync(['ship', '--all'], { from: 'user' })
    ).rejects.toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
