import { describe, it, expect, beforeEach } from 'vitest';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks } from '@core/db/schema';
import { TraceService } from '@core/TraceService';

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: `test-${Math.random()}` })
    .returning({ id: projects.id })
    .get()!.id;
}

function seedEpic(db: DrizzleDB, projectId: number): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey: '1', title: 'Epic 1', orderIndex: 0 })
    .returning({ id: epics.id })
    .get()!.id;
}

function seedStory(db: DrizzleDB, epicId: number): number {
  return db
    .insert(stories)
    .values({ epicId, storyKey: `1.${Math.random()}`, title: 'Story', orderIndex: 0 })
    .returning({ id: stories.id })
    .get()!.id;
}

function seedTask(
  db: DrizzleDB,
  storyId: number,
  stageName: string,
  status = 'queued',
  superseded = 0,
  extra: Record<string, unknown> = {},
): number {
  return db
    .insert(tasks)
    .values({ storyId, stageName, status, superseded, ...extra })
    .returning({ id: tasks.id })
    .get()!.id;
}

describe('TraceService superseded filtering', () => {
  let db: DrizzleDB;
  let service: TraceService;
  let projectId: number;
  let epicId: number;
  let storyId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    projectId = seedProject(db);
    epicId = seedEpic(db, projectId);
    storyId = seedStory(db, epicId);
    service = new TraceService(db);
  });

  describe('getStoriesForEpic', () => {
    it('totalDurationMs excludes superseded task durations', () => {
      // active task with 100ms duration
      seedTask(db, storyId, 'sm', 'done', 0, { durationMs: 100 });
      // superseded task with 9000ms duration — should be excluded from sum
      seedTask(db, storyId, 'dev', 'done', 1, { durationMs: 9000 });

      const result = service.getStoriesForEpic(epicId);

      expect(result).toHaveLength(1);
      expect(result[0]!.totalDurationMs).toBe(100);
    });

    it('totalDurationMs is null when only superseded tasks exist', () => {
      seedTask(db, storyId, 'sm', 'done', 1, { durationMs: 500 });

      const result = service.getStoriesForEpic(epicId);

      expect(result).toHaveLength(1);
      expect(result[0]!.totalDurationMs).toBeNull();
    });
  });

  describe('getTasksForStory', () => {
    it('by default (showSuperseded=false) excludes superseded tasks', () => {
      seedTask(db, storyId, 'sm', 'done', 0);
      seedTask(db, storyId, 'dev', 'done', 1); // superseded

      const tasks = service.getTasksForStory(storyId);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.stageName).toBe('sm');
    });

    it('with showSuperseded=true includes superseded tasks', () => {
      seedTask(db, storyId, 'sm', 'done', 0);
      seedTask(db, storyId, 'dev', 'done', 1); // superseded

      const tasks = service.getTasksForStory(storyId, true);
      expect(tasks).toHaveLength(2);
    });

    it('marks superseded tasks with superseded=true in result', () => {
      seedTask(db, storyId, 'sm', 'done', 0);
      seedTask(db, storyId, 'dev', 'done', 1);

      const tasks = service.getTasksForStory(storyId, true);
      const smTask = tasks.find(t => t.stageName === 'sm');
      const devTask = tasks.find(t => t.stageName === 'dev');

      expect(smTask?.superseded).toBe(false);
      expect(devTask?.superseded).toBe(true);
    });

    it('marks non-superseded tasks with superseded=false', () => {
      seedTask(db, storyId, 'sm', 'done', 0);

      const tasks = service.getTasksForStory(storyId);
      expect(tasks[0]!.superseded).toBe(false);
    });
  });

  describe('getSummary', () => {
    it('totalTasks count excludes superseded tasks', () => {
      seedTask(db, storyId, 'sm', 'done', 0);
      seedTask(db, storyId, 'dev', 'done', 0);
      seedTask(db, storyId, 'review', 'done', 1); // superseded

      const summary = service.getSummary(projectId);
      expect(summary.totalTasks).toBe(2);
    });

    it('totalTasks is 0 when all tasks are superseded', () => {
      seedTask(db, storyId, 'sm', 'done', 1);
      seedTask(db, storyId, 'dev', 'done', 1);

      const summary = service.getSummary(projectId);
      expect(summary.totalTasks).toBe(0);
    });
  });
});
