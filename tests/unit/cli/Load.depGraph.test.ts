/**
 * Story 21.6 — Load CLI: Dependency Graph Summary (AC5)
 *
 * Tests that after `agentkit load` completes successfully (LoadWizard exits),
 * the CLI prints a dep-graph summary line:
 *
 *   "Dependency graph: 6 stories, 5 edges, 0 cycles"
 *
 * Acceptance criteria (AC5):
 *   - Given `agentkit load` with an epic that has stories with depends_on
 *   - When load completes successfully
 *   - Then CLI prints "Dependency graph: N stories, M edges, 0 cycles"
 *   - Where N = total stories in project, M = sum of depends_on array lengths
 *
 * Edge cases:
 *   - No depends_on fields → "N stories, 0 edges, 0 cycles"
 *   - No stories → line is NOT printed (only when totalStories > 0)
 *   - Malformed depends_on JSON → those edges are skipped (count 0 for that story)
 *
 * EXPECTED: Tests fail until Load.ts is modified to print dep graph summary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { registerLoadCommand } from '../../../src/cli/Load.js';

// ─── vi.hoisted: configurable mock story rows ─────────────────────────────────

const { mockDbAll, mockDbGet } = vi.hoisted(() => ({
  // Returns story rows for the post-load dep-graph query
  mockDbAll: vi.fn(
    () => [] as Array<{ dependsOn: string | null }>
  ),
  // Returns project row (or null)
  mockDbGet: vi.fn(() => ({ id: 1 } as { id: number } | null)),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

// Mock DB: flexible chain — any .all() returns mockDbAll(), .get() returns mockDbGet().
// NOTE: The implementation queries stories via:
//   db.select({ dependsOn: stories.dependsOn }).from(stories)
//     .innerJoin(epics, eq(stories.epicId, epics.id))
//     .where(eq(epics.projectId, project.id))
//     .all()
// This mock handles all Drizzle chain variations by returning the same terminal
// object at each step. If the implementation adds additional joins or where
// clauses, this mock still handles them since each level returns the same terminal.
vi.mock('@core/db/Connection.js', () => ({
  openDatabase: vi.fn(() => {
    const terminal = {
      all: () => mockDbAll(),
      get: () => mockDbGet(),
    };
    // Each chaining method returns the same terminal so any chain depth is handled
    const chainable: Record<string, unknown> = {
      all: () => mockDbAll(),
      get: () => mockDbGet(),
    };
    chainable['where'] = () => chainable;
    chainable['innerJoin'] = () => chainable;
    chainable['from'] = () => chainable;
    chainable['limit'] = () => terminal;
    chainable['and'] = () => chainable;
    return { select: () => chainable };
  }),
}));

// LoadWizard is mocked entirely — we only care about what happens after waitUntilExit
vi.mock('@ui/load/LoadWizard.js', () => ({
  LoadWizard: vi.fn(),
}));

// LoadService and MarkdownParser are constructed but not called in --simple mode
// (the wizard handles the actual loading; we just need them to not throw)
vi.mock('@core/LoadService.js', () => ({
  LoadService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@core/MarkdownParser.js', () => ({
  MarkdownParser: vi.fn().mockImplementation(() => ({})),
}));

// ink render: immediately resolve waitUntilExit so Load.ts proceeds to dep graph query
vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
    unmount: vi.fn(),
    cleanup: vi.fn(),
    rerender: vi.fn(),
    clear: vi.fn(),
  }),
}));

// DependencyResolver mock for cycle detection (used by Load.ts if available)
vi.mock('@core/DependencyResolver.js', () => ({
  DependencyResolver: vi.fn().mockImplementation(() => ({
    hasCycles: vi.fn().mockReturnValue(false),
    resolveWaitingStories: vi.fn().mockResolvedValue(0),
    validateDependencyGraph: vi.fn().mockReturnValue({ hasErrors: false, errors: [] }),
  })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildLoadProgram(): Command {
  const program = new Command('agentkit');
  registerLoadCommand(program);
  return program;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Load CLI — dependency graph summary (AC5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    mockDbGet.mockReturnValue({ id: 1 });
    mockDbAll.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── AC5: Dep graph summary line is printed ────────────────────────────────

  it('should print "Dependency graph:" line after successful load', async () => {
    mockDbAll.mockReturnValue([
      { dependsOn: JSON.stringify(['21.1']) },
      { dependsOn: null },
    ]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Dependency graph:');

    consoleSpy.mockRestore();
  });

  it('should print correct story count in dep graph summary', async () => {
    // 4 stories total
    mockDbAll.mockReturnValue([
      { dependsOn: JSON.stringify(['21.1']) },
      { dependsOn: JSON.stringify(['21.1', '21.2']) },
      { dependsOn: null },
      { dependsOn: '[]' },
    ]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('4 stories');

    consoleSpy.mockRestore();
  });

  it('should print correct edge count (sum of depends_on array lengths)', async () => {
    // Story A: depends on [21.1] → 1 edge
    // Story B: depends on [21.1, 21.2] → 2 edges
    // Story C: depends on null → 0 edges
    // Story D: depends on [] → 0 edges
    // Total: 3 edges
    mockDbAll.mockReturnValue([
      { dependsOn: JSON.stringify(['21.1']) },
      { dependsOn: JSON.stringify(['21.1', '21.2']) },
      { dependsOn: null },
      { dependsOn: '[]' },
    ]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('3 edges');

    consoleSpy.mockRestore();
  });

  it('should print "0 cycles" (or cycles count) in dep graph summary', async () => {
    mockDbAll.mockReturnValue([
      { dependsOn: JSON.stringify(['21.1']) },
    ]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('cycles');
    expect(output).toContain('0 cycles');

    consoleSpy.mockRestore();
  });

  it('should print full summary format "Dependency graph: N stories, M edges, 0 cycles"', async () => {
    // 3 stories, 1+2=3 edges
    mockDbAll.mockReturnValue([
      { dependsOn: JSON.stringify(['21.1']) },
      { dependsOn: JSON.stringify(['21.1', '21.2']) },
      { dependsOn: null },
    ]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    // Full expected format
    expect(output).toMatch(/Dependency graph:\s*3 stories,\s*3 edges,\s*0 cycles/);

    consoleSpy.mockRestore();
  });

  // ── AC5 edge: no depends_on fields → 0 edges ─────────────────────────────

  it('should print "0 edges" when no stories have depends_on', async () => {
    // All null depends_on
    mockDbAll.mockReturnValue([
      { dependsOn: null },
      { dependsOn: null },
      { dependsOn: null },
    ]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('3 stories');
    expect(output).toContain('0 edges');
    expect(output).toContain('0 cycles');

    consoleSpy.mockRestore();
  });

  // ── AC5 edge: malformed depends_on JSON skipped (0 edges for that story) ──

  it('should skip malformed depends_on JSON when counting edges (no crash)', async () => {
    mockDbAll.mockReturnValue([
      { dependsOn: '[invalid json' },   // malformed → skip (0 edges)
      { dependsOn: JSON.stringify(['21.1']) }, // valid → 1 edge
    ]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await expect(
      program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' })
    ).resolves.not.toThrow();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Dependency graph:');
    expect(output).toContain('1 edges');

    consoleSpy.mockRestore();
  });

  // ── AC5 edge: no stories → dep graph line NOT printed ────────────────────

  it('should NOT print dep graph line when there are 0 stories in project', async () => {
    mockDbAll.mockReturnValue([]); // empty project

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).not.toContain('Dependency graph:');

    consoleSpy.mockRestore();
  });

  // ── AC5 edge: --simple flag with no file → exits 1 ───────────────────────

  it('should exit 1 with error when --simple given without a file', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1');
    });

    const program = buildLoadProgram();
    await expect(
      program.parseAsync(['load', '--simple'], { from: 'user' })
    ).rejects.toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── AC5 edge: no project in DB → exits before dep graph ──────────────────

  it('should exit 1 before printing dep graph when no project exists', async () => {
    mockDbGet.mockReturnValue(null); // no project

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1');
    });

    const program = buildLoadProgram();
    await expect(
      program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' })
    ).rejects.toThrow();

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).not.toContain('Dependency graph:');

    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── AC5 edge: load without --simple flag (requireInitialized must still work) ─

  it('should still enforce requireInitialized even for --simple mode', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1');
    });

    const program = buildLoadProgram();
    await expect(
      program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' })
    ).rejects.toThrow();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  // ── AC5: dep graph output uses "stories" and "edges" and "cycles" keywords ─

  it('should use keyword "stories" in dep graph line', async () => {
    mockDbAll.mockReturnValue([{ dependsOn: null }]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await program.parseAsync(['load', 'epic.md', '--simple'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('stories');
    expect(output).toContain('edges');
    expect(output).toContain('cycles');

    consoleSpy.mockRestore();
  });

  // ── AC5: large epic with many deps ───────────────────────────────────────

  it('should correctly count edges for a large epic (6 stories, 5 edges)', async () => {
    mockDbAll.mockReturnValue([
      { dependsOn: null },                              // story 1: 0 edges
      { dependsOn: JSON.stringify(['21.1']) },          // story 2: 1 edge
      { dependsOn: JSON.stringify(['21.1']) },          // story 3: 1 edge
      { dependsOn: JSON.stringify(['21.2', '21.3']) },  // story 4: 2 edges
      { dependsOn: JSON.stringify(['21.4']) },          // story 5: 1 edge
      { dependsOn: null },                              // story 6: 0 edges
      // total: 6 stories, 5 edges
    ]);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = buildLoadProgram();
    await program.parseAsync(['load', 'path/to/epic.md', '--simple'], { from: 'user' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('6 stories');
    expect(output).toContain('5 edges');
    expect(output).toContain('0 cycles');

    consoleSpy.mockRestore();
  });
});
