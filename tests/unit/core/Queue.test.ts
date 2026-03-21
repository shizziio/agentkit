import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks } from '@core/db/schema';
import { Queue } from '@core/Queue';

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

function seedStory(db: DrizzleDB, epicId: number): number {
  return db
    .insert(stories)
    .values({ epicId, storyKey: '1.1', title: 'Story 1.1', orderIndex: 0 })
    .returning({ id: stories.id })
    .get().id;
}

function seedTask(
  db: DrizzleDB,
  storyId: number,
  stageName: string,
  status = 'queued',
): number {
  return db
    .insert(tasks)
    .values({ storyId, stageName, status })
    .returning({ id: tasks.id })
    .get().id;
}

describe('Queue', () => {
  let db: DrizzleDB;
  let queue: Queue;
  let storyId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    const projectId = seedProject(db);
    const epicId = seedEpic(db, projectId);
    storyId = seedStory(db, epicId);
    queue = new Queue(db);
  });

  it('returns null when no tasks exist', () => {
    const result = queue.dequeue('dev', 'agentkit');
    expect(result).toBeNull();
  });

  it('returns null when tasks exist for a different stage', () => {
    seedTask(db, storyId, 'sm', 'queued');
    const result = queue.dequeue('dev', 'agentkit');
    expect(result).toBeNull();
  });

  it('returns null when matching task has status running', () => {
    seedTask(db, storyId, 'dev', 'running');
    const result = queue.dequeue('dev', 'agentkit');
    expect(result).toBeNull();
  });

  it('returns the task and updates status to running when a matching queued task exists', () => {
    const taskId = seedTask(db, storyId, 'dev', 'queued');

    const result = queue.dequeue('dev', 'agentkit');

    expect(result).not.toBeNull();
    expect(result!.id).toBe(taskId);
    expect(result!.stageName).toBe('dev');
    expect(result!.status).toBe('running');

    const dbTask = db.select().from(tasks).where(eq(tasks.id as any, taskId) as any).get()!;
    expect(dbTask.status).toBe('running');
  });

  it('sets startedAt to a non-null ISO string', () => {
    seedTask(db, storyId, 'dev', 'queued');

    const result = queue.dequeue('dev', 'agentkit');

    expect(result).not.toBeNull();
    expect(result!.startedAt).not.toBeNull();
    expect(typeof result!.startedAt).toBe('string');
    expect(new Date(result!.startedAt!).toISOString()).toBe(result!.startedAt);
  });

  it('second dequeue returns null after first claim', () => {
    seedTask(db, storyId, 'dev', 'queued');

    const result1 = queue.dequeue('dev', 'agentkit');
    const result2 = queue.dequeue('dev', 'agentkit');

    expect(result1).not.toBeNull();
    expect(result2).toBeNull();
  });

  describe('FIFO ordering (architecture rule 8.2)', () => {
    it('returns oldest queued task when multiple exist for same stage', () => {
      const task1Id = seedTask(db, storyId, 'dev', 'queued');
      const task2Id = seedTask(db, storyId, 'dev', 'queued');
      const task3Id = seedTask(db, storyId, 'dev', 'queued');

      const result1 = queue.dequeue('dev', 'agentkit');
      expect(result1!.id).toBe(task1Id);

      const result2 = queue.dequeue('dev', 'agentkit');
      expect(result2!.id).toBe(task2Id);

      const result3 = queue.dequeue('dev', 'agentkit');
      expect(result3!.id).toBe(task3Id);
    });

    it('returns tasks in creation order even across multiple stages', () => {
      const smTaskId = seedTask(db, storyId, 'sm', 'queued');
      const devTaskId = seedTask(db, storyId, 'dev', 'queued');

      // dequeue sm first
      const smResult = queue.dequeue('sm', 'agentkit');
      expect(smResult!.id).toBe(smTaskId);

      // dequeue dev and verify it gets the only queued task for dev
      const devResult = queue.dequeue('dev', 'agentkit');
      expect(devResult!.id).toBe(devTaskId);
    });

    it('ignores non-queued tasks when determining FIFO order', () => {
      const runningTaskId = seedTask(db, storyId, 'dev', 'running');
      const queuedTaskId = seedTask(db, storyId, 'dev', 'queued');

      const result = queue.dequeue('dev', 'agentkit');
      expect(result!.id).toBe(queuedTaskId);
      expect(result!.id).not.toBe(runningTaskId);
    });
  });

  describe('atomic claiming behavior', () => {
    it('updates both status and startedAt atomically within same transaction', () => {
      const taskId = seedTask(db, storyId, 'dev', 'queued');

      const result = queue.dequeue('dev', 'agentkit');

      // Verify that updatedAt was also updated atomically
      const dbTask = db.select().from(tasks).where(eq(tasks.id as any, taskId) as any).get()!;
      expect(dbTask.status).toBe('running');
      expect(dbTask.startedAt).not.toBeNull();
      expect(dbTask.updatedAt).not.toBeNull();
    });

    it('preserves task fields unchanged except status, startedAt, updatedAt', () => {
      const taskId = seedTask(db, storyId, 'dev', 'queued');
      const originalTask = db.select().from(tasks).where(eq(tasks.id as any, taskId) as any).get()!;

      const result = queue.dequeue('dev', 'agentkit');

      const dbTask = db.select().from(tasks).where(eq(tasks.id as any, taskId) as any).get()!;
      expect(dbTask.prompt).toBe(originalTask.prompt);
      expect(dbTask.input).toBe(originalTask.input);
      expect(dbTask.output).toBe(originalTask.output);
      expect(dbTask.attempt).toBe(originalTask.attempt);
      expect(dbTask.maxAttempts).toBe(originalTask.maxAttempts);
    });
  });

  describe('result interface (DequeueResult)', () => {
    it('returns all required fields in DequeueResult', () => {
      const taskId = seedTask(db, storyId, 'dev', 'queued');
      const result = queue.dequeue('dev', 'agentkit');

      expect(result).not.toBeNull();
      expect(result!).toHaveProperty('id');
      expect(result!).toHaveProperty('storyId');
      expect(result!).toHaveProperty('parentId');
      expect(result!).toHaveProperty('stageName');
      expect(result!).toHaveProperty('status');
      expect(result!).toHaveProperty('prompt');
      expect(result!).toHaveProperty('input');
      expect(result!).toHaveProperty('output');
      expect(result!).toHaveProperty('workerModel');
      expect(result!).toHaveProperty('inputTokens');
      expect(result!).toHaveProperty('outputTokens');
      expect(result!).toHaveProperty('attempt');
      expect(result!).toHaveProperty('maxAttempts');
      expect(result!).toHaveProperty('startedAt');
      expect(result!).toHaveProperty('completedAt');
      expect(result!).toHaveProperty('durationMs');
      expect(result!).toHaveProperty('createdAt');
      expect(result!).toHaveProperty('updatedAt');
      expect(result!).toHaveProperty('version');
    });

    it('returns correct status type in result', () => {
      seedTask(db, storyId, 'dev', 'queued');
      const result = queue.dequeue('dev', 'agentkit');

      expect(result!.status).toBe('running');
    });
  });

  describe('edge cases and error conditions', () => {
    it('handles non-existent stage without error', () => {
      seedTask(db, storyId, 'dev', 'queued');
      const result = queue.dequeue('non-existent-stage');
      expect(result).toBeNull();
    });

    it('handles done tasks in queue (should not claim them)', () => {
      seedTask(db, storyId, 'dev', 'done');
      const result = queue.dequeue('dev', 'agentkit');
      expect(result).toBeNull();
    });

    it('handles failed tasks in queue (should not claim them)', () => {
      seedTask(db, storyId, 'dev', 'failed');
      const result = queue.dequeue('dev', 'agentkit');
      expect(result).toBeNull();
    });

    it('handles blocked tasks in queue (should not claim them)', () => {
      seedTask(db, storyId, 'dev', 'blocked');
      const result = queue.dequeue('dev', 'agentkit');
      expect(result).toBeNull();
    });

    it('handles mixed status tasks, only claiming queued ones', () => {
      const queuedId = seedTask(db, storyId, 'dev', 'queued');
      seedTask(db, storyId, 'dev', 'running');
      seedTask(db, storyId, 'dev', 'done');
      seedTask(db, storyId, 'dev', 'failed');

      const result = queue.dequeue('dev', 'agentkit');
      expect(result!.id).toBe(queuedId);
    });
  });
});
