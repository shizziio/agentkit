import { describe, it, expect, beforeEach } from 'vitest';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks, taskLogs } from '@core/db/schema';
import { ReplayService } from '@core/ReplayService';

function seedProject(db: DrizzleDB): number {
  const row = db
    .insert(projects)
    .values({ projectName: 'test-project' })
    .returning({ id: projects.id })
    .get();
  return row.id;
}

let epicCounter = 0;

function seedTask(db: DrizzleDB, projectId: number): number {
  const key = String(++epicCounter);
  const epicRow = db
    .insert(epics)
    .values({ projectId, epicKey: key, title: `Epic ${key}`, orderIndex: epicCounter })
    .returning({ id: epics.id })
    .get();

  const storyRow = db
    .insert(stories)
    .values({ epicId: epicRow.id, storyKey: '1.1', title: 'Story 1.1', orderIndex: 0 })
    .returning({ id: stories.id })
    .get();

  const taskRow = db
    .insert(tasks)
    .values({ storyId: storyRow.id, stageName: 'dev', workerModel: 'sonnet' })
    .returning({ id: tasks.id })
    .get();

  return taskRow.id;
}

function seedLog(
  db: DrizzleDB,
  taskId: number,
  sequence: number,
  eventType = 'text',
): number {
  const row = db
    .insert(taskLogs)
    .values({
      taskId,
      sequence,
      eventType,
      eventData: JSON.stringify({ text: `event ${sequence}` }),
    })
    .returning({ id: taskLogs.id })
    .get();
  return row.id;
}

describe('ReplayService', () => {
  let db: DrizzleDB;
  let service: ReplayService;
  let projectId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    projectId = seedProject(db);
    service = new ReplayService(db);
  });

  describe('getTask', () => {
    it('returns null for non-existent task id', () => {
      expect(service.getTask(9999)).toBeNull();
    });

    it('returns full task record for existing task', () => {
      const taskId = seedTask(db, projectId);
      const task = service.getTask(taskId);
      expect(task).not.toBeNull();
      expect(task?.id).toBe(taskId);
      expect(task?.stageName).toBe('dev');
      expect(task?.workerModel).toBe('sonnet');
    });
  });

  describe('getTotalLogCount', () => {
    it('returns 0 for task with no logs', () => {
      const taskId = seedTask(db, projectId);
      expect(service.getTotalLogCount(taskId)).toBe(0);
    });

    it('returns correct count for task with logs', () => {
      const taskId = seedTask(db, projectId);
      seedLog(db, taskId, 1);
      seedLog(db, taskId, 2);
      seedLog(db, taskId, 3);
      expect(service.getTotalLogCount(taskId)).toBe(3);
    });

    it('only counts logs for the specified task', () => {
      const taskId1 = seedTask(db, projectId);
      const taskId2 = seedTask(db, projectId);
      seedLog(db, taskId1, 1);
      seedLog(db, taskId1, 2);
      seedLog(db, taskId2, 1);
      expect(service.getTotalLogCount(taskId1)).toBe(2);
      expect(service.getTotalLogCount(taskId2)).toBe(1);
    });
  });

  describe('getLogsPage', () => {
    it('returns paginated results ordered by sequence', () => {
      const taskId = seedTask(db, projectId);
      seedLog(db, taskId, 3);
      seedLog(db, taskId, 1);
      seedLog(db, taskId, 2);

      const page = service.getLogsPage(taskId, 0, 10);
      expect(page).toHaveLength(3);
      expect(page[0]?.sequence).toBe(1);
      expect(page[1]?.sequence).toBe(2);
      expect(page[2]?.sequence).toBe(3);
    });

    it('respects offset and limit', () => {
      const taskId = seedTask(db, projectId);
      for (let i = 1; i <= 5; i++) {
        seedLog(db, taskId, i);
      }

      const page = service.getLogsPage(taskId, 2, 2);
      expect(page).toHaveLength(2);
      expect(page[0]?.sequence).toBe(3);
      expect(page[1]?.sequence).toBe(4);
    });

    it('returns empty array when offset is beyond end', () => {
      const taskId = seedTask(db, projectId);
      seedLog(db, taskId, 1);
      seedLog(db, taskId, 2);

      const page = service.getLogsPage(taskId, 100, 10);
      expect(page).toHaveLength(0);
    });

    it('returns only logs for the specified task', () => {
      const taskId1 = seedTask(db, projectId);
      const taskId2 = seedTask(db, projectId);
      seedLog(db, taskId1, 1);
      seedLog(db, taskId2, 1);

      const page = service.getLogsPage(taskId1, 0, 10);
      expect(page).toHaveLength(1);
      expect(page[0]?.taskId).toBe(taskId1);
    });
  });
});
