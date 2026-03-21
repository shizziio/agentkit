import { describe, it, expect, beforeEach } from 'vitest';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks, taskLogs } from '@core/db/schema';
import { LogsService } from '@core/LogsService';
import { LogsError } from '@core/Errors';

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: 'test-project' })
    .returning({ id: projects.id })
    .get().id;
}

function seedEpic(db: DrizzleDB, projectId: number, epicKey = '1'): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey, title: `Epic ${epicKey}`, orderIndex: 0 })
    .returning({ id: epics.id })
    .get().id;
}

function seedStory(db: DrizzleDB, epicId: number, storyKey = '1.1'): number {
  return db
    .insert(stories)
    .values({ epicId, storyKey, title: `Story ${storyKey}`, orderIndex: 0 })
    .returning({ id: stories.id })
    .get().id;
}

function seedTask(db: DrizzleDB, storyId: number, stageName = 'dev'): number {
  return db
    .insert(tasks)
    .values({ storyId, stageName, status: 'done' })
    .returning({ id: tasks.id })
    .get().id;
}

function seedLog(
  db: DrizzleDB,
  taskId: number,
  sequence: number,
  eventType = 'text',
  eventData: Record<string, unknown> = { text: 'hello' },
): void {
  db.insert(taskLogs)
    .values({ taskId, sequence, eventType, eventData: JSON.stringify(eventData) })
    .run();
}

describe('LogsService', () => {
  let db: DrizzleDB;
  let service: LogsService;
  let projectId: number;
  let epicId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    projectId = seedProject(db);
    epicId = seedEpic(db, projectId, '1');
    service = new LogsService(db);
  });

  describe('query with lastN (default)', () => {
    it('returns logs for last N tasks ordered by task_id and sequence', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const taskId1 = seedTask(db, storyId, 'dev');
      const taskId2 = seedTask(db, storyId, 'dev');
      const taskId3 = seedTask(db, storyId, 'dev');

      seedLog(db, taskId1, 1, 'text', { text: 'task1-log1' });
      seedLog(db, taskId2, 1, 'text', { text: 'task2-log1' });
      seedLog(db, taskId2, 2, 'text', { text: 'task2-log2' });
      seedLog(db, taskId3, 1, 'text', { text: 'task3-log1' });

      const result = service.query(projectId, { lastN: 2 });

      // Should include only last 2 tasks (task2, task3)
      expect(result.taskIds).toHaveLength(2);
      expect(result.taskIds).toContain(taskId2);
      expect(result.taskIds).toContain(taskId3);
      expect(result.taskIds).not.toContain(taskId1);

      // Ordered by taskId asc, sequence asc
      const taskIds = result.entries.map((e) => e.taskId);
      expect(taskIds[0]).toBeLessThanOrEqual(taskIds[taskIds.length - 1]!);
    });

    it('returns empty result when no tasks exist', () => {
      const result = service.query(projectId, {});
      expect(result.entries).toHaveLength(0);
      expect(result.taskIds).toHaveLength(0);
    });
  });

  describe('query with taskId', () => {
    it('returns only logs for that task', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const taskId1 = seedTask(db, storyId, 'dev');
      const taskId2 = seedTask(db, storyId, 'dev');

      seedLog(db, taskId1, 1, 'text', { text: 'task1-log' });
      seedLog(db, taskId2, 1, 'text', { text: 'task2-log' });

      const result = service.query(projectId, { taskId: taskId1 });

      expect(result.taskIds).toEqual([taskId1]);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.taskId).toBe(taskId1);
    });

    it('throws LogsError when taskId does not belong to project', () => {
      const otherProjectId = db
        .insert(projects)
        .values({ projectName: 'other-project' })
        .returning({ id: projects.id })
        .get().id;
      const otherEpicId = seedEpic(db, otherProjectId, '99');
      const otherStoryId = seedStory(db, otherEpicId, '99.1');
      const otherTaskId = seedTask(db, otherStoryId, 'dev');

      expect(() => service.query(projectId, { taskId: otherTaskId })).toThrow(LogsError);
    });
  });

  describe('query with stageName', () => {
    it('filters tasks to that stage name', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const devTaskId = seedTask(db, storyId, 'dev');
      const smTaskId = seedTask(db, storyId, 'sm');

      seedLog(db, devTaskId, 1, 'text', { text: 'dev-log' });
      seedLog(db, smTaskId, 1, 'text', { text: 'sm-log' });

      const result = service.query(projectId, { stageName: 'dev', lastN: 5 });

      expect(result.taskIds).toContain(devTaskId);
      expect(result.taskIds).not.toContain(smTaskId);
      expect(result.entries.every((e) => e.stageName === 'dev')).toBe(true);
    });
  });

  describe('empty table', () => {
    it('returns empty LogsResult', () => {
      const result = service.query(projectId, {});
      expect(result).toEqual({ entries: [], taskIds: [] });
    });
  });

  describe('event data parsing', () => {
    it('parses JSON eventData into an object', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const taskId = seedTask(db, storyId, 'dev');
      seedLog(db, taskId, 1, 'text', { text: 'hello world' });

      const result = service.query(projectId, { taskId });
      expect(result.entries[0]!.eventData).toEqual({ text: 'hello world' });
    });

    it('handles malformed JSON in eventData gracefully', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const taskId = seedTask(db, storyId, 'dev');
      db.insert(taskLogs)
        .values({ taskId, sequence: 1, eventType: 'text', eventData: 'not valid json' })
        .run();

      const result = service.query(projectId, { taskId });
      expect(result.entries[0]!.eventData).toEqual({});
    });

    it('handles array in JSON eventData (treats as empty)', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const taskId = seedTask(db, storyId, 'dev');
      db.insert(taskLogs)
        .values({ taskId, sequence: 1, eventType: 'text', eventData: '["a","b"]' })
        .run();

      const result = service.query(projectId, { taskId });
      expect(result.entries[0]!.eventData).toEqual({});
    });

    it('handles null in JSON eventData (treats as empty)', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const taskId = seedTask(db, storyId, 'dev');
      db.insert(taskLogs)
        .values({ taskId, sequence: 1, eventType: 'text', eventData: 'null' })
        .run();

      const result = service.query(projectId, { taskId });
      expect(result.entries[0]!.eventData).toEqual({});
    });
  });

  describe('task with no logs', () => {
    it('returns task ID but empty entries when task has no logs', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const taskId = seedTask(db, storyId, 'dev');

      const result = service.query(projectId, { taskId });
      expect(result.taskIds).toContain(taskId);
      expect(result.entries).toHaveLength(0);
    });
  });

  describe('sequence ordering', () => {
    it('orders entries by sequence number even across multiple tasks', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const taskId1 = seedTask(db, storyId, 'dev');
      const taskId2 = seedTask(db, storyId, 'dev');

      seedLog(db, taskId1, 3, 'text', { text: 'task1-seq3' });
      seedLog(db, taskId1, 1, 'text', { text: 'task1-seq1' });
      seedLog(db, taskId2, 2, 'text', { text: 'task2-seq2' });
      seedLog(db, taskId2, 1, 'text', { text: 'task2-seq1' });

      const result = service.query(projectId, { lastN: 10 });

      const sequences = result.entries.map((e) => e.sequence);
      expect(sequences).toEqual([1, 3, 1, 2]);
    });
  });

  describe('combined filters (error case)', () => {
    it('does not combine taskId and stageName filters, taskId takes precedence', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const devTaskId = seedTask(db, storyId, 'dev');
      const smTaskId = seedTask(db, storyId, 'sm');

      seedLog(db, devTaskId, 1, 'text', { text: 'dev-log' });
      seedLog(db, smTaskId, 1, 'text', { text: 'sm-log' });

      // When both are provided, taskId takes precedence (stageName is ignored)
      const result = service.query(projectId, { taskId: devTaskId, stageName: 'sm' });

      expect(result.taskIds).toEqual([devTaskId]);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.stageName).toBe('dev');
    });
  });

  describe('lastN clamping', () => {
    it('returns all tasks when lastN exceeds available tasks', () => {
      const storyId = seedStory(db, epicId, '1.1');
      seedTask(db, storyId, 'dev');
      seedTask(db, storyId, 'dev');
      seedTask(db, storyId, 'dev');

      const result = service.query(projectId, { lastN: 100 });
      expect(result.taskIds).toHaveLength(3);
    });

    it('uses default lastN=5 when not specified', () => {
      const storyId = seedStory(db, epicId, '1.1');
      for (let i = 0; i < 10; i++) {
        seedTask(db, storyId, 'dev');
      }

      const result = service.query(projectId, {});
      expect(result.taskIds).toHaveLength(5);
    });
  });

  describe('stage name filtering', () => {
    it('returns empty when stage has no tasks', () => {
      const result = service.query(projectId, { stageName: 'nonexistent', lastN: 5 });
      expect(result.entries).toHaveLength(0);
      expect(result.taskIds).toHaveLength(0);
    });

    it('filters correctly when stage has multiple tasks', () => {
      const storyId1 = seedStory(db, epicId, '1.1');
      const storyId2 = seedStory(db, epicId, '1.2');
      const devTask1 = seedTask(db, storyId1, 'dev');
      const devTask2 = seedTask(db, storyId2, 'dev');
      const reviewTask = seedTask(db, storyId1, 'review');

      seedLog(db, devTask1, 1, 'text', { text: 'dev1' });
      seedLog(db, devTask2, 1, 'text', { text: 'dev2' });
      seedLog(db, reviewTask, 1, 'text', { text: 'review1' });

      const result = service.query(projectId, { stageName: 'dev', lastN: 10 });
      expect(result.taskIds).toHaveLength(2);
      expect(result.taskIds).toContain(devTask1);
      expect(result.taskIds).toContain(devTask2);
      expect(result.taskIds).not.toContain(reviewTask);
    });
  });
});
