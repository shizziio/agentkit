import { describe, it, expect, vi } from 'vitest';

import { validateDAG, checkDanglingRefs } from '@core/DagValidator.js';
import type { LoggerLike } from '@core/Logger.js';

// ─── Mock logger factory ──────────────────────────────────────────────────────
// Returns a properly-typed warn spy alongside a Pick<LoggerLike, 'warn'> object.
// Using a factory avoids `as any` casts while keeping mock.calls accessible.

function makeMockLogger() {
  const warn = vi.fn<[string, Record<string, unknown>?], void>();
  const logger: Pick<LoggerLike, 'warn'> = { warn };
  return { logger, warn };
}

// ─── validateDAG ──────────────────────────────────────────────────────────────

describe('validateDAG', () => {
  // ─── AC6b: empty node list ─────────────────────────────────────────────────

  describe('empty and trivial cases', () => {
    it('should return { valid: true } for empty node list (AC6b)', () => {
      const result = validateDAG([]);
      expect(result.valid).toBe(true);
      expect(result.cycle).toBeUndefined();
    });

    it('should return valid for a single node with no dependencies', () => {
      const result = validateDAG([{ key: 'A', dependsOn: [] }]);
      expect(result.valid).toBe(true);
    });

    it('should return valid for multiple nodes all with empty dependsOn', () => {
      const result = validateDAG([
        { key: '1.1', dependsOn: [] },
        { key: '1.2', dependsOn: [] },
        { key: '1.3', dependsOn: [] },
      ]);
      expect(result.valid).toBe(true);
    });

    it('should return valid for a node referencing an unknown key (dangling ref — not considered in DAG)', () => {
      // Dangling refs are out-of-set keys; validateDAG ignores them for cycle detection
      const result = validateDAG([{ key: 'A', dependsOn: ['MISSING'] }]);
      expect(result.valid).toBe(true);
    });
  });

  // ─── AC6c: valid linear chains ─────────────────────────────────────────────

  describe('linear chains (valid DAGs)', () => {
    it('should return valid for A → B linear dependency (AC6c partial)', () => {
      const result = validateDAG([
        { key: 'A', dependsOn: [] },
        { key: 'B', dependsOn: ['A'] },
      ]);
      expect(result.valid).toBe(true);
    });

    it('should return valid for A → B → C (AC6c full)', () => {
      const result = validateDAG([
        { key: 'A', dependsOn: [] },
        { key: 'B', dependsOn: ['A'] },
        { key: 'C', dependsOn: ['B'] },
      ]);
      expect(result.valid).toBe(true);
    });

    it('should return valid for story-key-style identifiers: 21.1 → 21.2 → 21.3', () => {
      const result = validateDAG([
        { key: '21.1', dependsOn: [] },
        { key: '21.2', dependsOn: ['21.1'] },
        { key: '21.3', dependsOn: ['21.2'] },
      ]);
      expect(result.valid).toBe(true);
    });

    it('should return valid for diamond dependency graph (common in multi-story epics)', () => {
      // A → B, A → C, B → D, C → D
      const result = validateDAG([
        { key: 'A', dependsOn: [] },
        { key: 'B', dependsOn: ['A'] },
        { key: 'C', dependsOn: ['A'] },
        { key: 'D', dependsOn: ['B', 'C'] },
      ]);
      expect(result.valid).toBe(true);
    });

    it('should return valid for large chain of 20 stories (no cycle)', () => {
      const nodes = Array.from({ length: 20 }, (_, i) => ({
        key: `21.${i + 1}`,
        dependsOn: i === 0 ? [] : [`21.${i}`],
      }));
      const result = validateDAG(nodes);
      expect(result.valid).toBe(true);
    });

    it('should return valid when some nodes have dangling refs alongside valid deps', () => {
      // 21.2 depends on 21.1 (valid) and on 99.9 (dangling — not in set, ignored)
      const result = validateDAG([
        { key: '21.1', dependsOn: [] },
        { key: '21.2', dependsOn: ['21.1', '99.9'] },
      ]);
      expect(result.valid).toBe(true);
    });
  });

  // ─── AC6d: cycle detection ─────────────────────────────────────────────────

  describe('cycle detection (AC6d)', () => {
    it('should return { valid: false } for simple A → B → A cycle', () => {
      const result = validateDAG([
        { key: 'A', dependsOn: ['B'] },
        { key: 'B', dependsOn: ['A'] },
      ]);
      expect(result.valid).toBe(false);
      expect(result.cycle).toBeDefined();
    });

    it('should include both cycle nodes in the cycle array for A ↔ B', () => {
      const result = validateDAG([
        { key: 'A', dependsOn: ['B'] },
        { key: 'B', dependsOn: ['A'] },
      ]);
      expect(result.valid).toBe(false);
      const cycle = result.cycle!;
      expect(cycle).toContain('A');
      expect(cycle).toContain('B');
    });

    it('should return cycle array where first and last element are the same node (cycle notation)', () => {
      const result = validateDAG([
        { key: 'A', dependsOn: ['B'] },
        { key: 'B', dependsOn: ['A'] },
      ]);
      expect(result.valid).toBe(false);
      const cycle = result.cycle!;
      expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    });

    it('should detect self-dependency (story A depends on itself)', () => {
      const result = validateDAG([{ key: 'A', dependsOn: ['A'] }]);
      expect(result.valid).toBe(false);
      expect(result.cycle).toBeDefined();
      expect(result.cycle!).toContain('A');
    });

    it('should detect 3-node cycle A → B → C → A', () => {
      const result = validateDAG([
        { key: 'A', dependsOn: ['C'] },
        { key: 'B', dependsOn: ['A'] },
        { key: 'C', dependsOn: ['B'] },
      ]);
      expect(result.valid).toBe(false);
      expect(result.cycle).toBeDefined();
      expect(result.cycle!.length).toBeGreaterThanOrEqual(3);
    });

    it('should detect cycle among subset of nodes even when other nodes are valid', () => {
      const result = validateDAG([
        { key: 'X', dependsOn: [] },         // valid, no cycle
        { key: 'A', dependsOn: ['B'] },       // in cycle
        { key: 'B', dependsOn: ['A'] },       // in cycle
      ]);
      expect(result.valid).toBe(false);
    });

    it('should detect cycle in story-key-style: 21.3 → 21.4 → 21.3', () => {
      const result = validateDAG([
        { key: '21.1', dependsOn: [] },
        { key: '21.2', dependsOn: ['21.1'] },
        { key: '21.3', dependsOn: ['21.4'] },
        { key: '21.4', dependsOn: ['21.3'] },
      ]);
      expect(result.valid).toBe(false);
      const cycle = result.cycle!;
      expect(cycle).toContain('21.3');
      expect(cycle).toContain('21.4');
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle cycle with dangling ref on one of the cycle nodes', () => {
      // A depends on B (cycle within set) and MISSING (dangling — not in set)
      const result = validateDAG([
        { key: 'A', dependsOn: ['B', 'MISSING'] },
        { key: 'B', dependsOn: ['A'] },
      ]);
      // A ↔ B is a cycle; MISSING is ignored for cycle detection
      expect(result.valid).toBe(false);
    });

    it('should not include cycle field when result is valid', () => {
      const result = validateDAG([
        { key: 'A', dependsOn: [] },
        { key: 'B', dependsOn: ['A'] },
      ]);
      expect(result.valid).toBe(true);
      expect(result.cycle).toBeUndefined();
    });

    it('should handle duplicate dependsOn entries gracefully (same dep key listed twice in one node)', () => {
      const result = validateDAG([
        { key: 'A', dependsOn: [] },
        { key: 'B', dependsOn: ['A', 'A'] },
      ]);
      // Duplicate dep entries within a single node should not cause false cycle detection
      expect(result.valid).toBe(true);
    });

    it('should handle duplicate node keys in input without crashing (graceful, no infinite loop)', () => {
      // Two nodes with key 'A' — validateDAG must not throw or loop infinitely
      expect(() => {
        validateDAG([
          { key: 'A', dependsOn: [] },
          { key: 'A', dependsOn: ['B'] }, // duplicate key
          { key: 'B', dependsOn: [] },
        ]);
      }).not.toThrow();
    });

    it('should bound cycle path length for a large cyclic graph (≤ node count + 1)', () => {
      // 20-node ring cycle: story-1 → story-2 → ... → story-20 → story-1
      const size = 20;
      const nodes = Array.from({ length: size }, (_, i) => ({
        key: `story-${i + 1}`,
        dependsOn: [`story-${(i % size) + 2 <= size ? (i % size) + 2 : 1}`],
      }));
      const result = validateDAG(nodes);
      expect(result.valid).toBe(false);
      expect(result.cycle).toBeDefined();
      // Cycle array must be bounded — at most nodeCount + 1 elements (start repeated at end)
      expect(result.cycle!.length).toBeLessThanOrEqual(size + 1);
    });
  });
});

// ─── checkDanglingRefs ────────────────────────────────────────────────────────

describe('checkDanglingRefs', () => {
  it('should not call warn when all dependencies exist in the node set', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs(
      [
        { key: 'A', dependsOn: [] },
        { key: 'B', dependsOn: ['A'] },
      ],
      logger,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('should call warn once when story depends on one unknown key', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs(
      [{ key: '21.3', dependsOn: ['21.9'] }],
      logger,
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it('should include the referencing story key in the warning metadata', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs(
      [{ key: '21.3', dependsOn: ['21.9'] }],
      logger,
    );
    const [, meta] = warn.mock.calls[0]!;
    expect(meta?.story).toBe('21.3');
  });

  it('should include the unknown dep key in the warning metadata', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs(
      [{ key: '21.3', dependsOn: ['21.9'] }],
      logger,
    );
    const [, meta] = warn.mock.calls[0]!;
    expect(meta?.unknownDep).toBe('21.9');
  });

  it('should call warn once per unknown dependency key (multiple unknown deps in one story)', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs(
      [{ key: '21.1', dependsOn: ['99.1', '99.2'] }],
      logger,
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('should call warn for each story that has unknown deps (multiple stories, one unknown each)', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs(
      [
        { key: '21.1', dependsOn: ['99.1'] },
        { key: '21.2', dependsOn: ['99.2'] },
      ],
      logger,
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('should not call warn for empty node list', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs([], logger);
    expect(warn).not.toHaveBeenCalled();
  });

  it('should not call warn for nodes with no deps', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs(
      [
        { key: '21.1', dependsOn: [] },
        { key: '21.2', dependsOn: [] },
      ],
      logger,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('should only warn for unknown keys — known deps within the set do not trigger warn', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs(
      [
        { key: '21.1', dependsOn: [] },
        { key: '21.2', dependsOn: ['21.1', '99.9'] }, // 21.1 is known, 99.9 is not
      ],
      logger,
    );
    // Only warn for 99.9, not for 21.1
    expect(warn).toHaveBeenCalledTimes(1);
    const [, meta] = warn.mock.calls[0]!;
    expect(meta?.unknownDep).toBe('99.9');
  });

  it('should pass a message string containing "dangling" to warn', () => {
    const { logger, warn } = makeMockLogger();
    checkDanglingRefs(
      [{ key: '21.5', dependsOn: ['21.9'] }],
      logger,
    );
    const [msg] = warn.mock.calls[0]!;
    expect(typeof msg).toBe('string');
    expect(msg.toLowerCase()).toMatch(/dangling/);
  });
});
