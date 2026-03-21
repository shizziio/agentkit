/**
 * Story 21.3: LoadService — Parse Dependencies & Validate DAG
 *
 * Integration tests for LoadService.saveToDatabase() with depends_on persistence,
 * DAG cycle detection, dangling reference warnings, and backward compatibility.
 *
 * These tests require:
 *   - ParsedStory.dependsOn?: string[]  (Story 21.1)
 *   - stories.depends_on TEXT column    (Story 21.2 migration)
 *   - validateDAG / checkDanglingRefs   (Story 21.3 implementation)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Database as DatabaseType } from 'better-sqlite3';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories } from '@core/db/schema.js';
import { LoadService } from '@core/LoadService.js';
import { LoadError } from '@core/Errors.js';
import type { ParsedContent } from '@core/ParserTypes.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Ensure the depends_on column exists on the stories table.
 * Acts as a safety net so tests fail for the right reason (missing impl)
 * rather than the wrong reason (missing column when migration not yet applied).
 */
function ensureDependsOnColumn(db: DrizzleDB): void {
  const sqlite = db.$client as DatabaseType;
  try {
    sqlite.exec('ALTER TABLE stories ADD COLUMN depends_on TEXT');
  } catch {
    // Column already exists — fine to ignore
  }
}

function makeStory(
  key: string,
  opts: { contentHash?: string; orderIndex?: number; dependsOn?: string[] } = {},
) {
  return {
    key,
    title: `Story ${key}`,
    content: `Content for ${key}`,
    contentHash: opts.contentHash ?? `hash-${key}`,
    orderIndex: opts.orderIndex ?? 0,
    ...(opts.dependsOn !== undefined ? { dependsOn: opts.dependsOn } : {}),
  };
}

function makeEpic(storyDefs: ReturnType<typeof makeStory>[]): ParsedContent {
  return {
    epics: [
      {
        key: '21',
        title: 'Epic 21',
        description: 'Test epic',
        contentHash: 'hash-epic-21',
        orderIndex: 0,
        stories: storyDefs,
      },
    ],
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('LoadService — depends_on persistence (Story 21.3)', () => {
  let db: DrizzleDB;
  let service: LoadService;
  let projectId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    ensureDependsOnColumn(db);
    const inserted = db
      .insert(projects)
      .values({ projectName: 'test-project' })
      .returning({ id: projects.id })
      .get();
    projectId = inserted.id;
    service = new LoadService(db);
  });

  // ─── AC1: dependsOn saved to DB ─────────────────────────────────────────────

  describe('AC1: dependsOn saved to DB as JSON string', () => {
    it('should save depends_on = \'["21.1"]\' when story has dependsOn: ["21.1"]', () => {
      const parsed = makeEpic([makeStory('21.2', { dependsOn: ['21.1'] })]);
      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const sqlite = db.$client as DatabaseType;
      const row = sqlite
        .prepare(`SELECT depends_on FROM stories WHERE story_key = '21.2'`)
        .get() as { depends_on: string | null };

      expect(row.depends_on).toBe('["21.1"]');
    });

    it('should save depends_on as parseable JSON array when story has multiple deps', () => {
      const parsed = makeEpic([makeStory('21.3', { dependsOn: ['21.1', '21.2'] })]);
      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const sqlite = db.$client as DatabaseType;
      const row = sqlite
        .prepare(`SELECT depends_on FROM stories WHERE story_key = '21.3'`)
        .get() as { depends_on: string | null };

      expect(row.depends_on).not.toBeNull();
      expect(JSON.parse(row.depends_on!)).toEqual(['21.1', '21.2']);
    });

    it('should persist depends_on via Drizzle ORM story.dependsOn field (schema check)', () => {
      const parsed = makeEpic([makeStory('21.2', { dependsOn: ['21.1'] })]);
      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const savedStories = db.select().from(stories).all();
      expect(savedStories).toHaveLength(1);
      // After Story 21.2, the Drizzle ORM field is 'dependsOn' (camelCase) — no cast needed
      const [first] = savedStories;
      expect(first?.dependsOn).toBe('["21.1"]');
    });
  });

  // ─── AC2: No dependencies = NULL ────────────────────────────────────────────

  describe('AC2: No dependencies = NULL in DB', () => {
    it('should save depends_on = NULL when story has dependsOn: []', () => {
      const parsed = makeEpic([makeStory('21.1', { dependsOn: [] })]);
      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const sqlite = db.$client as DatabaseType;
      const row = sqlite
        .prepare(`SELECT depends_on FROM stories WHERE story_key = '21.1'`)
        .get() as { depends_on: string | null };

      expect(row.depends_on).toBeNull();
    });

    it('should save depends_on = NULL when story has no dependsOn field (legacy ParsedStory)', () => {
      // Simulate legacy ParsedStory without dependsOn — no field at all
      const parsed: ParsedContent = {
        epics: [
          {
            key: '21',
            title: 'Epic 21',
            description: 'desc',
            contentHash: 'hash-epic-21',
            orderIndex: 0,
            stories: [
              {
                key: '21.1',
                title: 'Legacy Story',
                content: 'content',
                contentHash: 'hash-21-1',
                orderIndex: 0,
                // dependsOn intentionally absent
              },
            ],
          },
        ],
      };
      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const sqlite = db.$client as DatabaseType;
      const row = sqlite
        .prepare(`SELECT depends_on FROM stories WHERE story_key = '21.1'`)
        .get() as { depends_on: string | null };

      expect(row.depends_on).toBeNull();
    });
  });

  // ─── AC3: DAG validation — valid graph ──────────────────────────────────────

  describe('AC3: DAG validation — valid graph loads successfully', () => {
    it('should insert all stories when dependency graph is a valid linear chain', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: [] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
        makeStory('21.3', { contentHash: 'h3', orderIndex: 2, dependsOn: ['21.2'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);
      const result = service.saveToDatabase(projectId, comparison, 'test.md');

      expect(result.insertedStories).toBe(3);
      expect(db.select().from(stories).all()).toHaveLength(3);
    });

    it('should not throw for valid diamond dependency graph', () => {
      // A → B, A → C, B → D, C → D
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: [] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
        makeStory('21.3', { contentHash: 'h3', orderIndex: 2, dependsOn: ['21.1'] }),
        makeStory('21.4', { contentHash: 'h4', orderIndex: 3, dependsOn: ['21.2', '21.3'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      expect(() => service.saveToDatabase(projectId, comparison, 'test.md')).not.toThrow();
      expect(db.select().from(stories).all()).toHaveLength(4);
    });

    it('should save correct depends_on values for each story in a valid DAG', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: [] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
        makeStory('21.3', { contentHash: 'h3', orderIndex: 2, dependsOn: ['21.2'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const sqlite = db.$client as DatabaseType;
      const rows = sqlite
        .prepare(`SELECT story_key, depends_on FROM stories ORDER BY story_key`)
        .all() as { story_key: string; depends_on: string | null }[];

      expect(rows.find((r) => r.story_key === '21.1')?.depends_on).toBeNull();
      expect(rows.find((r) => r.story_key === '21.2')?.depends_on).toBe('["21.1"]');
      expect(rows.find((r) => r.story_key === '21.3')?.depends_on).toBe('["21.2"]');
    });
  });

  // ─── AC4: DAG validation — cycle detected ───────────────────────────────────

  describe('AC4: DAG validation — cycle detected → LoadError + full rollback', () => {
    it('should throw LoadError when A → B → A cycle is detected', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.2'] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      expect(() => service.saveToDatabase(projectId, comparison, 'test.md')).toThrow(LoadError);
    });

    it('should include cycle path in LoadError message (story keys separated by →)', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.2'] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      let thrown: Error | null = null;
      try {
        service.saveToDatabase(projectId, comparison, 'test.md');
      } catch (e) {
        thrown = e as Error;
      }

      expect(thrown).not.toBeNull();
      expect(thrown!.message).toContain('→');
      expect(thrown!.message).toMatch(/21\.1/);
      expect(thrown!.message).toMatch(/21\.2/);
    });

    it('should NOT insert any stories when cycle is detected (full transaction rollback)', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.2'] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      try {
        service.saveToDatabase(projectId, comparison, 'test.md');
      } catch {
        // expected
      }

      expect(db.select().from(stories).all()).toHaveLength(0);
    });

    it('should NOT insert any epics when cycle is detected (full transaction rollback)', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.2'] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      try {
        service.saveToDatabase(projectId, comparison, 'test.md');
      } catch {
        // expected
      }

      expect(db.select().from(epics).all()).toHaveLength(0);
    });

    it('should detect self-dependency cycle (A depends on A)', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      expect(() => service.saveToDatabase(projectId, comparison, 'test.md')).toThrow(LoadError);
    });

    it('should detect self-dependency and roll back — zero stories inserted', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      try {
        service.saveToDatabase(projectId, comparison, 'test.md');
      } catch {
        // expected
      }

      expect(db.select().from(stories).all()).toHaveLength(0);
    });

    it('should detect 3-node cycle A → B → C → A and throw LoadError', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.3'] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
        makeStory('21.3', { contentHash: 'h3', orderIndex: 2, dependsOn: ['21.2'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      expect(() => service.saveToDatabase(projectId, comparison, 'test.md')).toThrow(LoadError);
    });

    it('should throw LoadError (not a generic Error) so callers can distinguish it', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.2'] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      expect(() => service.saveToDatabase(projectId, comparison, 'test.md')).toThrow(LoadError);
    });

    it('should contain "cycle" or "Cycle" in the LoadError message', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.2'] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      let thrown: LoadError | null = null;
      try {
        service.saveToDatabase(projectId, comparison, 'test.md');
      } catch (e) {
        thrown = e as LoadError;
      }

      expect(thrown!.message.toLowerCase()).toMatch(/cycle/);
    });
  });

  // ─── AC5: Dangling reference warning ────────────────────────────────────────

  describe('AC5: Dangling reference — warning only, load succeeds', () => {
    it('should NOT throw when story depends on a key that does not exist in the epic', () => {
      const parsed = makeEpic([
        makeStory('21.1', { dependsOn: ['21.9'] }), // 21.9 not in epic
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      expect(() => service.saveToDatabase(projectId, comparison, 'test.md')).not.toThrow();
    });

    it('should insert the story successfully even with a dangling reference', () => {
      const parsed = makeEpic([
        makeStory('21.1', { dependsOn: ['21.9'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);
      const result = service.saveToDatabase(projectId, comparison, 'test.md');

      expect(result.insertedStories).toBe(1);
      expect(db.select().from(stories).all()).toHaveLength(1);
    });

    it('should still persist the depends_on value even when the dep is dangling', () => {
      const parsed = makeEpic([
        makeStory('21.1', { dependsOn: ['21.9'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const sqlite = db.$client as DatabaseType;
      const row = sqlite
        .prepare(`SELECT depends_on FROM stories WHERE story_key = '21.1'`)
        .get() as { depends_on: string | null };

      expect(row.depends_on).toBe('["21.9"]');
    });

    it('should load all stories when only one has a dangling ref and others are valid', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: [] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1', '99.9'] }), // 99.9 is dangling
        makeStory('21.3', { contentHash: 'h3', orderIndex: 2, dependsOn: ['21.2'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);
      const result = service.saveToDatabase(projectId, comparison, 'test.md');

      expect(result.insertedStories).toBe(3);
    });
  });

  // ─── AC6: Backward compat — epic without epic.json ──────────────────────────

  describe('AC6: Backward compat — epic without dependsOn (legacy epic.md only)', () => {
    it('should insert all stories with depends_on = NULL when no dependsOn field present', () => {
      // All ParsedStory objects without dependsOn field (pre-21.1 parsedContent)
      const parsed: ParsedContent = {
        epics: [
          {
            key: '21',
            title: 'Epic 21',
            description: 'desc',
            contentHash: 'hash-epic-21',
            orderIndex: 0,
            stories: [
              { key: '21.1', title: 'Story 1', content: 'c1', contentHash: 'h1', orderIndex: 0 },
              { key: '21.2', title: 'Story 2', content: 'c2', contentHash: 'h2', orderIndex: 1 },
              { key: '21.3', title: 'Story 3', content: 'c3', contentHash: 'h3', orderIndex: 2 },
            ],
          },
        ],
      };
      const comparison = service.compareWithDatabase(projectId, parsed);
      const result = service.saveToDatabase(projectId, comparison, 'test.md');

      expect(result.insertedStories).toBe(3);

      const sqlite = db.$client as DatabaseType;
      const rows = sqlite
        .prepare(`SELECT depends_on FROM stories`)
        .all() as { depends_on: string | null }[];

      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.depends_on === null)).toBe(true);
    });

    it('should not throw for epics parsed from epic.md only (no cycle validation issue)', () => {
      const parsed: ParsedContent = {
        epics: [
          {
            key: '21',
            title: 'Epic 21',
            description: 'desc',
            contentHash: 'hash-epic-21',
            orderIndex: 0,
            stories: [
              { key: '21.1', title: 'Story 1', content: 'c1', contentHash: 'h1', orderIndex: 0 },
            ],
          },
        ],
      };
      const comparison = service.compareWithDatabase(projectId, parsed);

      expect(() => service.saveToDatabase(projectId, comparison, 'test.md')).not.toThrow();
    });

    it('should return same LoadResult shape as before (backward compat on return value)', () => {
      const parsed: ParsedContent = {
        epics: [
          {
            key: '21',
            title: 'Epic 21',
            description: 'desc',
            contentHash: 'hash-epic-21',
            orderIndex: 0,
            stories: [
              { key: '21.1', title: 'Story 1', content: 'c1', contentHash: 'h1', orderIndex: 0 },
            ],
          },
        ],
      };
      const comparison = service.compareWithDatabase(projectId, parsed);
      const result = service.saveToDatabase(projectId, comparison, 'test.md');

      expect(result).toMatchObject({
        insertedEpics: 1,
        updatedEpics: 0,
        insertedStories: 1,
        updatedStories: 0,
      });
    });
  });

  // ─── UPDATE path: depends_on persisted on story update ───────────────────────

  describe('depends_on on UPDATE (story already exists in DB)', () => {
    it('should update depends_on when story content changes and now has dependsOn', () => {
      // Pre-insert a story without depends_on
      const epicRow = db
        .insert(epics)
        .values({
          projectId,
          epicKey: '21',
          title: 'Epic 21',
          contentHash: 'old-epic-hash',
          sourceFile: 'test.md',
          orderIndex: 0,
        })
        .returning({ id: epics.id })
        .get();

      const sqlite = db.$client as DatabaseType;
      sqlite.prepare(
        `INSERT INTO stories (epic_id, story_key, title, content, content_hash, order_index)
         VALUES (?, '21.2', 'Story 21.2', 'old content', 'old-hash', 0)`
      ).run(epicRow.id);

      // Now update with new content + dependsOn
      const parsed = makeEpic([
        makeStory('21.2', {
          contentHash: 'new-story-hash',
          orderIndex: 0,
          dependsOn: ['21.1'],
        }),
      ]);
      parsed.epics[0]!.contentHash = 'new-epic-hash';

      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const row = sqlite
        .prepare(`SELECT depends_on FROM stories WHERE story_key = '21.2'`)
        .get() as { depends_on: string | null };

      expect(row.depends_on).toBe('["21.1"]');
    });

    it('should set depends_on to NULL on update when dependsOn becomes empty', () => {
      const epicRow = db
        .insert(epics)
        .values({
          projectId,
          epicKey: '21',
          title: 'Epic 21',
          contentHash: 'old-epic-hash',
          sourceFile: 'test.md',
          orderIndex: 0,
        })
        .returning({ id: epics.id })
        .get();

      const sqlite = db.$client as DatabaseType;
      sqlite.prepare(
        `INSERT INTO stories (epic_id, story_key, title, content, content_hash, order_index, depends_on)
         VALUES (?, '21.2', 'Story 21.2', 'old content', 'old-hash', 0, '["21.1"]')`
      ).run(epicRow.id);

      // Update story with dependsOn: [] → should become NULL
      const parsed = makeEpic([
        makeStory('21.2', {
          contentHash: 'new-story-hash',
          orderIndex: 0,
          dependsOn: [],
        }),
      ]);
      parsed.epics[0]!.contentHash = 'new-epic-hash';

      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const row = sqlite
        .prepare(`SELECT depends_on FROM stories WHERE story_key = '21.2'`)
        .get() as { depends_on: string | null };

      expect(row.depends_on).toBeNull();
    });
  });

  // ─── Interaction: dangling + cycle ordering ──────────────────────────────────

  describe('interaction: cycle error takes precedence over dangling warning', () => {
    it('should throw LoadError (not succeed silently) when cycle exists even if dangling refs also present', () => {
      // 21.1 depends on 21.2 (cycle) and 99.9 (dangling)
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.2', '99.9'] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      expect(() => service.saveToDatabase(projectId, comparison, 'test.md')).toThrow(LoadError);
    });

    it('should not insert any stories when cycle + dangling ref coexist', () => {
      const parsed = makeEpic([
        makeStory('21.1', { contentHash: 'h1', orderIndex: 0, dependsOn: ['21.2', '99.9'] }),
        makeStory('21.2', { contentHash: 'h2', orderIndex: 1, dependsOn: ['21.1'] }),
      ]);
      const comparison = service.compareWithDatabase(projectId, parsed);

      try {
        service.saveToDatabase(projectId, comparison, 'test.md');
      } catch {
        // expected
      }

      expect(db.select().from(stories).all()).toHaveLength(0);
    });
  });
});
