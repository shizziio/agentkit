import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories, tasks } from '@core/db/schema.js';
import { ResetService } from '@core/ResetService.js';
import type { EventBus } from '@core/EventBus.js';
import type { PipelineConfig } from '@core/ConfigTypes.js';

const PIPELINE_CONFIG: PipelineConfig = {
  team: 'agentkit',
  displayName: 'Software Team',
  provider: 'claude',
  project: { name: 'test-project' },
  models: {
    allowed: ['claude-3-5-sonnet'],
    resolved: { sm: 'claude-3-5-sonnet', dev: 'claude-3-5-sonnet', review: 'claude-3-5-sonnet' },
  },
  stages: [
    {
      name: 'sm',
      displayName: 'Story Manager',
      icon: '📋',
      prompt: 'sm-prompt.md',
      timeout: 60000,
      workers: 1,
      retries: 3,
      next: 'dev',
      reset_to: [],
    },
    {
      name: 'dev',
      displayName: 'Developer',
      icon: '💻',
      prompt: 'dev-prompt.md',
      timeout: 120000,
      workers: 1,
      retries: 3,
      next: 'review',
      reject_to: 'dev',
      reset_to: ['sm'],
    },
    {
      name: 'review',
      displayName: 'Reviewer',
      icon: '🔍',
      prompt: 'review-prompt.md',
      timeout: 60000,
      workers: 1,
      retries: 3,
      reject_to: 'dev',
      reset_to: ['sm', 'dev'],
    },
  ],
};

// ─── helpers ────────────────────────────────────────────────────────────────

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

function seedStory(
  db: DrizzleDB,
  epicId: number,
  opts: { key?: string; status?: string; priority?: number } = {},
): number {
  const { key = '1.1', status = 'in_progress', priority = 0 } = opts;
  return db
    .insert(stories)
    .values({ epicId, storyKey: key, title: `Story ${key}`, orderIndex: 0, status, priority })
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
    .values({ storyId, stageName, status, ...extra })
    .returning({ id: tasks.id })
    .get().id;
}

function getStory(db: DrizzleDB, storyId: number) {
  return db.select().from(stories).where(eq(stories.id, storyId)).all()[0];
}

function makeEventBus(): EventBus {
  return {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as EventBus;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('ResetService — Priority Handling', () => {
  let db: DrizzleDB;
  let epicId: number;
  let eventBus: EventBus;
  let service: ResetService;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    eventBus = makeEventBus();
    service = new ResetService(db, eventBus, PIPELINE_CONFIG);

    const projectId = seedProject(db);
    epicId = seedEpic(db, projectId);
  });

  // ── AC1: resetStory ────────────────────────────────────────────────────────

  describe('resetStory', () => {
    it('AC1: sets priority=0 when story had priority=3', () => {
      const storyId = seedStory(db, epicId, { priority: 3 });
      seedTask(db, storyId, 'dev', 'queued');

      service.resetStory(storyId, 'sm');

      expect(getStory(db, storyId)?.priority).toBe(0);
    });

    it('AC1: sets priority=0 when story had priority=1', () => {
      const storyId = seedStory(db, epicId, { priority: 1 });
      seedTask(db, storyId, 'dev', 'completed');

      service.resetStory(storyId, 'sm');

      expect(getStory(db, storyId)?.priority).toBe(0);
    });

    it('AC1: priority remains 0 when story was already priority=0', () => {
      const storyId = seedStory(db, epicId, { priority: 0 });
      seedTask(db, storyId, 'dev', 'completed');

      service.resetStory(storyId, 'sm');

      expect(getStory(db, storyId)?.priority).toBe(0);
    });

    it('AC1: resets priority to 0 even when no active tasks exist (empty story)', () => {
      // supersededTaskIds will be empty, but priority must still reset
      const storyId = seedStory(db, epicId, { priority: 3 });

      service.resetStory(storyId, 'sm');

      expect(getStory(db, storyId)?.priority).toBe(0);
    });

    it('AC6: priority reset is atomic with story status update — both applied together', () => {
      const storyId = seedStory(db, epicId, { priority: 5 });
      seedTask(db, storyId, 'dev', 'completed');

      service.resetStory(storyId, 'sm');

      const storyAfter = getStory(db, storyId);
      // Both changes must be present — they are in the same transaction
      expect(storyAfter?.status).toBe('in_progress');
      expect(storyAfter?.priority).toBe(0);
    });

    it('AC6: priority is NOT modified when the transaction rolls back (story not found)', () => {
      // Trigger a rollback by providing a non-existent storyId
      expect(() => service.resetStory(999999, 'sm')).toThrow();

      // No story was created or mutated
      const ghost = getStory(db, 999999);
      expect(ghost).toBeUndefined();
    });

    it('AC6: priority is NOT modified when the transaction rolls back due to running task', () => {
      const storyId = seedStory(db, epicId, { priority: 7 });
      seedTask(db, storyId, 'dev', 'running');

      expect(() => service.resetStory(storyId, 'sm')).toThrow();

      // priority must be unchanged after failed transaction
      expect(getStory(db, storyId)?.priority).toBe(7);
    });
  });

  // ── AC2: reopenStory ───────────────────────────────────────────────────────

  describe('reopenStory', () => {
    it('AC2: sets priority=0 when done story had priority=4', () => {
      const storyId = seedStory(db, epicId, { status: 'done', priority: 4 });
      seedTask(db, storyId, 'review', 'completed');

      service.reopenStory(storyId);

      expect(getStory(db, storyId)?.priority).toBe(0);
    });

    it('AC2: sets priority=0 when cancelled story had priority=2', () => {
      const storyId = seedStory(db, epicId, { status: 'cancelled', priority: 2 });

      service.reopenStory(storyId);

      expect(getStory(db, storyId)?.priority).toBe(0);
    });

    it('AC2: sets priority=0 on reopen regardless of previous priority value', () => {
      const storyId = seedStory(db, epicId, { status: 'done', priority: 10 });

      service.reopenStory(storyId);

      expect(getStory(db, storyId)?.priority).toBe(0);
    });

    it('AC2 + AC6: priority reset AND sessionInfo clear both happen in same operation (atomic)', () => {
      const storyId = seedStory(db, epicId, { status: 'done', priority: 3 });
      // Set sessionInfo to a non-null value
      db.update(stories)
        .set({ sessionInfo: JSON.stringify({ review: 'session-xyz' }) })
        .where(eq(stories.id, storyId))
        .run();

      service.reopenStory(storyId);

      const storyAfter = getStory(db, storyId);
      // Both must be updated together — they are in the same set() call
      expect(storyAfter?.priority).toBe(0);
      expect(storyAfter?.sessionInfo).toBeNull();
    });
  });

  // ── AC3: cancelStory ───────────────────────────────────────────────────────

  describe('cancelStory', () => {
    it('AC3: does NOT change priority when story had priority=2', () => {
      const storyId = seedStory(db, epicId, { priority: 2 });
      seedTask(db, storyId, 'dev', 'queued');

      service.cancelStory(storyId);

      expect(getStory(db, storyId)?.priority).toBe(2);
    });

    it('AC3: does NOT change priority when story had priority=0', () => {
      const storyId = seedStory(db, epicId, { priority: 0 });
      seedTask(db, storyId, 'dev', 'queued');

      service.cancelStory(storyId);

      expect(getStory(db, storyId)?.priority).toBe(0);
    });

    it('AC3: does NOT change priority when story had high priority=10', () => {
      const storyId = seedStory(db, epicId, { priority: 10 });
      seedTask(db, storyId, 'dev', 'queued');

      service.cancelStory(storyId);

      expect(getStory(db, storyId)?.priority).toBe(10);
    });

    it('AC3: priority column is absent from the cancelStory set() — version increments but not priority', () => {
      const storyId = seedStory(db, epicId, { priority: 5 });
      seedTask(db, storyId, 'dev', 'queued');
      const versionBefore = getStory(db, storyId)?.version ?? 1;

      service.cancelStory(storyId);

      const storyAfter = getStory(db, storyId);
      expect(storyAfter?.version).toBe(versionBefore + 1); // version increments (cancel ran)
      expect(storyAfter?.priority).toBe(5); // but priority is untouched
    });
  });

  // ── AC4: retryTask ─────────────────────────────────────────────────────────

  describe('retryTask', () => {
    it('AC4: does NOT change story priority when retrying a failed task (priority=2)', () => {
      const storyId = seedStory(db, epicId, { priority: 2 });
      const taskId = seedTask(db, storyId, 'dev', 'failed');

      service.retryTask(taskId);

      expect(getStory(db, storyId)?.priority).toBe(2);
    });

    it('AC4: does NOT change story priority when retrying a queued task (priority=5)', () => {
      const storyId = seedStory(db, epicId, { priority: 5 });
      const taskId = seedTask(db, storyId, 'sm', 'queued');

      service.retryTask(taskId);

      expect(getStory(db, storyId)?.priority).toBe(5);
    });

    it('AC4: stories table is NOT updated at all during retryTask (version unchanged)', () => {
      const storyId = seedStory(db, epicId, { priority: 3 });
      const taskId = seedTask(db, storyId, 'dev', 'failed');
      const versionBefore = getStory(db, storyId)?.version;

      service.retryTask(taskId);

      // Version must not change — retryTask only touches the tasks table
      expect(getStory(db, storyId)?.version).toBe(versionBefore);
    });
  });

  // ── AC5: pushNextStage ─────────────────────────────────────────────────────

  describe('pushNextStage', () => {
    it('AC5: increments priority by 1 when advancing from sm to dev (priority=2 → 3)', () => {
      const storyId = seedStory(db, epicId, { priority: 2 });
      const taskId = seedTask(db, storyId, 'sm', 'running');

      service.pushNextStage(taskId);

      expect(getStory(db, storyId)?.priority).toBe(3);
    });

    it('AC5: increments priority by 1 when advancing from dev to review (priority=0 → 1)', () => {
      const storyId = seedStory(db, epicId, { priority: 0 });
      const taskId = seedTask(db, storyId, 'dev', 'running');

      service.pushNextStage(taskId);

      expect(getStory(db, storyId)?.priority).toBe(1);
    });

    it('AC5: increments from 0 to 1 for first stage advancement', () => {
      const storyId = seedStory(db, epicId, { priority: 0 });
      const taskId = seedTask(db, storyId, 'sm', 'running');

      service.pushNextStage(taskId);

      expect(getStory(db, storyId)?.priority).toBe(1);
    });

    it('edge case: final stage path (review → done) does NOT increment priority', () => {
      // review is the last stage in PIPELINE_CONFIG — no next stage exists
      const storyId = seedStory(db, epicId, { priority: 5 });
      const taskId = seedTask(db, storyId, 'review', 'running');

      service.pushNextStage(taskId);

      const storyAfter = getStory(db, storyId);
      expect(storyAfter?.status).toBe('done');
      expect(storyAfter?.priority).toBe(5); // must NOT be incremented on final stage
    });

    it('edge case: throws when task not found, no partial priority update occurs', () => {
      const storyId = seedStory(db, epicId, { priority: 2 });
      const priorityBefore = getStory(db, storyId)?.priority;

      expect(() => service.pushNextStage(999999)).toThrow();

      // Story must be untouched
      expect(getStory(db, storyId)?.priority).toBe(priorityBefore);
    });

    it('edge case: next stage task is created AND priority incremented in same transaction', () => {
      // Verify both side-effects exist after the call — same transaction
      const storyId = seedStory(db, epicId, { priority: 1 });
      const taskId = seedTask(db, storyId, 'sm', 'running');

      service.pushNextStage(taskId);

      const storyAfter = getStory(db, storyId);
      const newTasks = db
        .select()
        .from(tasks)
        .where(eq(tasks.storyId, storyId))
        .all()
        .filter((t) => t.stageName === 'dev' && t.superseded === 0);

      expect(newTasks).toHaveLength(1);
      expect(newTasks[0]?.status).toBe('queued');
      expect(storyAfter?.priority).toBe(2); // incremented together with task creation
    });
  });
});
