import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';

import { createConnection } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks, taskLogs } from '@core/db/schema';

describe('RunMigrations', () => {
  describe('with in-memory database', () => {
    it('should create all tables and indexes', () => {
      const db = createConnection(':memory:');
      runMigrations(db);

      // safe: $client is always a better-sqlite3 Database instance when using the better-sqlite3 driver
      const sqlite = db.$client as Database.Database;
      const tables = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`)
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('projects');
      expect(tableNames).toContain('epics');
      expect(tableNames).toContain('stories');
      expect(tableNames).toContain('tasks');
      expect(tableNames).toContain('task_logs');
    });

    it('should create all required indexes', () => {
      const db = createConnection(':memory:');
      runMigrations(db);

      // safe: $client is always a better-sqlite3 Database instance when using the better-sqlite3 driver
      const sqlite = db.$client as Database.Database;
      const indexes = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`)
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('uq_epics_project_epic');
      expect(indexNames).toContain('uq_stories_epic_story');
      expect(indexNames).toContain('projects_project_name_unique');
      expect(indexNames).toContain('idx_tasks_stage_status');
      expect(indexNames).toContain('idx_task_logs_task_sequence');
    });

    it('should create all columns with correct types', () => {
      const db = createConnection(':memory:');
      runMigrations(db);

      // Insert test data to verify columns work
      const project = db.insert(projects).values({ projectName: 'test' }).returning().get();
      expect(project).toBeDefined();
      expect(project.id).toBeDefined();
      expect(project.projectName).toBe('test');
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
      expect(project.version).toBe(1);
    });

    it('should support all necessary operations after migration', () => {
      const db = createConnection(':memory:');
      runMigrations(db);

      // Test full workflow: project -> epic -> story -> task -> logs
      const proj = db.insert(projects).values({ projectName: 'workflow' }).returning().get();
      expect(proj.id).toBeDefined();

      const epic = db.insert(epics).values({
        projectId: proj.id,
        epicKey: 'E1',
        title: 'Epic 1',
        orderIndex: 0,
      }).returning().get();
      expect(epic.id).toBeDefined();

      const story = db.insert(stories).values({
        epicId: epic.id,
        storyKey: 'S1',
        title: 'Story 1',
        orderIndex: 0,
      }).returning().get();
      expect(story.id).toBeDefined();

      const task = db.insert(tasks).values({
        storyId: story.id,
        stageName: 'dev',
      }).returning().get();
      expect(task.id).toBeDefined();

      const log = db.insert(taskLogs).values({
        taskId: task.id,
        sequence: 1,
        eventType: 'text',
        eventData: '{"content":"test"}',
      }).returning().get();
      expect(log.id).toBeDefined();
    });
  });

  describe('with file-based database', () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkit-migrations-test-'));
      dbPath = path.join(tmpDir, 'test.sqlite');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should run migrations on file database and create schema', () => {
      const db = createConnection(dbPath);
      runMigrations(db);

      expect(fs.existsSync(dbPath)).toBe(true);

      // Verify tables were created
      const project = db.insert(projects).values({ projectName: 'file-test' }).returning().get();
      expect(project.id).toBeDefined();
    });

    it('should be idempotent - can run twice without errors', () => {
      const db = createConnection(dbPath);

      // First run
      expect(() => {
        runMigrations(db);
      }).not.toThrow();

      // Second run - should be idempotent
      expect(() => {
        runMigrations(db);
      }).not.toThrow();

      // Verify database still works
      const project = db.insert(projects).values({ projectName: 'idempotent' }).returning().get();
      expect(project.id).toBeDefined();
    });

    it('should persist data across reconnection', () => {
      // First connection and migration
      let db = createConnection(dbPath);
      runMigrations(db);

      db.insert(projects).values({ projectName: 'persisted' }).run();

      // Close and reconnect
      const sqlite = db.$client as Database.Database;
      sqlite.close();

      // New connection to same file
      db = createConnection(dbPath);
      runMigrations(db);

      const project = db.select().from(projects)
        .all()
        .find((p) => p.projectName === 'persisted');

      expect(project?.projectName).toBe('persisted');
    });
  });

  describe('migration schema compliance', () => {
    let db: any;

    beforeEach(() => {
      db = createConnection(':memory:');
      runMigrations(db);
    });

    it('should enforce foreign key constraints from migration', () => {
      // Try to insert epic with non-existent project
      expect(() => {
        db.insert(epics).values({
          projectId: 999,
          epicKey: 'BAD',
          title: 'Bad',
          orderIndex: 0,
        }).run();
      }).toThrow();
    });

    it('should enforce unique constraints from migration', () => {
      db.insert(projects).values({ projectName: 'unique-test' }).run();

      expect(() => {
        db.insert(projects).values({ projectName: 'unique-test' }).run();
      }).toThrow();
    });

    it('should apply default values from migration', () => {
      const project = db.insert(projects).values({ projectName: 'defaults' }).returning().get();

      expect(project.activeTeam).toBe('agentkit');
      expect(project.version).toBe(1);
      expect(project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it('should have NOT NULL constraints from migration', () => {
      // Verify required fields
      expect(() => {
        db.insert(projects).values({ projectName: null }).run();
      }).toThrow();

      db.insert(projects).values({ projectName: 'test' }).run();
      expect(() => {
        db.insert(epics).values({
          projectId: 1,
          epicKey: null,
          title: 'Title',
          orderIndex: 0,
        }).run();
      }).toThrow();
    });
  });

  describe('drizzle migration tracking', () => {
    it('should create __drizzle_migrations table for tracking', () => {
      const db = createConnection(':memory:');
      runMigrations(db);

      // safe: $client is always a better-sqlite3 Database instance when using the better-sqlite3 driver
      const sqlite = db.$client as Database.Database;
      const tables = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__drizzle%'`)
        .all() as { name: string }[];

      // Drizzle should create migration tracking tables
      expect(tables.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should handle running migrations on already-migrated database gracefully', () => {
      const db = createConnection(':memory:');

      // First migration
      runMigrations(db);

      // Insert some data
      db.insert(projects).values({ projectName: 'data' }).run();

      // Run migrations again
      expect(() => {
        runMigrations(db);
      }).not.toThrow();

      // Data should still exist
      const count = db.select().from(projects).all().length;
      expect(count).toBe(1);
    });
  });
});
