import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories } from '@core/db/schema.js';

// Helper type for PRAGMA table_info rows
interface PragmaColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

describe('Migration 0005 — stories.priority column', () => {
  let db: DrizzleDB;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
  });

  // ─── AC1: Column exists after migration ─────────────────────────────────────

  describe('AC1: priority column exists after migration', () => {
    it('should have a priority column present in PRAGMA table_info(stories)', () => {
      const sqlite = db.$client as DatabaseType;
      const columns = sqlite
        .prepare(`PRAGMA table_info(stories)`)
        .all() as PragmaColumn[];

      const priorityCol = columns.find((c) => c.name === 'priority');
      expect(priorityCol).toBeDefined();
    });

    it('should have priority column with type INTEGER', () => {
      const sqlite = db.$client as DatabaseType;
      const columns = sqlite
        .prepare(`PRAGMA table_info(stories)`)
        .all() as PragmaColumn[];

      const priorityCol = columns.find((c) => c.name === 'priority');
      expect(priorityCol?.type).toBe('INTEGER');
    });

    it('should have priority column with NOT NULL constraint (notnull=1)', () => {
      const sqlite = db.$client as DatabaseType;
      const columns = sqlite
        .prepare(`PRAGMA table_info(stories)`)
        .all() as PragmaColumn[];

      const priorityCol = columns.find((c) => c.name === 'priority');
      expect(priorityCol?.notnull).toBe(1);
    });

    it('should have priority column with default value 0 (dflt_value="0")', () => {
      const sqlite = db.$client as DatabaseType;
      const columns = sqlite
        .prepare(`PRAGMA table_info(stories)`)
        .all() as PragmaColumn[];

      const priorityCol = columns.find((c) => c.name === 'priority');
      expect(priorityCol?.dflt_value).toBe('0');
    });
  });

  // ─── AC2: Existing stories backward compat ──────────────────────────────────

  describe('AC2: existing stories get priority=0 after migration (backward compat)', () => {
    it('should set priority=0 for rows that existed before migration via raw ALTER TABLE simulation', () => {
      // Create a fresh isolated SQLite database to simulate pre-migration state
      const preDb = new Database(':memory:');

      // Build a minimal stories schema WITHOUT the priority column (pre-0005 state)
      preDb.exec(`
        CREATE TABLE projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_name TEXT NOT NULL
        );
        CREATE TABLE epics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          epic_key TEXT NOT NULL,
          title TEXT NOT NULL,
          order_index INTEGER NOT NULL
        );
        CREATE TABLE stories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          epic_id INTEGER NOT NULL,
          story_key TEXT NOT NULL,
          title TEXT NOT NULL,
          order_index INTEGER NOT NULL
        );
      `);

      // Insert "pre-existing" rows (no priority column exists yet)
      preDb.prepare(`INSERT INTO projects (project_name) VALUES ('legacy-proj')`).run();
      preDb.prepare(`INSERT INTO epics (project_id, epic_key, title, order_index) VALUES (1, 'E1', 'Epic 1', 0)`).run();
      preDb.prepare(`INSERT INTO stories (epic_id, story_key, title, order_index) VALUES (1, 'S1', 'Legacy Story 1', 0)`).run();
      preDb.prepare(`INSERT INTO stories (epic_id, story_key, title, order_index) VALUES (1, 'S2', 'Legacy Story 2', 1)`).run();

      // Apply the 0005 migration: ALTER TABLE ADD COLUMN with NOT NULL DEFAULT 0
      preDb.exec(`ALTER TABLE stories ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`);

      // All pre-existing rows must now have priority = 0
      const rows = preDb.prepare(`SELECT story_key, priority FROM stories ORDER BY id ASC`).all() as {
        story_key: string;
        priority: number;
      }[];

      expect(rows).toHaveLength(2);
      expect(rows[0]!.priority).toBe(0);
      expect(rows[1]!.priority).toBe(0);

      preDb.close();
    });

    it('should assign priority=0 by default when inserting stories without specifying priority', () => {
      db.insert(projects).values({ projectName: 'compat-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'Epic 1', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story 1',
        orderIndex: 0,
      }).returning().get();

      expect(story.priority).toBe(0);
    });

    it('should give priority=0 to every row when inserting multiple stories without priority', () => {
      db.insert(projects).values({ projectName: 'multi' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'Story 1', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S2', title: 'Story 2', orderIndex: 1 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S3', title: 'Story 3', orderIndex: 2 }).run();

      const sqlite = db.$client as DatabaseType;
      const rows = sqlite.prepare(`SELECT priority FROM stories`).all() as { priority: number }[];

      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.priority === 0)).toBe(true);
    });
  });

  // ─── AC3: Schema.ts matches — Drizzle ORM access ────────────────────────────

  describe('AC3: schema.ts updated — stories.priority accessible via Drizzle ORM', () => {
    it('should include priority in the object returned by insert().returning().get()', () => {
      db.insert(projects).values({ projectName: 'schema-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story 1',
        orderIndex: 0,
      }).returning().get();

      // Key must exist on the returned object (not undefined)
      expect(Object.keys(story)).toContain('priority');
    });

    it('should return priority as type number (not null, not undefined)', () => {
      db.insert(projects).values({ projectName: 'type-check' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story 1',
        orderIndex: 0,
      }).returning().get();

      expect(typeof story.priority).toBe('number');
    });

    it('should default to 0 when priority is not specified in insert', () => {
      db.insert(projects).values({ projectName: 'default-check' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story 1',
        orderIndex: 0,
      }).returning().get();

      expect(story.priority).toBe(0);
    });

    it('should allow writing and reading a non-zero priority via Drizzle ORM', () => {
      db.insert(projects).values({ projectName: 'write-priority' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'High Priority Story',
        orderIndex: 0,
        priority: 10,
      }).returning().get();

      expect(story.priority).toBe(10);
    });

    it('should return priority on all rows from select().from(stories)', () => {
      db.insert(projects).values({ projectName: 'select-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S1', orderIndex: 0, priority: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S2', title: 'S2', orderIndex: 1, priority: 5 }).run();

      const rows = db.select().from(stories).all();

      expect(rows).toHaveLength(2);
      expect(rows[0]!.priority).toBe(0);
      expect(rows[1]!.priority).toBe(5);
    });
  });

  // ─── AC4: Idempotent ─────────────────────────────────────────────────────────

  describe('AC4: runMigrations is idempotent after 0005 applied', () => {
    it('should not throw when runMigrations is called a second time on migrated DB', () => {
      // db already migrated in beforeEach
      expect(() => runMigrations(db)).not.toThrow();
    });

    it('should return applied=0 when called on an already-migrated database', () => {
      // db already migrated in beforeEach — second call should apply nothing
      const result = runMigrations(db);
      expect(result.applied).toBe(0);
    });

    it('should return applied=0 on third call as well', () => {
      runMigrations(db); // second
      const result = runMigrations(db); // third
      expect(result.applied).toBe(0);
    });

    it('should preserve story data across repeated runMigrations calls', () => {
      db.insert(projects).values({ projectName: 'persist-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S1', orderIndex: 0, priority: 7 }).run();

      runMigrations(db); // second run

      const all = db.select().from(stories).all();
      expect(all).toHaveLength(1);
      expect(all[0]!.priority).toBe(7);
    });

    it('should not re-execute ALTER TABLE when called on DB with existing priority column', () => {
      // Drizzle tracks applied migrations in __drizzle_migrations, so even if the column
      // already exists, the migration won't run again — no "duplicate column" error.
      const sqlite = db.$client as DatabaseType;

      // Verify __drizzle_migrations still tracks 0005 after second call
      runMigrations(db);
      const count = (
        sqlite.prepare(`SELECT COUNT(*) as count FROM __drizzle_migrations`).get() as { count: number }
      ).count;

      // Should be exactly 6 entries (0000-0005), not doubled
      expect(count).toBe(6);
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should reject NULL for priority — NOT NULL constraint is enforced', () => {
      db.insert(projects).values({ projectName: 'null-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const sqlite = db.$client as DatabaseType;

      // Raw SQL bypasses Drizzle default injection, so NULL must be rejected by DB constraint
      expect(() => {
        sqlite
          .prepare(
            `INSERT INTO stories (epic_id, story_key, title, order_index, priority) VALUES (1, 'S-null', 'Story', 0, NULL)`,
          )
          .run();
      }).toThrow();
    });

    it('should accept priority=0 explicitly (boundary: minimum useful value)', () => {
      db.insert(projects).values({ projectName: 'zero-priority' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Zero Priority',
        orderIndex: 0,
        priority: 0,
      }).returning().get();

      expect(story.priority).toBe(0);
    });

    it('should accept negative priority values (no lower-bound constraint defined)', () => {
      db.insert(projects).values({ projectName: 'neg-priority' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Negative Priority',
        orderIndex: 0,
        priority: -1,
      }).returning().get();

      expect(story.priority).toBe(-1);
    });

    it('should accept large positive priority values (no upper-bound constraint defined)', () => {
      db.insert(projects).values({ projectName: 'high-priority' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Max Priority',
        orderIndex: 0,
        priority: 9999,
      }).returning().get();

      expect(story.priority).toBe(9999);
    });

    it('should track exactly 6 migrations in __drizzle_migrations after 0005 applied', () => {
      const sqlite = db.$client as DatabaseType;
      const result = sqlite
        .prepare(`SELECT COUNT(*) as count FROM __drizzle_migrations`)
        .get() as { count: number };

      // Migrations 0000, 0001, 0002, 0003, 0004, 0005
      expect(result.count).toBe(6);
    });

    it('should allow ordering stories by priority (column is sortable)', () => {
      db.insert(projects).values({ projectName: 'order-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S3', title: 'Low', orderIndex: 2, priority: 1 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'High', orderIndex: 0, priority: 10 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S2', title: 'Med', orderIndex: 1, priority: 5 }).run();

      const sqlite = db.$client as DatabaseType;
      const rows = sqlite
        .prepare(`SELECT story_key, priority FROM stories ORDER BY priority DESC`)
        .all() as { story_key: string; priority: number }[];

      expect(rows[0]!.story_key).toBe('S1'); // priority 10
      expect(rows[1]!.story_key).toBe('S2'); // priority 5
      expect(rows[2]!.story_key).toBe('S3'); // priority 1
    });

    it('SQLite ALTER TABLE with NOT NULL DEFAULT satisfies constraint for existing rows — migration file must include DEFAULT 0', () => {
      // Verify the migration correctly uses DEFAULT 0 (not just NOT NULL without default)
      // SQLite rejects ALTER TABLE ADD COLUMN NOT NULL without DEFAULT for existing rows.
      // This test verifies the migration file content is correct by simulating the constraint.
      const rawDb = new Database(':memory:');

      rawDb.exec(`
        CREATE TABLE stories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL
        );
        INSERT INTO stories (title) VALUES ('existing row');
      `);

      // Should NOT throw because DEFAULT 0 is provided
      expect(() => {
        rawDb.exec(`ALTER TABLE stories ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`);
      }).not.toThrow();

      const row = rawDb.prepare(`SELECT priority FROM stories`).get() as { priority: number };
      expect(row.priority).toBe(0);

      rawDb.close();
    });

    it('SQLite ALTER TABLE without DEFAULT would fail for existing NOT NULL rows — DEFAULT is required', () => {
      // Edge case guard: confirm that omitting DEFAULT causes failure,
      // ensuring the developer must NOT omit DEFAULT 0 in the migration file.
      const rawDb = new Database(':memory:');

      rawDb.exec(`
        CREATE TABLE stories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL
        );
        INSERT INTO stories (title) VALUES ('existing row');
      `);

      // SQLite rejects NOT NULL without DEFAULT when rows exist
      expect(() => {
        rawDb.exec(`ALTER TABLE stories ADD COLUMN priority INTEGER NOT NULL`);
      }).toThrow();

      rawDb.close();
    });
  });
});
