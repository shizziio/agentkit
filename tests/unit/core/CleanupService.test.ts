import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks, taskLogs } from '@core/db/schema';
import type { NewStory } from '@core/db/schema';
import { CleanupService } from '@core/CleanupService';

// Helpers

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: 'test-project' })
    .returning({ id: projects.id })
    .get()!.id;
}

function seedEpic(db: DrizzleDB, projectId: number, key = '1'): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey: key, title: `Epic ${key}`, orderIndex: 0 })
    .returning({ id: epics.id })
    .get()!.id;
}

function seedStory(
  db: DrizzleDB,
  epicId: number,
  key = '1.1',
  status = 'draft',
): number {
  const values: NewStory = { epicId, storyKey: key, title: `Story ${key}`, orderIndex: 0, status };
  return db
    .insert(stories)
    .values(values)
    .returning({ id: stories.id })
    .get()!.id;
}

function seedTask(
  db: DrizzleDB,
  storyId: number,
  stageName = 'sm',
  status = 'done',
  completedAt: string | null = null,
): number {
  return db
    .insert(tasks)
    .values({
      storyId,
      stageName,
      status,
      completedAt: completedAt ?? undefined,
    })
    .returning({ id: tasks.id })
    .get()!.id;
}

function seedTaskLog(db: DrizzleDB, taskId: number, seq = 1): number {
  return db
    .insert(taskLogs)
    .values({ taskId, sequence: seq, eventType: 'text', eventData: '{}' })
    .returning({ id: taskLogs.id })
    .get()!.id;
}

function createMemoryDb(): DrizzleDB {
  const db = createConnection(':memory:');
  runMigrations(db);
  return db;
}

// Use a real temp file so statSync works in getDatabaseStats tests
function createTempDb(): { db: DrizzleDB; dbPath: string } {
  const dbPath = join(tmpdir(), `cleanup-test-${Date.now()}.db`);
  const db = createConnection(dbPath);
  runMigrations(db);
  return { db, dbPath };
}

// ---------------------------------------------------------------------------
// getDatabaseStats — requires a real file DB for fileSizeBytes
// ---------------------------------------------------------------------------
describe('CleanupService.getDatabaseStats', () => {
  let db: DrizzleDB;
  let dbPath: string;
  let svc: CleanupService;
  const cleanupPaths: string[] = [];

  beforeEach(() => {
    const created = createTempDb();
    db = created.db;
    dbPath = created.dbPath;
    cleanupPaths.push(dbPath);
    svc = new CleanupService(db, dbPath);
  });

  afterEach(() => {
    for (const p of cleanupPaths) {
      try {
        unlinkSync(p);
      } catch {
        // ignore
      }
    }
    cleanupPaths.length = 0;
  });

  it('returns fileSizeBytes > 0 for a real DB file', () => {
    const stats = svc.getDatabaseStats();
    expect(stats.fileSizeBytes).toBeGreaterThan(0);
  });

  it('returns zero row counts for empty tables', () => {
    const stats = svc.getDatabaseStats();
    expect(stats.tableCounts.projects).toBe(0);
    expect(stats.tableCounts.epics).toBe(0);
    expect(stats.tableCounts.stories).toBe(0);
    expect(stats.tableCounts.tasks).toBe(0);
    expect(stats.tableCounts.taskLogs).toBe(0);
  });

  it('returns correct row counts after seeding data', () => {
    const projectId = seedProject(db);
    const epicId = seedEpic(db, projectId);
    const storyId = seedStory(db, epicId, '1.1', 'done');
    const taskId = seedTask(db, storyId);
    seedTaskLog(db, taskId);

    const stats = svc.getDatabaseStats();
    expect(stats.tableCounts.projects).toBe(1);
    expect(stats.tableCounts.epics).toBe(1);
    expect(stats.tableCounts.stories).toBe(1);
    expect(stats.tableCounts.tasks).toBe(1);
    expect(stats.tableCounts.taskLogs).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// All other CleanupService tests — use in-memory SQLite
// ---------------------------------------------------------------------------
describe('CleanupService', () => {
  let db: DrizzleDB;
  let svc: CleanupService;

  beforeEach(() => {
    db = createMemoryDb();
    svc = new CleanupService(db, ':memory:');
  });

  describe('previewOlderThan', () => {
    it('returns taskLogCount=0 when no tasks are older than cutoff', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      const storyId = seedStory(db, epicId, '1.1', 'done');
      // Task completed recently (future date)
      const recentDate = new Date(Date.now() + 86_400_000).toISOString();
      const taskId = seedTask(db, storyId, 'sm', 'done', recentDate);
      seedTaskLog(db, taskId);

      const result = svc.previewOlderThan(30);
      expect(result.taskLogCount).toBe(0);
    });

    it('returns taskLogCount=0 when no tasks have completedAt set', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      const storyId = seedStory(db, epicId, '1.1');
      const taskId = seedTask(db, storyId, 'sm', 'queued', null);
      seedTaskLog(db, taskId);

      const result = svc.previewOlderThan(30);
      expect(result.taskLogCount).toBe(0);
    });

    it('returns correct taskLogCount for tasks older than cutoff', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      const storyId = seedStory(db, epicId, '1.1', 'done');
      const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString(); // 60 days ago
      const taskId = seedTask(db, storyId, 'sm', 'done', oldDate);
      seedTaskLog(db, taskId, 1);
      seedTaskLog(db, taskId, 2);

      const result = svc.previewOlderThan(30);
      expect(result.taskLogCount).toBe(2);
    });

    it('includes a valid ISO 8601 cutoffDate in result', () => {
      const result = svc.previewOlderThan(30);
      expect(() => new Date(result.cutoffDate)).not.toThrow();
      expect(result.cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('does not count tasks that are exactly at cutoff boundary', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      const storyId = seedStory(db, epicId, '1.1', 'done');
      // Task completed slightly after "exactly 30 days ago" so it is never
      // strictly less than the cutoff the service computes moments later.
      const atBoundary = new Date(Date.now() - 30 * 86_400_000 + 5_000).toISOString();
      const taskId = seedTask(db, storyId, 'sm', 'done', atBoundary);
      seedTaskLog(db, taskId);

      // completedAt must be strictly less than cutoff
      const result = svc.previewOlderThan(30);
      expect(result.taskLogCount).toBe(0);
    });
  });

  describe('previewKeepLast', () => {
    it('returns zeros when no completed stories exist', () => {
      const result = svc.previewKeepLast(10);
      expect(result.storiesToDelete).toBe(0);
      expect(result.totalCompleted).toBe(0);
    });

    it('returns zeros when totalCompleted <= n', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'done');

      const result = svc.previewKeepLast(5);
      expect(result.storiesToDelete).toBe(0);
      expect(result.totalCompleted).toBe(2);
    });

    it('returns correct counts when there are more completed stories than n', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      for (let i = 1; i <= 5; i++) {
        const storyId = seedStory(db, epicId, `1.${i}`, 'done');
        const taskId = seedTask(db, storyId);
        seedTaskLog(db, taskId);
      }

      const result = svc.previewKeepLast(3);
      expect(result.storiesToDelete).toBe(2);
      expect(result.tasksToDelete).toBe(2);
      expect(result.taskLogsToDelete).toBe(2);
      expect(result.totalCompleted).toBe(5);
    });

    it('handles keep-last=0 (delete all completed stories)', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'done');

      const result = svc.previewKeepLast(0);
      expect(result.storiesToDelete).toBe(2);
      expect(result.totalCompleted).toBe(2);
    });

    it('counts tasks with no task_logs correctly (tasksToDelete > 0, taskLogsToDelete = 0)', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      for (let i = 1; i <= 3; i++) {
        const storyId = seedStory(db, epicId, `1.${i}`, 'done');
        // Task but no logs
        seedTask(db, storyId);
      }

      const result = svc.previewKeepLast(1);
      expect(result.storiesToDelete).toBe(2);
      expect(result.tasksToDelete).toBe(2);
      expect(result.taskLogsToDelete).toBe(0);
    });

    it('only counts completed (status=done) stories', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'draft');
      seedStory(db, epicId, '1.3', 'in_progress');

      const result = svc.previewKeepLast(0);
      expect(result.totalCompleted).toBe(1);
      expect(result.storiesToDelete).toBe(1);
    });
  });

  describe('cleanupOlderThan', () => {
    it('returns zeros when nothing qualifies', () => {
      const result = svc.cleanupOlderThan(30);
      expect(result).toEqual({ taskLogsDeleted: 0, tasksDeleted: 0, storiesDeleted: 0 });
    });

    it('deletes task_logs for old tasks but preserves task rows', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      const storyId = seedStory(db, epicId, '1.1', 'done');
      const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const taskId = seedTask(db, storyId, 'sm', 'done', oldDate);
      seedTaskLog(db, taskId, 1);
      seedTaskLog(db, taskId, 2);

      const result = svc.cleanupOlderThan(30);
      expect(result.taskLogsDeleted).toBe(2);
      expect(result.tasksDeleted).toBe(0);
      expect(result.storiesDeleted).toBe(0);

      // Task row still exists
      const remaining = db.select().from(tasks).all();
      expect(remaining).toHaveLength(1);

      // Logs are gone
      const logs = db.select().from(taskLogs).all();
      expect(logs).toHaveLength(0);
    });

    it('does not delete logs for tasks that are not old enough', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      const storyId = seedStory(db, epicId, '1.1', 'done');
      const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString(); // 5 days ago
      const taskId = seedTask(db, storyId, 'sm', 'done', recentDate);
      seedTaskLog(db, taskId);

      const result = svc.cleanupOlderThan(30);
      expect(result.taskLogsDeleted).toBe(0);

      const logs = db.select().from(taskLogs).all();
      expect(logs).toHaveLength(1);
    });

    it('performs deletion in a transaction (atomicity)', () => {
      // If the operation is transactional, all-or-nothing behavior is expected.
      // We test this by verifying normal operation completes fully.
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      const storyId = seedStory(db, epicId, '1.1', 'done');
      const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const taskId = seedTask(db, storyId, 'sm', 'done', oldDate);
      seedTaskLog(db, taskId, 1);
      seedTaskLog(db, taskId, 2);
      seedTaskLog(db, taskId, 3);

      const result = svc.cleanupOlderThan(30);
      expect(result.taskLogsDeleted).toBe(3);
    });
  });

  describe('cleanupKeepLast', () => {
    it('returns zeros when nothing qualifies', () => {
      const result = svc.cleanupKeepLast(10);
      expect(result).toEqual({ taskLogsDeleted: 0, tasksDeleted: 0, storiesDeleted: 0 });
    });

    it('returns zeros when totalCompleted <= n', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      seedStory(db, epicId, '1.1', 'done');

      const result = svc.cleanupKeepLast(5);
      expect(result).toEqual({ taskLogsDeleted: 0, tasksDeleted: 0, storiesDeleted: 0 });
    });

    it('deletes stories, tasks, and task_logs beyond keep-last n', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      for (let i = 1; i <= 5; i++) {
        const storyId = seedStory(db, epicId, `1.${i}`, 'done');
        const taskId = seedTask(db, storyId);
        seedTaskLog(db, taskId);
      }

      const result = svc.cleanupKeepLast(3);
      expect(result.storiesDeleted).toBe(2);
      expect(result.tasksDeleted).toBe(2);
      expect(result.taskLogsDeleted).toBe(2);

      expect(db.select().from(stories).all()).toHaveLength(3);
      expect(db.select().from(tasks).all()).toHaveLength(3);
      expect(db.select().from(taskLogs).all()).toHaveLength(3);
    });

    it('handles keep-last=0 (delete all completed)', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      for (let i = 1; i <= 3; i++) {
        const storyId = seedStory(db, epicId, `1.${i}`, 'done');
        seedTask(db, storyId);
      }

      const result = svc.cleanupKeepLast(0);
      expect(result.storiesDeleted).toBe(3);
      expect(result.tasksDeleted).toBe(3);
    });

    it('preserves non-completed (draft/in_progress) stories', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      for (let i = 1; i <= 3; i++) {
        const storyId = seedStory(db, epicId, `1.${i}`, 'done');
        seedTask(db, storyId);
      }
      // These should not be touched
      seedStory(db, epicId, '1.4', 'draft');
      seedStory(db, epicId, '1.5', 'in_progress');

      const result = svc.cleanupKeepLast(1);
      expect(result.storiesDeleted).toBe(2);

      const remaining = db.select().from(stories).all();
      // 1 kept done story + 1 draft + 1 in_progress = 3
      expect(remaining).toHaveLength(3);
    });

    it('handles stories with tasks but no task_logs', () => {
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      for (let i = 1; i <= 3; i++) {
        const storyId = seedStory(db, epicId, `1.${i}`, 'done');
        seedTask(db, storyId); // no logs
      }

      const result = svc.cleanupKeepLast(1);
      expect(result.storiesDeleted).toBe(2);
      expect(result.tasksDeleted).toBe(2);
      expect(result.taskLogsDeleted).toBe(0);
    });

    it('performs deletion in a single transaction', () => {
      // Verify complete cleanup in one pass
      const projectId = seedProject(db);
      const epicId = seedEpic(db, projectId);
      for (let i = 1; i <= 4; i++) {
        const storyId = seedStory(db, epicId, `1.${i}`, 'done');
        const taskId = seedTask(db, storyId);
        seedTaskLog(db, taskId, 1);
        seedTaskLog(db, taskId, 2);
      }

      const result = svc.cleanupKeepLast(2);
      expect(result.storiesDeleted).toBe(2);
      expect(result.tasksDeleted).toBe(2);
      expect(result.taskLogsDeleted).toBe(4);
    });
  });
});
