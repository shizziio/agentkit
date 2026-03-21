import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories } from '@core/db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper type for PRAGMA table_info rows
interface PragmaColumn {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

describe('Migration 0006 — stories.depends_on column', () => {
  let db: DrizzleDB;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
  });

  // ─── AC1: Column exists after migration ─────────────────────────────────────

  describe('AC1: depends_on column exists after migration', () => {
    it('should have a depends_on column present in PRAGMA table_info(stories)', () => {
      const sqlite = db.$client as DatabaseType;
      const columns = sqlite
        .prepare(`PRAGMA table_info(stories)`)
        .all() as PragmaColumn[];

      const col = columns.find((c) => c.name === 'depends_on');
      expect(col).toBeDefined();
    });

    it('should have depends_on column with type TEXT', () => {
      const sqlite = db.$client as DatabaseType;
      const columns = sqlite
        .prepare(`PRAGMA table_info(stories)`)
        .all() as PragmaColumn[];

      const col = columns.find((c) => c.name === 'depends_on');
      expect(col?.type).toBe('TEXT');
    });

    it('should have depends_on column that is nullable (notnull=0)', () => {
      const sqlite = db.$client as DatabaseType;
      const columns = sqlite
        .prepare(`PRAGMA table_info(stories)`)
        .all() as PragmaColumn[];

      const col = columns.find((c) => c.name === 'depends_on');
      expect(col?.notnull).toBe(0);
    });

    it('should have depends_on column with no default value (dflt_value=null)', () => {
      const sqlite = db.$client as DatabaseType;
      const columns = sqlite
        .prepare(`PRAGMA table_info(stories)`)
        .all() as PragmaColumn[];

      const col = columns.find((c) => c.name === 'depends_on');
      expect(col?.dflt_value).toBeNull();
    });
  });

  // ─── AC2: Drizzle schema updated ─────────────────────────────────────────────

  describe('AC2: schema.ts updated — stories.dependsOn accessible via Drizzle ORM', () => {
    it('should include dependsOn key in the object returned by insert().returning().get()', () => {
      db.insert(projects).values({ projectName: 'schema-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'Epic 1', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story 1',
        orderIndex: 0,
      }).returning().get();

      expect(Object.keys(story)).toContain('dependsOn');
    });

    it('should default to null for dependsOn when not specified on insert', () => {
      db.insert(projects).values({ projectName: 'null-default' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story 1',
        orderIndex: 0,
      }).returning().get();

      expect(story.dependsOn).toBeNull();
    });

    it('should return dependsOn as string | null type (not undefined)', () => {
      db.insert(projects).values({ projectName: 'type-check' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story 1',
        orderIndex: 0,
        dependsOn: '["21.1"]',
      }).returning().get();

      expect(typeof story.dependsOn).toBe('string');
    });

    it('should return dependsOn on all rows from select().from(stories)', () => {
      db.insert(projects).values({ projectName: 'select-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S1', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S2', title: 'S2', orderIndex: 1, dependsOn: '["21.1"]' }).run();

      const rows = db.select().from(stories).all();

      expect(rows).toHaveLength(2);
      expect(rows[0]!.dependsOn).toBeNull();
      expect(rows[1]!.dependsOn).toBe('["21.1"]');
    });
  });

  // ─── AC3: 'waiting' status works ─────────────────────────────────────────────

  describe("AC3: 'waiting' status round-trips correctly", () => {
    it("should insert a story with status='waiting' without constraint violation", () => {
      db.insert(projects).values({ projectName: 'waiting-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      expect(() => {
        db.insert(stories).values({
          epicId: 1,
          storyKey: 'S1',
          title: 'Waiting Story',
          orderIndex: 0,
          status: 'waiting',
        }).run();
      }).not.toThrow();
    });

    it("should query back status='waiting' exactly after insert", () => {
      db.insert(projects).values({ projectName: 'waiting-roundtrip' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Waiting Story',
        orderIndex: 0,
        status: 'waiting',
      }).returning().get();

      expect(story.status).toBe('waiting');
    });

    it("should distinguish 'waiting' from 'draft' status — both can coexist", () => {
      db.insert(projects).values({ projectName: 'multi-status' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'Draft Story', orderIndex: 0, status: 'draft' }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S2', title: 'Waiting Story', orderIndex: 1, status: 'waiting' }).run();

      const rows = db.select().from(stories).all();

      expect(rows).toHaveLength(2);
      expect(rows[0]!.status).toBe('draft');
      expect(rows[1]!.status).toBe('waiting');
    });

    it("should persist status='waiting' via raw SQL as well (no constraint blocks it)", () => {
      const sqlite = db.$client as DatabaseType;

      sqlite.prepare(`INSERT INTO projects (project_name) VALUES ('raw-waiting')`).run();
      sqlite.prepare(`INSERT INTO epics (project_id, epic_key, title, order_index) VALUES (1, 'E1', 'E', 0)`).run();

      expect(() => {
        sqlite.prepare(
          `INSERT INTO stories (epic_id, story_key, title, order_index, status) VALUES (1, 'S1', 'Story', 0, 'waiting')`
        ).run();
      }).not.toThrow();

      const row = sqlite.prepare(`SELECT status FROM stories WHERE story_key = 'S1'`).get() as { status: string };
      expect(row.status).toBe('waiting');
    });
  });

  // ─── AC4: Existing stories unaffected ────────────────────────────────────────

  describe('AC4: existing stories have depends_on=NULL after migration, existing queries unaffected', () => {
    it('should set depends_on=NULL for rows that existed before the migration via raw simulation', () => {
      // Simulate pre-0006 state by manually building schema without depends_on
      const preDb = new Database(':memory:');

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
          order_index INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft'
        );
      `);

      // Insert rows before migration
      preDb.prepare(`INSERT INTO projects (project_name) VALUES ('legacy-proj')`).run();
      preDb.prepare(`INSERT INTO epics (project_id, epic_key, title, order_index) VALUES (1, 'E1', 'Epic 1', 0)`).run();
      preDb.prepare(`INSERT INTO stories (epic_id, story_key, title, order_index) VALUES (1, 'S1', 'Legacy Story 1', 0)`).run();
      preDb.prepare(`INSERT INTO stories (epic_id, story_key, title, order_index) VALUES (1, 'S2', 'Legacy Story 2', 1)`).run();

      // Apply migration 0006: nullable TEXT column, no default
      preDb.exec(`ALTER TABLE stories ADD COLUMN depends_on TEXT`);

      const rows = preDb.prepare(`SELECT story_key, depends_on FROM stories ORDER BY id ASC`).all() as {
        story_key: string;
        depends_on: string | null;
      }[];

      expect(rows).toHaveLength(2);
      expect(rows[0]!.depends_on).toBeNull();
      expect(rows[1]!.depends_on).toBeNull();

      preDb.close();
    });

    it('should allow SELECT queries on existing stories after migration without error', () => {
      // Stories inserted without depends_on must be queryable normally
      db.insert(projects).values({ projectName: 'compat-select' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'Old Story', orderIndex: 0 }).run();

      expect(() => {
        db.select().from(stories).all();
      }).not.toThrow();
    });

    it('should allow INSERT of new stories without specifying depends_on after migration', () => {
      db.insert(projects).values({ projectName: 'compat-insert' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      expect(() => {
        db.insert(stories).values({
          epicId: 1,
          storyKey: 'S1',
          title: 'New Story',
          orderIndex: 0,
        }).run();
      }).not.toThrow();
    });

    it('should have depends_on=NULL for stories inserted without depends_on after migration', () => {
      db.insert(projects).values({ projectName: 'null-after-migration' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story',
        orderIndex: 0,
      }).returning().get();

      expect(story.dependsOn).toBeNull();
    });
  });

  // ─── AC5: JSON array storage round-trip ──────────────────────────────────────

  describe('AC5: JSON array string stored and retrieved without transformation', () => {
    it('should store and retrieve a single-dependency JSON array string exactly', () => {
      db.insert(projects).values({ projectName: 'json-single' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story',
        orderIndex: 0,
        dependsOn: '["21.1"]',
      }).returning().get();

      expect(story.dependsOn).toBe('["21.1"]');
    });

    it('should store and retrieve a multi-dependency JSON array string exactly', () => {
      db.insert(projects).values({ projectName: 'json-multi' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story',
        orderIndex: 0,
        dependsOn: '["21.1","21.2"]',
      }).returning().get();

      expect(story.dependsOn).toBe('["21.1","21.2"]');
    });

    it('should store and retrieve an empty JSON array string exactly', () => {
      db.insert(projects).values({ projectName: 'json-empty' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story',
        orderIndex: 0,
        dependsOn: '[]',
      }).returning().get();

      expect(story.dependsOn).toBe('[]');
    });

    it('should not coerce or parse the JSON string — raw value round-trips', () => {
      const rawJson = '["21.1","21.2"]';

      db.insert(projects).values({ projectName: 'json-raw' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story',
        orderIndex: 0,
        dependsOn: rawJson,
      }).returning().get();

      // The DB layer must NOT parse it into an array — it must remain a string
      expect(typeof story.dependsOn).toBe('string');
      expect(story.dependsOn).toBe(rawJson);
      // Callers must JSON.parse themselves
      expect(JSON.parse(story.dependsOn!)).toEqual(['21.1', '21.2']);
    });

    it('should store depends_on alongside status=waiting — both values round-trip', () => {
      db.insert(projects).values({ projectName: 'json-waiting' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Story',
        orderIndex: 0,
        status: 'waiting',
        dependsOn: '["21.1"]',
      }).returning().get();

      expect(story.status).toBe('waiting');
      expect(story.dependsOn).toBe('["21.1"]');
    });
  });

  // ─── AC6: Journal entry ───────────────────────────────────────────────────────

  describe('AC6: _journal.json contains valid idx:6 entry for 0006_story_depends_on', () => {
    interface JournalEntry {
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }

    interface Journal {
      version: string;
      dialect: string;
      entries: JournalEntry[];
    }

    let journal: Journal;

    beforeEach(() => {
      const journalPath = path.resolve(
        __dirname,
        '../../../../src/core/db/migrations/meta/_journal.json'
      );
      journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as Journal;
    });

    it('should have an entry with idx=6', () => {
      const entry = journal.entries.find((e) => e.idx === 6);
      expect(entry).toBeDefined();
    });

    it('should have the tag "0006_story_depends_on" for idx=6', () => {
      const entry = journal.entries.find((e) => e.idx === 6);
      expect(entry?.tag).toBe('0006_story_depends_on');
    });

    it('should have breakpoints=true for idx=6 entry', () => {
      const entry = journal.entries.find((e) => e.idx === 6);
      expect(entry?.breakpoints).toBe(true);
    });

    it('should have a valid numeric timestamp (when) for idx=6 entry', () => {
      const entry = journal.entries.find((e) => e.idx === 6);
      expect(typeof entry?.when).toBe('number');
      expect(entry!.when).toBeGreaterThan(0);
    });

    it('should have exactly 7 total entries in the journal (idx 0 through 6)', () => {
      expect(journal.entries).toHaveLength(7);
    });
  });

  // ─── Idempotency ─────────────────────────────────────────────────────────────

  describe('idempotency: runMigrations does not re-apply 0006', () => {
    it('should not throw when runMigrations is called a second time on migrated DB', () => {
      expect(() => runMigrations(db)).not.toThrow();
    });

    it('should return applied=0 when called on an already-migrated database', () => {
      const result = runMigrations(db);
      expect(result.applied).toBe(0);
    });

    it('should track exactly 7 migrations in __drizzle_migrations after 0006 applied (0000-0006)', () => {
      const sqlite = db.$client as DatabaseType;
      const result = sqlite
        .prepare(`SELECT COUNT(*) as count FROM __drizzle_migrations`)
        .get() as { count: number };

      expect(result.count).toBe(7);
    });

    it('should preserve story data (including depends_on) across repeated runMigrations calls', () => {
      db.insert(projects).values({ projectName: 'persist-test' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'S1',
        orderIndex: 0,
        dependsOn: '["21.1"]',
      }).run();

      runMigrations(db); // second run

      const all = db.select().from(stories).all();
      expect(all).toHaveLength(1);
      expect(all[0]!.dependsOn).toBe('["21.1"]');
    });

    it('should not create duplicate column error on second migration run — Drizzle tracks applied migrations', () => {
      // If Drizzle correctly uses __drizzle_migrations, it will skip 0006 on second run.
      // A failure here means migration tracking is broken.
      expect(() => {
        runMigrations(db);
        runMigrations(db);
      }).not.toThrow();
    });
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should allow NULL explicitly for depends_on (it is nullable)', () => {
      db.insert(projects).values({ projectName: 'explicit-null' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const sqlite = db.$client as DatabaseType;

      expect(() => {
        sqlite.prepare(
          `INSERT INTO stories (epic_id, story_key, title, order_index, depends_on) VALUES (1, 'S-null', 'Story', 0, NULL)`
        ).run();
      }).not.toThrow();

      const row = sqlite.prepare(`SELECT depends_on FROM stories WHERE story_key = 'S-null'`).get() as {
        depends_on: string | null;
      };
      expect(row.depends_on).toBeNull();
    });

    it('should succeed applying ALTER TABLE on empty table (migration on freshly created DB)', () => {
      // In beforeEach, migrations run on an empty DB — verify stories table has depends_on
      const sqlite = db.$client as DatabaseType;
      const columns = sqlite.prepare(`PRAGMA table_info(stories)`).all() as PragmaColumn[];
      const col = columns.find((c) => c.name === 'depends_on');
      expect(col).toBeDefined();
    });

    it('should accept non-JSON string values for depends_on — no format validation at DB layer', () => {
      // The schema must NOT enforce JSON format — callers handle parsing
      db.insert(projects).values({ projectName: 'non-json' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const sqlite = db.$client as DatabaseType;

      expect(() => {
        sqlite.prepare(
          `INSERT INTO stories (epic_id, story_key, title, order_index, depends_on) VALUES (1, 'S1', 'Story', 0, 'not-json')`
        ).run();
      }).not.toThrow();
    });

    it("should treat 'WAITING' and 'Wait' as different values from 'waiting' — no normalisation", () => {
      // No CHECK constraint means any string passes — callers must guard against typos
      const sqlite = db.$client as DatabaseType;
      sqlite.prepare(`INSERT INTO projects (project_name) VALUES ('case-test')`).run();
      sqlite.prepare(`INSERT INTO epics (project_id, epic_key, title, order_index) VALUES (1, 'E1', 'E', 0)`).run();
      sqlite.prepare(`INSERT INTO stories (epic_id, story_key, title, order_index, status) VALUES (1, 'S1', 'S1', 0, 'WAITING')`).run();

      const row = sqlite.prepare(`SELECT status FROM stories WHERE story_key = 'S1'`).get() as { status: string };
      expect(row.status).toBe('WAITING'); // stored as-is, not normalised
      expect(row.status).not.toBe('waiting');
    });

    it('should include dependsOn as optional key in NewStory insert payload (undefined = omitted = NULL)', () => {
      // TypeScript: dependsOn should be optional in NewStory (string | null | undefined)
      // Verify at runtime that omitting it results in NULL in DB
      db.insert(projects).values({ projectName: 'optional-key' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      // Deliberately not passing dependsOn at all
      const payload = {
        epicId: 1,
        storyKey: 'S1',
        title: 'Story',
        orderIndex: 0,
        // dependsOn intentionally absent
      };

      const story = db.insert(stories).values(payload).returning().get();
      expect(story.dependsOn).toBeNull();
    });

    it('should allow a story to have both depends_on set and status=waiting simultaneously', () => {
      db.insert(projects).values({ projectName: 'combined' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();

      const story = db.insert(stories).values({
        epicId: 1,
        storyKey: 'S1',
        title: 'Blocked Story',
        orderIndex: 0,
        status: 'waiting',
        dependsOn: '["21.1","21.2"]',
      }).returning().get();

      expect(story.status).toBe('waiting');
      expect(story.dependsOn).toBe('["21.1","21.2"]');
    });
  });
});
