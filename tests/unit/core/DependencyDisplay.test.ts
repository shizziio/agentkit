/**
 * Story 21.6 — DependencyDisplay: resolveDepStatuses + formatDepList
 *
 * Unit tests for the DependencyDisplay helper module which:
 *   - Parses depends_on JSON arrays from story rows
 *   - Queries DB to find each dep story's current status
 *   - Formats dep arrays into human-readable strings with ✓/⏳ icons
 *
 * DEPENDENCY: Story 21.5 migration 0006 must be applied (depends_on column exists)
 * EXPECTED: Tests fail until src/core/DependencyDisplay.ts is implemented.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories } from '@core/db/schema.js';
import { resolveDepStatuses, formatDepList } from '@core/DependencyDisplay.js';

// ── Counters for unique keys ───────────────────────────────────────────────────

let projectCounter = 0;
let epicCounter = 0;
let storyCounter = 0;

// ── DB seed helpers ───────────────────────────────────────────────────────────

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: `dep-display-test-${++projectCounter}` })
    .returning({ id: projects.id })
    .get().id;
}

function seedEpic(db: DrizzleDB, projectId: number, epicKey: string): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey, title: `Epic ${epicKey}`, orderIndex: ++epicCounter })
    .returning({ id: epics.id })
    .get().id;
}

function seedStory(
  db: DrizzleDB,
  epicId: number,
  storyKey: string,
  status: string,
  dependsOn?: string[] | null
): number {
  const dependsOnValue =
    dependsOn === undefined || dependsOn === null ? null : JSON.stringify(dependsOn);
  return db
    .insert(stories)
    .values({
      epicId,
      storyKey,
      title: `Story ${storyKey}`,
      orderIndex: ++storyCounter,
      status,
      dependsOn: dependsOnValue,
    })
    .returning({ id: stories.id })
    .get().id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DependencyDisplay', () => {
  let db: DrizzleDB;
  let projectId: number;

  beforeEach(async () => {
    db = createConnection(':memory:');
    await runMigrations(db);
    projectId = seedProject(db);
  });

  // ─── resolveDepStatuses ───────────────────────────────────────────────────

  describe('resolveDepStatuses', () => {
    // ── Null / empty inputs ──────────────────────────────────────────────────

    it('should return [] when dependsOnJson is null', () => {
      const result = resolveDepStatuses(db, null, projectId);
      expect(result).toEqual([]);
    });

    it('should return [] when dependsOnJson is empty string', () => {
      const result = resolveDepStatuses(db, '', projectId);
      expect(result).toEqual([]);
    });

    it('should return [] when dependsOnJson is empty JSON array "[]"', () => {
      const result = resolveDepStatuses(db, '[]', projectId);
      expect(result).toEqual([]);
    });

    // ── Malformed JSON (must not throw) ──────────────────────────────────────

    it('should return [] and not throw when dependsOnJson is "[21.1]" (unquoted key)', () => {
      expect(() => resolveDepStatuses(db, '[21.1]', projectId)).not.toThrow();
      const result = resolveDepStatuses(db, '[21.1]', projectId);
      expect(result).toEqual([]);
    });

    it('should return [] and not throw when dependsOnJson is completely invalid JSON', () => {
      expect(() => resolveDepStatuses(db, 'not-json', projectId)).not.toThrow();
      expect(resolveDepStatuses(db, 'not-json', projectId)).toEqual([]);
    });

    it('should return [] and not throw when dependsOnJson is "{}" (object, not array)', () => {
      expect(() => resolveDepStatuses(db, '{}', projectId)).not.toThrow();
      const result = resolveDepStatuses(db, '{}', projectId);
      expect(result).toEqual([]);
    });

    // ── Single dependency resolution ─────────────────────────────────────────

    it('should resolve a single done dependency with status="done"', () => {
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '1', 'done');

      const result = resolveDepStatuses(db, JSON.stringify(['21.1']), projectId);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ key: '21.1', status: 'done' });
    });

    it('should resolve a single in_progress dependency correctly', () => {
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '1', 'in_progress');

      const result = resolveDepStatuses(db, JSON.stringify(['21.1']), projectId);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ key: '21.1', status: 'in_progress' });
    });

    it('should resolve a single waiting dependency correctly', () => {
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '2', 'waiting');

      const result = resolveDepStatuses(db, JSON.stringify(['21.2']), projectId);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ key: '21.2', status: 'waiting' });
    });

    it('should resolve a single draft dependency correctly', () => {
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '3', 'draft');

      const result = resolveDepStatuses(db, JSON.stringify(['21.3']), projectId);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ key: '21.3', status: 'draft' });
    });

    // ── Multiple dependencies ────────────────────────────────────────────────

    it('should resolve multiple dependencies with mixed statuses', () => {
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '1', 'done');
      seedStory(db, epicId, '2', 'in_progress');
      seedStory(db, epicId, '3', 'waiting');

      const result = resolveDepStatuses(
        db,
        JSON.stringify(['21.1', '21.2', '21.3']),
        projectId
      );
      expect(result).toHaveLength(3);
      expect(result.find((d) => d.key === '21.1')?.status).toBe('done');
      expect(result.find((d) => d.key === '21.2')?.status).toBe('in_progress');
      expect(result.find((d) => d.key === '21.3')?.status).toBe('waiting');
    });

    // ── Unknown dep storyKey ─────────────────────────────────────────────────

    it('should return status="unknown" for a dep storyKey that does not exist in DB', () => {
      // Edge case: dep story was deleted or key is wrong
      const result = resolveDepStatuses(db, JSON.stringify(['99.99']), projectId);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ key: '99.99', status: 'unknown' });
    });

    it('should not throw when dep storyKey references a non-existent story', () => {
      expect(() =>
        resolveDepStatuses(db, JSON.stringify(['21.999']), projectId)
      ).not.toThrow();
    });

    // ── Cross-epic dependencies ──────────────────────────────────────────────

    it('should resolve cross-epic deps by splitting key on "." (epicKey.storyKey)', () => {
      const epic20Id = seedEpic(db, projectId, '20');
      const epic21Id = seedEpic(db, projectId, '21');
      seedStory(db, epic20Id, '3', 'done');
      seedStory(db, epic21Id, '1', 'in_progress');

      const result = resolveDepStatuses(
        db,
        JSON.stringify(['20.3', '21.1']),
        projectId
      );
      expect(result).toHaveLength(2);
      expect(result.find((d) => d.key === '20.3')?.status).toBe('done');
      expect(result.find((d) => d.key === '21.1')?.status).toBe('in_progress');
    });

    it('should not match a dep to a story in a different project', () => {
      // Create a second project with the same epicKey/storyKey
      const otherProjectId = seedProject(db);
      const otherEpicId = seedEpic(db, otherProjectId, '21');
      seedStory(db, otherEpicId, '1', 'done');

      // projectId project has no epic 21, so should return unknown
      const result = resolveDepStatuses(db, JSON.stringify(['21.1']), projectId);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ key: '21.1', status: 'unknown' });
    });

    // ── One-level shallow resolution (no recursion) ──────────────────────────

    it('should resolve only one level deep — not recurse into deps of deps', () => {
      // A waiting on B; B waiting on C — resolving A's deps should return B.status, not drill into C
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '2', 'waiting', ['21.3']);
      seedStory(db, epicId, '3', 'waiting');

      const result = resolveDepStatuses(db, JSON.stringify(['21.2']), projectId);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ key: '21.2', status: 'waiting' });
    });

    // ── Circular dependency safety ────────────────────────────────────────────

    it('should not throw or recurse infinitely for circular deps (A→B→A)', () => {
      // resolveDepStatuses is one-level only — circular deps are inherently safe
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '4', 'waiting', ['21.5']);
      seedStory(db, epicId, '5', 'waiting', ['21.4']);

      expect(() =>
        resolveDepStatuses(db, JSON.stringify(['21.5']), projectId)
      ).not.toThrow();

      const result = resolveDepStatuses(db, JSON.stringify(['21.5']), projectId);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('21.5');
      expect(result[0].status).toBe('waiting');
    });

    // ── Pipeline lag: all deps done but story still waiting ──────────────────

    it('should return done status for all deps when all are done (pipeline lag scenario)', () => {
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '1', 'done');
      seedStory(db, epicId, '2', 'done');

      const result = resolveDepStatuses(
        db,
        JSON.stringify(['21.1', '21.2']),
        projectId
      );
      expect(result).toHaveLength(2);
      result.forEach((dep) => expect(dep.status).toBe('done'));
    });

    // ── Edge: dep key without "." separator ──────────────────────────────────

    it('should handle a dep key without "." separator gracefully (not throw)', () => {
      expect(() =>
        resolveDepStatuses(db, JSON.stringify(['nodot']), projectId)
      ).not.toThrow();
    });

    // ── Dep key format is exact: "epicKey.storyKey" ──────────────────────────

    it('should only match story where epicKey AND storyKey both match', () => {
      const epicId = seedEpic(db, projectId, '21');
      // storyKey '1' exists under epicKey '21'
      seedStory(db, epicId, '1', 'done');

      // '21.1' should match
      const matchResult = resolveDepStatuses(db, JSON.stringify(['21.1']), projectId);
      expect(matchResult[0]?.status).toBe('done');

      // '22.1' should NOT match (wrong epicKey)
      const noMatchResult = resolveDepStatuses(db, JSON.stringify(['22.1']), projectId);
      expect(noMatchResult[0]?.status).toBe('unknown');
    });
  });

  // ─── formatDepList ────────────────────────────────────────────────────────

  describe('formatDepList', () => {
    it('should return empty string for empty array', () => {
      expect(formatDepList([])).toBe('');
    });

    it('should return "21.1 ✓" for a single done dep', () => {
      const result = formatDepList([{ key: '21.1', status: 'done' }]);
      expect(result).toBe('21.1 ✓');
    });

    it('should return "21.2 ⏳" for a single waiting dep (non-done)', () => {
      const result = formatDepList([{ key: '21.2', status: 'waiting' }]);
      expect(result).toBe('21.2 ⏳');
    });

    it('should return "21.3 ⏳" for an in_progress dep (non-done)', () => {
      const result = formatDepList([{ key: '21.3', status: 'in_progress' }]);
      expect(result).toBe('21.3 ⏳');
    });

    it('should return "21.4 ⏳" for a draft dep (non-done)', () => {
      const result = formatDepList([{ key: '21.4', status: 'draft' }]);
      expect(result).toBe('21.4 ⏳');
    });

    it('should return "21.5 ⏳" for a dep with status="unknown"', () => {
      const result = formatDepList([{ key: '21.5', status: 'unknown' }]);
      expect(result).toBe('21.5 ⏳');
    });

    it('should use ✓ ONLY for status="done" and ⏳ for all other statuses', () => {
      const nonDoneStatuses = ['draft', 'in_progress', 'waiting', 'failed', 'unknown'];
      nonDoneStatuses.forEach((status) => {
        const result = formatDepList([{ key: '21.1', status }]);
        expect(result).toBe('21.1 ⏳');
      });

      const doneResult = formatDepList([{ key: '21.1', status: 'done' }]);
      expect(doneResult).toBe('21.1 ✓');
    });

    it('should join two deps with ", " separator', () => {
      const result = formatDepList([
        { key: '21.1', status: 'done' },
        { key: '21.2', status: 'waiting' },
      ]);
      expect(result).toBe('21.1 ✓, 21.2 ⏳');
    });

    it('should format three deps with mixed statuses', () => {
      const result = formatDepList([
        { key: '21.1', status: 'done' },
        { key: '21.2', status: 'done' },
        { key: '21.3', status: 'in_progress' },
      ]);
      expect(result).toBe('21.1 ✓, 21.2 ✓, 21.3 ⏳');
    });

    it('should format a list of only done deps with all ✓ icons', () => {
      const result = formatDepList([
        { key: '21.1', status: 'done' },
        { key: '21.2', status: 'done' },
      ]);
      expect(result).toBe('21.1 ✓, 21.2 ✓');
    });

    it('should format a list of only pending deps with all ⏳ icons', () => {
      const result = formatDepList([
        { key: '21.2', status: 'waiting' },
        { key: '21.3', status: 'draft' },
      ]);
      expect(result).toBe('21.2 ⏳, 21.3 ⏳');
    });

    it('should handle a very long dep list (>5 deps) without throwing', () => {
      const deps = Array.from({ length: 8 }, (_, i) => ({
        key: `21.${i + 1}`,
        status: i % 2 === 0 ? 'done' : 'waiting',
      }));
      expect(() => formatDepList(deps)).not.toThrow();
      const result = formatDepList(deps);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should produce correct output for a long mixed dep list', () => {
      const result = formatDepList([
        { key: '21.1', status: 'done' },
        { key: '21.2', status: 'waiting' },
        { key: '21.3', status: 'done' },
        { key: '21.4', status: 'in_progress' },
        { key: '21.5', status: 'done' },
      ]);
      expect(result).toBe('21.1 ✓, 21.2 ⏳, 21.3 ✓, 21.4 ⏳, 21.5 ✓');
    });

    it('should preserve key order in output', () => {
      const result = formatDepList([
        { key: '21.3', status: 'done' },
        { key: '21.1', status: 'waiting' },
        { key: '21.2', status: 'done' },
      ]);
      // Keys should appear in input order, not sorted
      expect(result.indexOf('21.3')).toBeLessThan(result.indexOf('21.1'));
      expect(result.indexOf('21.1')).toBeLessThan(result.indexOf('21.2'));
    });
  });

  // ─── Integration: resolveDepStatuses → formatDepList pipeline ─────────────

  describe('resolveDepStatuses → formatDepList pipeline', () => {
    it('should produce correct formatted string for a done dep', () => {
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '1', 'done');

      const deps = resolveDepStatuses(db, JSON.stringify(['21.1']), projectId);
      const formatted = formatDepList(deps);
      expect(formatted).toBe('21.1 ✓');
    });

    it('should produce correct formatted string for done + pending deps', () => {
      const epicId = seedEpic(db, projectId, '21');
      seedStory(db, epicId, '2', 'done');
      seedStory(db, epicId, '3', 'waiting');

      const deps = resolveDepStatuses(db, JSON.stringify(['21.2', '21.3']), projectId);
      const formatted = formatDepList(deps);
      expect(formatted).toContain('21.2 ✓');
      expect(formatted).toContain('21.3 ⏳');
    });

    it('should produce empty string when dependsOnJson is null', () => {
      const deps = resolveDepStatuses(db, null, projectId);
      const formatted = formatDepList(deps);
      expect(formatted).toBe('');
    });

    it('should produce ⏳ for unknown dep (story deleted) in pipeline', () => {
      const deps = resolveDepStatuses(db, JSON.stringify(['21.99']), projectId);
      const formatted = formatDepList(deps);
      expect(formatted).toBe('21.99 ⏳');
    });
  });
});
