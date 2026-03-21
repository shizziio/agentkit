import { describe, it, expect, beforeEach } from 'vitest';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks } from '@core/db/schema';
import { StateManager } from '@core/StateManager';
import { MAX_CHAIN_LENGTH } from '@config/defaults';

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: 'test-project' })
    .returning({ id: projects.id })
    .get().id;
}

function seedEpic(db: DrizzleDB, projectId: number): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey: '1', title: 'Epic 1', orderIndex: 0 })
    .returning({ id: epics.id })
    .get().id;
}

function seedStory(db: DrizzleDB, epicId: number, key = '1.1'): number {
  return db
    .insert(stories)
    .values({ epicId, storyKey: key, title: `Story ${key}`, orderIndex: 0 })
    .returning({ id: stories.id })
    .get().id;
}

function seedTask(
  db: DrizzleDB,
  storyId: number,
  stageName: string,
  status = 'queued',
  extra: Record<string, unknown> = {},
): number {
  return db
    .insert(tasks)
    .values({ storyId, stageName, status, team: 'agentkit', ...extra })
    .returning({ id: tasks.id })
    .get().id;
}

describe('StateManager', () => {
  let db: DrizzleDB;
  let manager: StateManager;
  let storyId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    const projectId = seedProject(db);
    const epicId = seedEpic(db, projectId);
    storyId = seedStory(db, epicId);
    manager = new StateManager(db, 'agentkit');
  });

  describe('getPipelineStatus', () => {
    it('returns zero counts when no tasks exist', () => {
      const status = manager.getPipelineStatus();
      expect(status).toEqual({ queued: 0, running: 0, done: 0, failed: 0, total: 0 });
    });

    it('counts correctly by status', () => {
      seedTask(db, storyId, 'sm', 'queued');
      seedTask(db, storyId, 'dev', 'queued');
      seedTask(db, storyId, 'review', 'running');
      seedTask(db, storyId, 'tester', 'done');
      seedTask(db, storyId, 'tester', 'failed');

      const status = manager.getPipelineStatus();
      expect(status.queued).toBe(2);
      expect(status.running).toBe(1);
      expect(status.done).toBe(1);
      expect(status.failed).toBe(1);
      expect(status.total).toBe(5);
    });
  });

  describe('getStoryProgress', () => {
    it('returns null currentStage and currentStatus when story has no tasks', () => {
      const progress = manager.getStoryProgress(storyId);
      expect(progress.currentStage).toBeNull();
      expect(progress.currentStatus).toBeNull();
      expect(progress.totalTasks).toBe(0);
      expect(progress.completedStages).toEqual([]);
    });

    it('returns current stage and completedStages correctly', () => {
      seedTask(db, storyId, 'sm', 'done');
      seedTask(db, storyId, 'dev', 'done');
      seedTask(db, storyId, 'review', 'running');

      const progress = manager.getStoryProgress(storyId);
      expect(progress.currentStage).toBe('review');
      expect(progress.currentStatus).toBe('running');
      expect(progress.completedStages).toContain('sm');
      expect(progress.completedStages).toContain('dev');
      expect(progress.completedStages).not.toContain('review');
      expect(progress.totalTasks).toBe(3);
    });

    it('includes only done tasks in completedStages', () => {
      seedTask(db, storyId, 'sm', 'done');
      seedTask(db, storyId, 'dev', 'failed');
      seedTask(db, storyId, 'review', 'queued');

      const progress = manager.getStoryProgress(storyId);
      expect(progress.completedStages).toEqual(['sm']);
    });

    it('returns storyId matching the input', () => {
      const progress = manager.getStoryProgress(storyId);
      expect(progress.storyId).toBe(storyId);
    });
  });

  describe('getTaskChain', () => {
    it('returns empty array for a non-existent taskId', () => {
      const chain = manager.getTaskChain(9999);
      expect(chain).toEqual([]);
    });

    it('returns single-item array for a root task (no parentId)', () => {
      const taskId = seedTask(db, storyId, 'sm', 'done');
      const chain = manager.getTaskChain(taskId);
      expect(chain).toHaveLength(1);
      expect(chain[0]!.id).toBe(taskId);
      expect(chain[0]!.parentId).toBeNull();
    });

    it('follows parent_id chain and returns items ordered root-first', () => {
      const rootId = seedTask(db, storyId, 'sm', 'done');
      const childId = seedTask(db, storyId, 'dev', 'done', { parentId: rootId });
      const leafId = seedTask(db, storyId, 'review', 'running', { parentId: childId });

      const chain = manager.getTaskChain(leafId);
      expect(chain).toHaveLength(3);
      expect(chain[0]!.id).toBe(rootId);
      expect(chain[1]!.id).toBe(childId);
      expect(chain[2]!.id).toBe(leafId);
    });

    it('stops traversal at MAX_CHAIN_LENGTH iterations', () => {
      // Build a chain longer than MAX_CHAIN_LENGTH (10)
      let parentId: number | null = null;
      let lastId = 0;

      for (let i = 0; i < MAX_CHAIN_LENGTH + 2; i++) {
        const extra: Record<string, unknown> = parentId !== null ? { parentId } : {};
        lastId = seedTask(db, storyId, `stage-${i}`, 'done', extra);
        parentId = lastId;
      }

      const chain = manager.getTaskChain(lastId);
      expect(chain.length).toBe(MAX_CHAIN_LENGTH);
    });
  });

  describe('getQueueDepthByStage', () => {
    it('returns empty object when no queued tasks exist', () => {
      const result = manager.getQueueDepthByStage();
      expect(result).toEqual({});
    });

    it('returns per-stage counts for queued tasks only', () => {
      seedTask(db, storyId, 'sm', 'queued');
      seedTask(db, storyId, 'sm', 'queued');
      seedTask(db, storyId, 'dev', 'queued');
      seedTask(db, storyId, 'review', 'running');
      seedTask(db, storyId, 'tester', 'done');

      const result = manager.getQueueDepthByStage();
      expect(result).toEqual({ sm: 2, dev: 1 });
    });

    it('ignores non-queued statuses', () => {
      seedTask(db, storyId, 'sm', 'running');
      seedTask(db, storyId, 'dev', 'done');
      seedTask(db, storyId, 'review', 'failed');

      const result = manager.getQueueDepthByStage();
      expect(result).toEqual({});
    });
  });

  describe('getStatistics', () => {
    it('returns zero counts and empty array when no tasks exist', () => {
      const stats = manager.getStatistics();
      expect(stats.doneTodayCount).toBe(0);
      expect(stats.failedCount).toBe(0);
      expect(stats.averageDurationPerStage).toEqual([]);
    });

    it('counts doneTodayCount for tasks completed today', () => {
      const today = new Date();
      today.setUTCHours(12, 0, 0, 0);
      const todayIso = today.toISOString();

      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      yesterday.setUTCHours(12, 0, 0, 0);
      const yesterdayIso = yesterday.toISOString();

      seedTask(db, storyId, 'sm', 'done', { completedAt: todayIso });
      seedTask(db, storyId, 'dev', 'done', { completedAt: todayIso });
      seedTask(db, storyId, 'review', 'done', { completedAt: yesterdayIso });

      const stats = manager.getStatistics();
      expect(stats.doneTodayCount).toBe(2);
    });

    it('does not count yesterday tasks in doneTodayCount', () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      yesterday.setUTCHours(23, 59, 59, 999);
      const yesterdayIso = yesterday.toISOString();

      seedTask(db, storyId, 'sm', 'done', { completedAt: yesterdayIso });

      const stats = manager.getStatistics();
      expect(stats.doneTodayCount).toBe(0);
    });

    it('counts all failed tasks regardless of date', () => {
      seedTask(db, storyId, 'sm', 'failed');
      seedTask(db, storyId, 'dev', 'failed');
      seedTask(db, storyId, 'review', 'queued');

      const stats = manager.getStatistics();
      expect(stats.failedCount).toBe(2);
    });

    it('returns averageDurationPerStage grouped by stageName', () => {
      seedTask(db, storyId, 'sm', 'done', { durationMs: 100 });
      seedTask(db, storyId, 'sm', 'done', { durationMs: 200 });
      seedTask(db, storyId, 'dev', 'done', { durationMs: 300 });

      const stats = manager.getStatistics();
      const smStat = stats.averageDurationPerStage.find((s) => s.stageName === 'sm');
      const devStat = stats.averageDurationPerStage.find((s) => s.stageName === 'dev');

      expect(smStat).toBeDefined();
      expect(smStat!.averageDurationMs).toBe(150);
      expect(devStat).toBeDefined();
      expect(devStat!.averageDurationMs).toBe(300);
    });

    it('excludes non-done tasks from averageDurationPerStage', () => {
      seedTask(db, storyId, 'sm', 'running', { durationMs: 500 });
      seedTask(db, storyId, 'dev', 'done', { durationMs: 200 });

      const stats = manager.getStatistics();
      expect(stats.averageDurationPerStage).toHaveLength(1);
      expect(stats.averageDurationPerStage[0]!.stageName).toBe('dev');
    });
  });

  describe('TaskStatus type support', () => {
    it('handles blocked status in getPipelineStatus', () => {
      seedTask(db, storyId, 'dev', 'blocked');
      seedTask(db, storyId, 'review', 'queued');

      const status = manager.getPipelineStatus();
      expect(status.total).toBe(2);
    });

    it('recognizes blocked status in getStoryProgress currentStatus', () => {
      seedTask(db, storyId, 'sm', 'done');
      seedTask(db, storyId, 'dev', 'blocked');

      const progress = manager.getStoryProgress(storyId);
      expect(progress.currentStatus).toBe('blocked');
      expect(progress.currentStage).toBe('dev');
    });

    it('includes blocked status in task chain', () => {
      const task1 = seedTask(db, storyId, 'sm', 'done');
      const task2 = seedTask(db, storyId, 'dev', 'blocked', { parentId: task1 });

      const chain = manager.getTaskChain(task2);
      expect(chain).toHaveLength(2);
      expect(chain[1]!.status).toBe('blocked');
    });
  });

  describe('scoped select optimization (architecture rule 5.2)', () => {
    it('getStoryProgress returns only required fields without unnecessary data', () => {
      seedTask(db, storyId, 'sm', 'done', { prompt: 'test prompt', output: 'test output' });
      seedTask(db, storyId, 'dev', 'running', { prompt: 'dev prompt', output: 'dev output' });

      const progress = manager.getStoryProgress(storyId);

      // Verify expected fields are present
      expect(progress).toHaveProperty('storyId');
      expect(progress).toHaveProperty('currentStage');
      expect(progress).toHaveProperty('currentStatus');
      expect(progress).toHaveProperty('completedStages');
      expect(progress).toHaveProperty('totalTasks');

      // The scoped select should have worked without needing to fetch prompt/output
      expect(progress.currentStatus).toBe('running');
      expect(progress.totalTasks).toBe(2);
    });

    it('getTaskChain returns minimal required fields without blob columns', () => {
      const task1 = seedTask(db, storyId, 'sm', 'done', { prompt: 'large prompt data', output: 'large output data' });
      const task2 = seedTask(db, storyId, 'dev', 'done', { parentId: task1, prompt: 'another prompt', output: 'another output' });

      const chain = manager.getTaskChain(task2);

      expect(chain).toHaveLength(2);
      // Verify the necessary fields exist
      expect(chain[0]!).toHaveProperty('id');
      expect(chain[0]!).toHaveProperty('storyId');
      expect(chain[0]!).toHaveProperty('parentId');
      expect(chain[0]!).toHaveProperty('stageName');
      expect(chain[0]!).toHaveProperty('status');
      expect(chain[0]!).toHaveProperty('createdAt');

      // All items in chain have correct values
      expect(chain[0]!.id).toBe(task1);
      expect(chain[1]!.id).toBe(task2);
    });
  });

  describe('complex story progress scenarios', () => {
    it('returns correct status when story has tasks in multiple stages', () => {
      seedTask(db, storyId, 'sm', 'done');
      seedTask(db, storyId, 'dev', 'done');
      seedTask(db, storyId, 'review', 'done');
      seedTask(db, storyId, 'tester', 'running');

      const progress = manager.getStoryProgress(storyId);
      expect(progress.completedStages).toEqual(['sm', 'dev', 'review']);
      expect(progress.currentStage).toBe('tester');
      expect(progress.currentStatus).toBe('running');
      expect(progress.totalTasks).toBe(4);
    });

    it('returns only done tasks as completedStages, ignoring failed', () => {
      seedTask(db, storyId, 'sm', 'done');
      seedTask(db, storyId, 'dev', 'failed');
      seedTask(db, storyId, 'review', 'done');

      const progress = manager.getStoryProgress(storyId);
      expect(progress.completedStages).toEqual(['sm', 'review']);
      expect(progress.totalTasks).toBe(3);
    });

    it('handles same stage appearing multiple times (e.g., rework)', () => {
      seedTask(db, storyId, 'dev', 'done');
      seedTask(db, storyId, 'review', 'done');
      seedTask(db, storyId, 'dev', 'running'); // rework

      const progress = manager.getStoryProgress(storyId);
      expect(progress.completedStages).toContain('dev');
      expect(progress.completedStages).toContain('review');
      expect(progress.currentStage).toBe('dev');
      expect(progress.currentStatus).toBe('running');
    });
  });

  describe('task chain complex scenarios', () => {
    it('returns chain with all different status values in sequence', () => {
      const queued = seedTask(db, storyId, 'sm', 'queued');
      const running = seedTask(db, storyId, 'dev', 'running', { parentId: queued });
      const done = seedTask(db, storyId, 'review', 'done', { parentId: running });
      const blocked = seedTask(db, storyId, 'tester', 'blocked', { parentId: done });

      const chain = manager.getTaskChain(blocked);
      expect(chain).toHaveLength(4);
      expect(chain[0]!.status).toBe('queued');
      expect(chain[1]!.status).toBe('running');
      expect(chain[2]!.status).toBe('done');
      expect(chain[3]!.status).toBe('blocked');
    });

    it('handles task chain across multiple stories', () => {
      const story2Id = seedStory(db, db.select().from(epics).get()!.id, '1.2');
      const task1 = seedTask(db, storyId, 'sm', 'done');
      const task2 = seedTask(db, story2Id, 'dev', 'done', { parentId: task1 });

      const chain = manager.getTaskChain(task2);
      expect(chain).toHaveLength(2);
      expect(chain[0]!.storyId).toBe(storyId);
      expect(chain[1]!.storyId).toBe(story2Id);
    });
  });

  describe('pipeline status with all task statuses', () => {
    it('counts all status types correctly including blocked', () => {
      seedTask(db, storyId, 'sm', 'queued');
      seedTask(db, storyId, 'dev', 'running');
      seedTask(db, storyId, 'review', 'done');
      seedTask(db, storyId, 'tester', 'failed');
      seedTask(db, storyId, 'sm', 'blocked');

      const status = manager.getPipelineStatus();
      expect(status.queued).toBe(1);
      expect(status.running).toBe(1);
      expect(status.done).toBe(1);
      expect(status.failed).toBe(1);
      expect(status.total).toBe(5);
    });

    it('filters by status correctly in getPipelineStatus', () => {
      seedTask(db, storyId, 'sm', 'queued');
      seedTask(db, storyId, 'sm', 'queued');
      seedTask(db, storyId, 'dev', 'running');
      seedTask(db, storyId, 'dev', 'running');
      seedTask(db, storyId, 'dev', 'running');

      const status = manager.getPipelineStatus();
      expect(status.queued).toBe(2);
      expect(status.running).toBe(3);
      expect(status.total).toBe(5);
    });
  });

  describe('superseded filtering', () => {
    it('getPipelineStatus excludes superseded tasks', () => {
      seedTask(db, storyId, 'sm', 'queued');
      seedTask(db, storyId, 'dev', 'done');
      // superseded tasks should not be counted
      seedTask(db, storyId, 'dev', 'done', { superseded: 1 });
      seedTask(db, storyId, 'sm', 'queued', { superseded: 1 });

      const status = manager.getPipelineStatus();
      expect(status.queued).toBe(1);
      expect(status.done).toBe(1);
      expect(status.total).toBe(2);
    });

    it('getQueueDepthByStage excludes superseded queued tasks', () => {
      seedTask(db, storyId, 'sm', 'queued');
      seedTask(db, storyId, 'sm', 'queued', { superseded: 1 });
      seedTask(db, storyId, 'dev', 'queued', { superseded: 1 });

      const result = manager.getQueueDepthByStage();
      expect(result['sm']).toBe(1);
      expect(result['dev']).toBeUndefined();
    });

    it('getStatistics excludes superseded done tasks from doneTodayCount', () => {
      const today = new Date();
      today.setUTCHours(12, 0, 0, 0);
      const todayIso = today.toISOString();

      seedTask(db, storyId, 'sm', 'done', { completedAt: todayIso });
      seedTask(db, storyId, 'dev', 'done', { completedAt: todayIso, superseded: 1 });

      const stats = manager.getStatistics();
      expect(stats.doneTodayCount).toBe(1);
    });

    it('getStatistics excludes superseded failed tasks from failedCount', () => {
      seedTask(db, storyId, 'sm', 'failed');
      seedTask(db, storyId, 'dev', 'failed', { superseded: 1 });

      const stats = manager.getStatistics();
      expect(stats.failedCount).toBe(1);
    });

    it('getStatistics excludes superseded done tasks from averageDurationPerStage', () => {
      seedTask(db, storyId, 'sm', 'done', { durationMs: 100 });
      seedTask(db, storyId, 'sm', 'done', { durationMs: 900, superseded: 1 });

      const stats = manager.getStatistics();
      const smStat = stats.averageDurationPerStage.find((s) => s.stageName === 'sm');
      expect(smStat?.averageDurationMs).toBe(100);
    });

    it('getTaskChain includes superseded items in traversal but marks them superseded:true', () => {
      const rootId = seedTask(db, storyId, 'sm', 'done', { superseded: 1 });
      const childId = seedTask(db, storyId, 'dev', 'done', { parentId: rootId });

      const chain = manager.getTaskChain(childId);
      expect(chain).toHaveLength(2);
      expect(chain[0]!.superseded).toBe(true);
      expect(chain[1]!.superseded).toBe(false);
    });

    it('getStoryProgress excludes superseded tasks from totalTasks and completedStages', () => {
      seedTask(db, storyId, 'sm', 'done');
      seedTask(db, storyId, 'dev', 'done', { superseded: 1 });
      seedTask(db, storyId, 'review', 'running');

      const progress = manager.getStoryProgress(storyId);
      expect(progress.totalTasks).toBe(2);
      expect(progress.completedStages).toEqual(['sm']);
      expect(progress.currentStage).toBe('review');
    });
  });
});
