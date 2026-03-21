/**
 * Story 20.3 — Router & CompletionHandler: Auto-Increment Priority
 *
 * Tests that Router.routeCompletedTask increments stories.priority by 1
 * inside the same DB transaction as the task insert.
 *
 * DOES NOT increment on: routeRejectedTask, completeStory, or early-return
 * (no next stage). Uses in-memory SQLite so actual DB state can be verified.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories, tasks } from '@core/db/schema.js';
import { Router } from '@workers/Router.js';
import type { StageConfig } from '@core/ConfigTypes.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@core/EventBus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@core/StateManager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    getTaskChain: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@core/Logger.js', () => ({
  Logger: {
    getOrNoop: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('@config/defaults.js', () => ({
  MAX_CHAIN_LENGTH: 10,
  BUSY_TIMEOUT: 5000,
}));

// ── Seed helpers ──────────────────────────────────────────────────────────────

let projectCounter = 0;
let epicCounter = 0;
let storyCounter = 0;

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: `project-${++projectCounter}` })
    .returning({ id: projects.id })
    .get().id;
}

function seedEpic(db: DrizzleDB, projectId: number): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey: `E${++epicCounter}`, title: 'Epic', orderIndex: 0 })
    .returning({ id: epics.id })
    .get().id;
}

function seedStory(db: DrizzleDB, epicId: number, priority = 0): number {
  return db
    .insert(stories)
    .values({
      epicId,
      storyKey: `S${++storyCounter}`,
      title: `Story ${storyCounter}`,
      orderIndex: storyCounter,
      priority,
    })
    .returning({ id: stories.id })
    .get().id;
}

function seedTask(
  db: DrizzleDB,
  storyId: number,
  stageName: string,
  status = 'running',
): number {
  return db
    .insert(tasks)
    .values({ storyId, stageName, status, team: 'agentkit' })
    .returning({ id: tasks.id })
    .get().id;
}

function getStoryPriority(db: DrizzleDB, storyId: number): number {
  const story = db
    .select({ priority: stories.priority })
    .from(stories)
    .where(eq(stories.id, storyId))
    .get();
  if (!story) throw new Error(`Story ${storyId} not found`);
  return story.priority;
}

function getQueuedTaskAt(
  db: DrizzleDB,
  storyId: number,
  stageName: string,
): { id: number; storyId: number; attempt: number } | undefined {
  return db
    .select({ id: tasks.id, storyId: tasks.storyId, attempt: tasks.attempt })
    .from(tasks)
    .where(and(eq(tasks.storyId, storyId), eq(tasks.stageName, stageName), eq(tasks.status, 'queued')))
    .get();
}

function makeStageConfig(overrides: Partial<StageConfig> = {}): StageConfig {
  return {
    name: 'sm',
    displayName: 'Story Master',
    icon: '🎯',
    prompt: 'prompts/sm.md',
    timeout: 300000,
    workers: 1,
    retries: 3,
    ...overrides,
  };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Router — story priority auto-increment (Story 20.3)', () => {
  let db: DrizzleDB;
  let router: Router;
  let epicId: number;

  beforeEach(() => {
    projectCounter = 0;
    epicCounter = 0;
    storyCounter = 0;

    db = createConnection(':memory:');
    runMigrations(db);
    router = new Router(db, 'agentkit');

    const projectId = seedProject(db);
    epicId = seedEpic(db, projectId);
  });

  // ── AC1: Priority incremented on forward routing ──────────────────────────

  describe('AC1: routeCompletedTask increments story priority by 1', () => {
    it('should increment story priority from 0 to 1 after a single forward routing', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'sm');
      const stageConfig = makeStageConfig({ name: 'sm', next: 'tester' });

      router.routeCompletedTask(
        { id: taskId, storyId, output: 'sm output', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(getStoryPriority(db, storyId)).toBe(1);
    });

    it('should increment story priority from 2 to 3 when story already has a non-zero priority', () => {
      const storyId = seedStory(db, epicId, 2);
      const taskId = seedTask(db, storyId, 'tester');
      const stageConfig = makeStageConfig({ name: 'tester', next: 'review' });

      router.routeCompletedTask(
        { id: taskId, storyId, output: 'tester output', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(getStoryPriority(db, storyId)).toBe(3);
    });

    it('should also insert a queued task at the next stage in the same call', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'sm');
      const stageConfig = makeStageConfig({ name: 'sm', next: 'tester' });

      router.routeCompletedTask(
        { id: taskId, storyId, output: 'sm output', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      const nextTask = getQueuedTaskAt(db, storyId, 'tester');
      expect(nextTask).toBeDefined();
      expect(nextTask!.storyId).toBe(storyId);
    });

    it('should NOT increment priority when stageConfig.next is null (early return before transaction)', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'dev');
      const stageConfig = makeStageConfig({ name: 'dev', next: undefined });

      router.routeCompletedTask(
        { id: taskId, storyId, output: 'dev output', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(getStoryPriority(db, storyId)).toBe(0);
    });

    it('should mark the original task as done when forward routing', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'sm');
      const stageConfig = makeStageConfig({ name: 'sm', next: 'tester' });

      router.routeCompletedTask(
        { id: taskId, storyId, output: 'done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      const originalTask = db
        .select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get();
      expect(originalTask?.status).toBe('done');
    });
  });

  // ── AC2: Priority NOT changed on reject routing ───────────────────────────

  describe('AC2: routeRejectedTask does NOT change story priority', () => {
    it('should leave story priority at 2 after a rejection routing', () => {
      const storyId = seedStory(db, epicId, 2);
      const taskId = seedTask(db, storyId, 'review');
      const stageConfig = makeStageConfig({ name: 'review', reject_to: 'dev' });

      router.routeRejectedTask(
        { id: taskId, storyId, output: 'CHANGES_REQUESTED', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(getStoryPriority(db, storyId)).toBe(2);
    });

    it('should leave story priority at 0 on first rejection (fresh story not yet incremented)', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'review');
      const stageConfig = makeStageConfig({ name: 'review', reject_to: 'dev' });

      router.routeRejectedTask(
        { id: taskId, storyId, output: 'FAIL', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(getStoryPriority(db, storyId)).toBe(0);
    });

    it('should leave story priority unchanged when returning blocked (no reject_to defined)', () => {
      const storyId = seedStory(db, epicId, 3);
      const taskId = seedTask(db, storyId, 'review');
      const stageConfig = makeStageConfig({ name: 'review', reject_to: undefined });

      const result = router.routeRejectedTask(
        { id: taskId, storyId, output: 'FAIL', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(result).toBe('blocked');
      expect(getStoryPriority(db, storyId)).toBe(3);
    });

    it('should leave story priority unchanged when returning blocked (attempt >= maxAttempts)', () => {
      const storyId = seedStory(db, epicId, 4);
      const taskId = seedTask(db, storyId, 'review');
      const stageConfig = makeStageConfig({ name: 'review', reject_to: 'dev' });

      const result = router.routeRejectedTask(
        { id: taskId, storyId, output: 'FAIL', attempt: 3, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(result).toBe('blocked');
      expect(getStoryPriority(db, storyId)).toBe(4);
    });
  });

  // ── AC3: Priority accumulates across multiple forward routings ────────────

  describe('AC3: priority accumulates across multiple forward routings', () => {
    it('should accumulate priority 0→1→2→3→4 across 4 forward routings (SM→Tester→Review→Dev)', () => {
      const storyId = seedStory(db, epicId, 0);

      // Forward routing 1: SM → Tester (priority 0 → 1)
      const task1 = seedTask(db, storyId, 'sm');
      router.routeCompletedTask(
        { id: task1, storyId, output: 'sm done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'sm', next: 'tester' }),
      );
      expect(getStoryPriority(db, storyId)).toBe(1);

      // Forward routing 2: Tester → Review (priority 1 → 2)
      const task2 = getQueuedTaskAt(db, storyId, 'tester')!.id;
      router.routeCompletedTask(
        { id: task2, storyId, output: 'tester done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'tester', next: 'review' }),
      );
      expect(getStoryPriority(db, storyId)).toBe(2);

      // Forward routing 3: Review → Dev (priority 2 → 3)
      const task3 = getQueuedTaskAt(db, storyId, 'review')!.id;
      router.routeCompletedTask(
        { id: task3, storyId, output: 'review done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'review', next: 'dev' }),
      );
      expect(getStoryPriority(db, storyId)).toBe(3);

      // Forward routing 4: Dev → QA (priority 3 → 4)
      const task4 = getQueuedTaskAt(db, storyId, 'dev')!.id;
      router.routeCompletedTask(
        { id: task4, storyId, output: 'dev done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'dev', next: 'qa' }),
      );
      expect(getStoryPriority(db, storyId)).toBe(4);
    });

    it('should track priority independently for two stories in the same epic', () => {
      const story1 = seedStory(db, epicId, 0);
      const story2 = seedStory(db, epicId, 0);

      // story1: 2 forward routings → priority = 2
      const t1a = seedTask(db, story1, 'sm');
      router.routeCompletedTask(
        { id: t1a, storyId: story1, output: 'done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'sm', next: 'tester' }),
      );
      const t1b = getQueuedTaskAt(db, story1, 'tester')!.id;
      router.routeCompletedTask(
        { id: t1b, storyId: story1, output: 'done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'tester', next: 'review' }),
      );

      // story2: 1 forward routing → priority = 1
      const t2a = seedTask(db, story2, 'sm');
      router.routeCompletedTask(
        { id: t2a, storyId: story2, output: 'done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'sm', next: 'tester' }),
      );

      expect(getStoryPriority(db, story1)).toBe(2);
      expect(getStoryPriority(db, story2)).toBe(1);
    });

    it('should correctly accumulate after a rejection cycle does not change priority', () => {
      // Story starts at priority 0, goes SM→Tester (priority=1), gets rejected at Tester
      // (priority stays 1), then Tester→Review (priority=2)
      const storyId = seedStory(db, epicId, 0);

      // SM → Tester: priority 0 → 1
      const smTask = seedTask(db, storyId, 'sm');
      router.routeCompletedTask(
        { id: smTask, storyId, output: 'sm done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'sm', next: 'tester' }),
      );
      expect(getStoryPriority(db, storyId)).toBe(1);

      // Tester rejected → Tester retry: priority stays 1
      const testerTask1 = getQueuedTaskAt(db, storyId, 'tester')!.id;
      router.routeRejectedTask(
        { id: testerTask1, storyId, output: 'FAIL', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'tester', reject_to: 'tester' }),
      );
      expect(getStoryPriority(db, storyId)).toBe(1); // unchanged by rejection

      // Tester (retry) → Review: priority 1 → 2
      const testerTask2 = getQueuedTaskAt(db, storyId, 'tester')!.id;
      router.routeCompletedTask(
        { id: testerTask2, storyId, output: 'tester done', attempt: 2, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'tester', next: 'review' }),
      );
      expect(getStoryPriority(db, storyId)).toBe(2);
    });
  });

  // ── AC4: Priority NOT changed on story complete ───────────────────────────

  describe('AC4: completeStory does NOT change story priority', () => {
    it('should not modify story priority when completeStory is called', () => {
      const storyId = seedStory(db, epicId, 4);
      const taskId = seedTask(db, storyId, 'dev');

      router.completeStory({ id: taskId, storyId }, 'story-1.1', 'epic-1');

      expect(getStoryPriority(db, storyId)).toBe(4);
    });

    it('should mark story as done while preserving accumulated priority', () => {
      const storyId = seedStory(db, epicId, 3);
      const taskId = seedTask(db, storyId, 'dev');

      router.completeStory({ id: taskId, storyId }, 'story-2.1', 'epic-1');

      const story = db
        .select({ status: stories.status, priority: stories.priority })
        .from(stories)
        .where(eq(stories.id, storyId))
        .get()!;
      expect(story.status).toBe('done');
      expect(story.priority).toBe(3);
    });

    it('should not change priority=0 when completeStory is called on an unrouted story', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'dev');

      router.completeStory({ id: taskId, storyId }, 'story-3.1', 'epic-1');

      expect(getStoryPriority(db, storyId)).toBe(0);
    });
  });

  // ── AC5: Atomic transaction ───────────────────────────────────────────────

  describe('AC5: priority increment is in the same transaction as task insert', () => {
    it('should persist both the next task insert and priority increment when call succeeds', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'sm');
      const stageConfig = makeStageConfig({ name: 'sm', next: 'tester' });

      router.routeCompletedTask(
        { id: taskId, storyId, output: 'done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      // Both the task insert AND priority increment must be present after success
      const nextTask = getQueuedTaskAt(db, storyId, 'tester');
      const priority = getStoryPriority(db, storyId);

      expect(nextTask).toBeDefined();  // task was inserted
      expect(priority).toBe(1);       // priority was incremented
    });

    it('should leave priority unchanged when call fails (no next stage — early return)', () => {
      // Verify the early-return path skips the transaction entirely
      const storyId = seedStory(db, epicId, 5);
      const taskId = seedTask(db, storyId, 'dev');

      router.routeCompletedTask(
        { id: taskId, storyId, output: 'done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'dev', next: undefined }),
      );

      const priority = getStoryPriority(db, storyId);
      const testerTask = getQueuedTaskAt(db, storyId, 'tester');

      expect(priority).toBe(5);           // no increment
      expect(testerTask).toBeUndefined(); // no task inserted
    });

    it('should increment priority independently for each story without cross-contamination', () => {
      // Run two separate forward routings for two stories to ensure no cross-story side-effects
      const story1 = seedStory(db, epicId, 0);
      const story2 = seedStory(db, epicId, 10);

      const task1 = seedTask(db, story1, 'sm');
      const task2 = seedTask(db, story2, 'sm');

      router.routeCompletedTask(
        { id: task1, storyId: story1, output: 'done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'sm', next: 'tester' }),
      );
      router.routeCompletedTask(
        { id: task2, storyId: story2, output: 'done', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        makeStageConfig({ name: 'sm', next: 'tester' }),
      );

      // Each story gets exactly +1 — no cross-contamination
      expect(getStoryPriority(db, story1)).toBe(1);
      expect(getStoryPriority(db, story2)).toBe(11);
    });
  });

  // ── AC6: Regression — existing behavior unaffected ───────────────────────

  describe('AC6: existing routeRejectedTask and completeStory behaviour is unaffected', () => {
    it('should still insert a retry task at reject_to stage with incremented attempt', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'review');
      const stageConfig = makeStageConfig({ name: 'review', reject_to: 'dev' });

      const result = router.routeRejectedTask(
        { id: taskId, storyId, output: 'CHANGES_REQUESTED', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(result).toBe('routed');
      const retryTask = getQueuedTaskAt(db, storyId, 'dev');
      expect(retryTask).toBeDefined();
      expect(retryTask!.attempt).toBe(2);
    });

    it('should return blocked when routeRejectedTask has no reject_to', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'review');
      const stageConfig = makeStageConfig({ name: 'review', reject_to: undefined });

      const result = router.routeRejectedTask(
        { id: taskId, storyId, output: 'FAIL', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(result).toBe('blocked');
    });

    it('should return blocked when routeRejectedTask attempt >= maxAttempts', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'review');
      const stageConfig = makeStageConfig({ name: 'review', reject_to: 'dev' });

      const result = router.routeRejectedTask(
        { id: taskId, storyId, output: 'FAIL', attempt: 3, maxAttempts: 3, team: 'agentkit' },
        stageConfig,
      );

      expect(result).toBe('blocked');
    });

    it('should mark story status as done when completeStory is called', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'dev');

      router.completeStory({ id: taskId, storyId }, 'story-1.1', 'epic-1');

      const story = db
        .select({ status: stories.status })
        .from(stories)
        .where(eq(stories.id, storyId))
        .get()!;
      expect(story.status).toBe('done');
    });

    it('should mark completed task as done in completeStory', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'dev');

      router.completeStory({ id: taskId, storyId }, 'story-1.1', 'epic-1');

      const task = db
        .select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()!;
      expect(task.status).toBe('done');
    });
  });
});
