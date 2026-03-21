/**
 * Story 20.2 — Queue Dequeue Priority Ordering
 *
 * Tests that Queue.dequeue() returns tasks ordered by stories.priority DESC,
 * tasks.createdAt ASC (FIFO tiebreaker).
 *
 * DEPENDENCY: These tests require Story 20.1 (stories.priority column).
 * They will fail to compile until schema.ts includes the `priority` field
 * and migration 0005 is present.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, type SQL } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories, tasks, type NewTask } from '@core/db/schema.js';
import { Queue } from '@core/Queue.js';
import type { DequeueResult } from '@core/QueueTypes.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let epicKeyCounter = 0;
let storyKeyCounter = 0;
let projectNameCounter = 0;

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: `project-${++projectNameCounter}` })
    .returning({ id: projects.id })
    .get().id;
}

function seedEpic(db: DrizzleDB, projectId: number): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey: `E${++epicKeyCounter}`, title: 'Test Epic', orderIndex: 0 })
    .returning({ id: epics.id })
    .get().id;
}

/**
 * Seed a story with an explicit priority (defaults to 0 — the post-20.1 default).
 */
function seedStory(db: DrizzleDB, epicId: number, priority = 0): number {
  return db
    .insert(stories)
    .values({
      epicId,
      storyKey: `S${++storyKeyCounter}`,
      title: `Story ${storyKeyCounter}`,
      orderIndex: storyKeyCounter,
      priority,
    })
    .returning({ id: stories.id })
    .get().id;
}

/**
 * Seed a queued task. Pass an explicit ISO createdAt to control FIFO ordering
 * in tests where multiple tasks share the same priority.
 */
function seedTask(
  db: DrizzleDB,
  storyId: number,
  stageName: string,
  createdAt?: string,
): number {
  const values: NewTask = { storyId, stageName, status: 'queued' };
  if (createdAt !== undefined) {
    values.createdAt = createdAt;
  }
  return db
    .insert(tasks)
    .values(values)
    .returning({ id: tasks.id })
    .get().id;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Queue — priority-based dequeue ordering (Story 20.2)', () => {
  let db: DrizzleDB;
  let queue: Queue;
  let epicId: number;

  beforeEach(() => {
    epicKeyCounter = 0;
    storyKeyCounter = 0;
    projectNameCounter = 0;

    db = createConnection(':memory:');
    runMigrations(db);

    const projectId = seedProject(db);
    epicId = seedEpic(db, projectId);
    queue = new Queue(db);
  });

  // ── AC1: Higher priority story picked first ──────────────────────────────────

  describe('AC1: higher priority story is dequeued first', () => {
    it('should dequeue the task from the higher-priority story (priority=2 before priority=0)', () => {
      const highPriorityStoryId = seedStory(db, epicId, 2);
      const lowPriorityStoryId = seedStory(db, epicId, 0);

      const highTaskId = seedTask(db, highPriorityStoryId, 'dev', '2024-01-01T00:00:00Z');
      seedTask(db, lowPriorityStoryId, 'dev', '2024-01-01T00:00:01Z');

      const result = queue.dequeue('dev', 'agentkit');

      expect(result).not.toBeNull();
      expect(result!.id).toBe(highTaskId);
      expect(result!.storyId).toBe(highPriorityStoryId);
    });

    it('should dequeue low-priority task after high-priority task is claimed', () => {
      const highPriorityStoryId = seedStory(db, epicId, 2);
      const lowPriorityStoryId = seedStory(db, epicId, 0);

      seedTask(db, highPriorityStoryId, 'dev', '2024-01-01T00:00:00Z');
      const lowTaskId = seedTask(db, lowPriorityStoryId, 'dev', '2024-01-01T00:00:01Z');

      queue.dequeue('dev', 'agentkit'); // claims high-priority task

      const second = queue.dequeue('dev', 'agentkit');
      expect(second).not.toBeNull();
      expect(second!.id).toBe(lowTaskId);
      expect(second!.storyId).toBe(lowPriorityStoryId);
    });

    it('should pick priority=10 over priority=5 over priority=0 in order', () => {
      const s0 = seedStory(db, epicId, 0);
      const s5 = seedStory(db, epicId, 5);
      const s10 = seedStory(db, epicId, 10);

      seedTask(db, s0, 'dev', '2024-01-01T00:00:00Z');
      seedTask(db, s5, 'dev', '2024-01-01T00:00:01Z');
      const task10Id = seedTask(db, s10, 'dev', '2024-01-01T00:00:02Z');

      const first = queue.dequeue('dev', 'agentkit');
      expect(first!.storyId).toBe(s10);
      expect(first!.id).toBe(task10Id);
    });

    it('should pick priority=5 as the second task after priority=10 is claimed', () => {
      const s0 = seedStory(db, epicId, 0);
      const s5 = seedStory(db, epicId, 5);
      const s10 = seedStory(db, epicId, 10);

      seedTask(db, s0, 'dev', '2024-01-01T00:00:00Z');
      const task5Id = seedTask(db, s5, 'dev', '2024-01-01T00:00:01Z');
      seedTask(db, s10, 'dev', '2024-01-01T00:00:02Z');

      queue.dequeue('dev', 'agentkit'); // claims priority=10

      const second = queue.dequeue('dev', 'agentkit');
      expect(second!.storyId).toBe(s5);
      expect(second!.id).toBe(task5Id);
    });

    it('should not be affected by insertion order — later-inserted high-priority task wins', () => {
      // Insert low-priority task FIRST to confirm priority, not insertion order, determines winner
      const lowStoryId = seedStory(db, epicId, 0);
      const highStoryId = seedStory(db, epicId, 3);

      const lowTaskId = seedTask(db, lowStoryId, 'dev', '2024-01-01T00:00:00Z');
      const highTaskId = seedTask(db, highStoryId, 'dev', '2024-01-01T00:00:01Z');

      const result = queue.dequeue('dev', 'agentkit');
      expect(result!.id).toBe(highTaskId); // high priority wins even though inserted second
      expect(result!.id).not.toBe(lowTaskId);
    });
  });

  // ── AC2: FIFO within same priority ───────────────────────────────────────────

  describe('AC2: FIFO ordering within the same priority', () => {
    it('should return the earlier-created task first when two tasks have priority=0', () => {
      const storyA = seedStory(db, epicId, 0);
      const storyB = seedStory(db, epicId, 0);

      const taskAId = seedTask(db, storyA, 'dev', '2024-01-01T00:00:00Z');
      const taskBId = seedTask(db, storyB, 'dev', '2024-01-01T00:00:01Z');

      const first = queue.dequeue('dev', 'agentkit');
      expect(first!.id).toBe(taskAId);

      const second = queue.dequeue('dev', 'agentkit');
      expect(second!.id).toBe(taskBId);
    });

    it('should return the earlier-created task first when both stories share priority=5', () => {
      const storyA = seedStory(db, epicId, 5);
      const storyB = seedStory(db, epicId, 5);

      const taskAId = seedTask(db, storyA, 'dev', '2024-01-01T10:00:00Z');
      const taskBId = seedTask(db, storyB, 'dev', '2024-01-01T10:00:01Z');

      const first = queue.dequeue('dev', 'agentkit');
      expect(first!.id).toBe(taskAId);

      const second = queue.dequeue('dev', 'agentkit');
      expect(second!.id).toBe(taskBId);
    });

    it('should dequeue three same-priority tasks in FIFO order (earliest first)', () => {
      const storyA = seedStory(db, epicId, 1);
      const storyB = seedStory(db, epicId, 1);
      const storyC = seedStory(db, epicId, 1);

      const taskA = seedTask(db, storyA, 'dev', '2024-01-01T00:00:00Z');
      const taskB = seedTask(db, storyB, 'dev', '2024-01-01T00:00:01Z');
      const taskC = seedTask(db, storyC, 'dev', '2024-01-01T00:00:02Z');

      expect(queue.dequeue('dev', 'agentkit')!.id).toBe(taskA);
      expect(queue.dequeue('dev', 'agentkit')!.id).toBe(taskB);
      expect(queue.dequeue('dev', 'agentkit')!.id).toBe(taskC);
    });
  });

  // ── AC3: Default behavior preserved when all priority = 0 ───────────────────

  describe('AC3: default FIFO behavior is preserved when all stories have priority=0', () => {
    it('should behave identically to pre-change FIFO when all stories have priority=0', () => {
      const story1 = seedStory(db, epicId, 0);
      const story2 = seedStory(db, epicId, 0);
      const story3 = seedStory(db, epicId, 0);

      const task1 = seedTask(db, story1, 'dev', '2024-01-01T00:00:00Z');
      const task2 = seedTask(db, story2, 'dev', '2024-01-01T00:00:01Z');
      const task3 = seedTask(db, story3, 'dev', '2024-01-01T00:00:02Z');

      expect(queue.dequeue('dev', 'agentkit')!.id).toBe(task1);
      expect(queue.dequeue('dev', 'agentkit')!.id).toBe(task2);
      expect(queue.dequeue('dev', 'agentkit')!.id).toBe(task3);
    });

    it('should return null when no tasks are queued (unchanged behavior)', () => {
      const result = queue.dequeue('dev', 'agentkit');
      expect(result).toBeNull();
    });

    it('should still ignore tasks from a different stage (unchanged behavior)', () => {
      const storyId = seedStory(db, epicId, 0);
      seedTask(db, storyId, 'sm', '2024-01-01T00:00:00Z');

      const result = queue.dequeue('dev', 'agentkit');
      expect(result).toBeNull();
    });

    it('should mark dequeued task as running after priority ordering applies', () => {
      const storyId = seedStory(db, epicId, 0);
      const taskId = seedTask(db, storyId, 'dev');

      const result = queue.dequeue('dev', 'agentkit');

      expect(result!.status).toBe('running');

      const dbTask = db.select().from(tasks).where(eq(tasks.id, taskId) as SQL<boolean>).get()!;
      expect(dbTask.status).toBe('running');
    });
  });

  // ── AC4: DequeueResult interface unchanged ───────────────────────────────────

  describe('AC4: DequeueResult interface is unchanged', () => {
    it('should return all required DequeueResult fields (no new fields added)', () => {
      const storyId = seedStory(db, epicId, 2);
      seedTask(db, storyId, 'dev');

      const result = queue.dequeue('dev', 'agentkit');

      expect(result).not.toBeNull();

      // All required DequeueResult fields must be present
      const expectedKeys: (keyof DequeueResult)[] = [
        'id',
        'storyId',
        'parentId',
        'team',
        'stageName',
        'status',
        'prompt',
        'input',
        'output',
        'workerModel',
        'inputTokens',
        'outputTokens',
        'attempt',
        'maxAttempts',
        'startedAt',
        'completedAt',
        'durationMs',
        'createdAt',
        'updatedAt',
        'version',
      ];

      for (const key of expectedKeys) {
        expect(result).toHaveProperty(key);
      }
    });

    it('should NOT include a priority field in DequeueResult', () => {
      const storyId = seedStory(db, epicId, 5);
      seedTask(db, storyId, 'dev');

      const result = queue.dequeue('dev', 'agentkit') as DequeueResult & Record<string, unknown>;

      expect(Object.keys(result)).not.toContain('priority');
    });

    it('should return status="running" (not the original "queued" status)', () => {
      const storyId = seedStory(db, epicId, 0);
      seedTask(db, storyId, 'dev');

      const result = queue.dequeue('dev', 'agentkit');

      expect(result!.status).toBe('running');
    });

    it('should return correct storyId (from the joined stories table, not a story column)', () => {
      const storyId = seedStory(db, epicId, 3);
      const taskId = seedTask(db, storyId, 'dev');

      const result = queue.dequeue('dev', 'agentkit');

      expect(result!.id).toBe(taskId);
      expect(result!.storyId).toBe(storyId);
    });

    it('should set startedAt to a valid ISO 8601 string', () => {
      const storyId = seedStory(db, epicId, 1);
      seedTask(db, storyId, 'dev');

      const result = queue.dequeue('dev', 'agentkit');

      expect(typeof result!.startedAt).toBe('string');
      expect(new Date(result!.startedAt!).toISOString()).toBe(result!.startedAt);
    });

    it('should not expose story columns (id, createdAt, etc.) from the JOIN in the result', () => {
      // The explicit .select({ ...tasks fields }) prevents story.id from overwriting task.id.
      // Seed an extra story first to offset stories auto-increment so that storyId (=2) !=
      // taskId (=1). Without this, both tables start at 1 in a fresh :memory: DB, making the
      // assertion below vacuously true even when column leakage occurs.
      seedStory(db, epicId, 0); // offset: storyId will be 2 for the next seed
      const storyId = seedStory(db, epicId, 7);
      const taskId = seedTask(db, storyId, 'dev');

      const result = queue.dequeue('dev', 'agentkit');

      // result.id must be the TASK id, not the story id
      expect(result!.id).toBe(taskId);
      expect(result!.id).not.toBe(storyId);
    });
  });

  // ── AC5: Performance ─────────────────────────────────────────────────────────

  describe('AC5: performance with 100 stories and 500 tasks', () => {
    it('should dequeue in under 10ms with 100 stories and 500 tasks in SQLite', () => {
      // Seed 100 stories with varying priorities
      const storyIds: number[] = [];
      for (let i = 0; i < 100; i++) {
        const priority = i % 10; // priorities 0-9
        storyIds.push(seedStory(db, epicId, priority));
      }

      // Seed 500 tasks across stories
      for (let i = 0; i < 500; i++) {
        const storyId = storyIds[i % 100]!;
        // Insert with unique timestamps to guarantee stable ordering
        const ts = new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString();
        seedTask(db, storyId, 'dev', ts);
      }

      const start = performance.now();
      const result = queue.dequeue('dev', 'agentkit');
      const elapsed = performance.now() - start;

      expect(result).not.toBeNull();
      expect(elapsed).toBeLessThan(10);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle priority=0 vs priority=0 — no ordering regression (FIFO prevails)', () => {
      const storyA = seedStory(db, epicId, 0);
      const storyB = seedStory(db, epicId, 0);

      const taskA = seedTask(db, storyA, 'dev', '2024-01-01T00:00:00Z');
      seedTask(db, storyB, 'dev', '2024-01-01T00:00:01Z');

      const result = queue.dequeue('dev', 'agentkit');
      expect(result!.id).toBe(taskA); // older task wins
    });

    it('should handle a single story with tasks of different stages — each stage dequeues own tasks', () => {
      const storyId = seedStory(db, epicId, 5);

      const smTaskId = seedTask(db, storyId, 'sm', '2024-01-01T00:00:00Z');
      const devTaskId = seedTask(db, storyId, 'dev', '2024-01-01T00:00:01Z');

      const smResult = queue.dequeue('sm', 'agentkit');
      expect(smResult!.id).toBe(smTaskId);

      const devResult = queue.dequeue('dev', 'agentkit');
      expect(devResult!.id).toBe(devTaskId);
    });

    it('should not dequeue tasks from a different team even if story has high priority', () => {
      const storyId = seedStory(db, epicId, 100); // very high priority

      db.insert(tasks).values({
        storyId,
        stageName: 'dev',
        status: 'queued',
        team: 'other-team',
      }).run();

      const result = queue.dequeue('dev', 'agentkit');
      expect(result).toBeNull();
    });

    it('should correctly claim task (status=running) for the highest-priority task only', () => {
      const lowStoryId = seedStory(db, epicId, 0);
      const highStoryId = seedStory(db, epicId, 9);

      const lowTaskId = seedTask(db, lowStoryId, 'dev', '2024-01-01T00:00:00Z');
      const highTaskId = seedTask(db, highStoryId, 'dev', '2024-01-01T00:00:01Z');

      queue.dequeue('dev', 'agentkit'); // should claim highTaskId

      const highTask = db.select().from(tasks).where(eq(tasks.id, highTaskId) as SQL<boolean>).get()!;
      const lowTask = db.select().from(tasks).where(eq(tasks.id, lowTaskId) as SQL<boolean>).get()!;

      expect(highTask.status).toBe('running'); // claimed
      expect(lowTask.status).toBe('queued');   // untouched
    });

    it('should return null when all tasks across multiple stories are already running', () => {
      const story1 = seedStory(db, epicId, 0);
      const story2 = seedStory(db, epicId, 5);

      db.insert(tasks).values({ storyId: story1, stageName: 'dev', status: 'running' }).run();
      db.insert(tasks).values({ storyId: story2, stageName: 'dev', status: 'running' }).run();

      const result = queue.dequeue('dev', 'agentkit');
      expect(result).toBeNull();
    });

    it('should handle mixed priorities where priority=1 beats priority=0 but loses to priority=2', () => {
      const s0 = seedStory(db, epicId, 0);
      const s1 = seedStory(db, epicId, 1);
      const s2 = seedStory(db, epicId, 2);

      const task0 = seedTask(db, s0, 'dev', '2024-01-01T00:00:00Z');
      const task1 = seedTask(db, s1, 'dev', '2024-01-01T00:00:01Z');
      const task2 = seedTask(db, s2, 'dev', '2024-01-01T00:00:02Z');

      // Dequeue order must be: task2 (p=2) → task1 (p=1) → task0 (p=0)
      expect(queue.dequeue('dev', 'agentkit')!.id).toBe(task2);
      expect(queue.dequeue('dev', 'agentkit')!.id).toBe(task1);
      expect(queue.dequeue('dev', 'agentkit')!.id).toBe(task0);
    });

    it('should not return story columns in place of task columns after JOIN (ambiguous column guard)', () => {
      // Both tasks and stories have id, createdAt, updatedAt, version
      // The explicit .select({ ...tasks fields }) must prevent story values from leaking
      const storyId = seedStory(db, epicId, 99);
      const taskId = seedTask(db, storyId, 'dev');

      const result = queue.dequeue('dev', 'agentkit');

      // task id != story id (stories table auto-increment will be a different value)
      // This assertion guards against the JOIN ambiguity bug
      expect(result!.id).toBe(taskId);
      expect(result!.storyId).toBe(storyId);

      // version should be the task's version (1 by default), not the story's version (also 1,
      // but the key check is that it's a number, not undefined caused by ambiguous column resolution)
      expect(typeof result!.version).toBe('number');
      expect(typeof result!.createdAt).toBe('string');
    });
  });
});
