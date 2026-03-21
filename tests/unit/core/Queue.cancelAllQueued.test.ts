import { describe, it, expect, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';

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
  team: string,
  status = 'queued',
  stageName = 'dev',
): number {
  return db
    .insert(tasks)
    .values({ storyId, stageName, status, team })
    .returning({ id: tasks.id })
    .get().id;
}

function getTaskById(db: DrizzleDB, id: number) {
  return db.select().from(tasks).where(eq(tasks.id, id)).get()!;
}

describe('Queue.cancelAllQueued', () => {
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

  describe('AC2: basic cancellation', () => {
    it('should return 5 when 5 queued tasks exist for the target team', () => {
      for (let i = 0; i < 5; i++) {
        seedTask(db, storyId, 'agent-kit', 'queued');
      }
      const count = queue.cancelAllQueued('agent-kit');
      expect(count).toBe(5);
    });

    it('should set all 5 agent-kit tasks to status=cancelled in the DB', () => {
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(seedTask(db, storyId, 'agent-kit', 'queued'));
      }

      queue.cancelAllQueued('agent-kit');

      for (const id of ids) {
        expect(getTaskById(db, id).status).toBe('cancelled');
      }
    });

    it('should leave tasks for other teams unchanged (status remains queued)', () => {
      const otherIds: number[] = [];
      for (let i = 0; i < 2; i++) {
        otherIds.push(seedTask(db, storyId, 'other-team', 'queued'));
      }
      for (let i = 0; i < 5; i++) {
        seedTask(db, storyId, 'agent-kit', 'queued');
      }

      queue.cancelAllQueued('agent-kit');

      for (const id of otherIds) {
        expect(getTaskById(db, id).status).toBe('queued');
      }
    });

    it('should only count agent-kit tasks, not tasks for other teams', () => {
      for (let i = 0; i < 5; i++) {
        seedTask(db, storyId, 'agent-kit', 'queued');
      }
      for (let i = 0; i < 2; i++) {
        seedTask(db, storyId, 'other-team', 'queued');
      }

      const count = queue.cancelAllQueued('agent-kit');
      expect(count).toBe(5);
    });
  });

  describe('AC2d: runs inside a transaction', () => {
    it('should atomically cancel all matching tasks — DB state is consistent after commit', () => {
      for (let i = 0; i < 3; i++) {
        seedTask(db, storyId, 'agent-kit', 'queued');
      }
      const count = queue.cancelAllQueued('agent-kit');
      expect(count).toBe(3);

      // Confirm DB reflects the change immediately (transaction committed)
      const remaining = db
        .select()
        .from(tasks)
        .where(and(eq(tasks.status, 'queued'), eq(tasks.team, 'agent-kit')))
        .all();
      expect(remaining).toHaveLength(0);
    });
  });

  describe('AC3b: dequeue() does NOT pick up cancelled tasks', () => {
    it('should not return a cancelled task from dequeue()', () => {
      seedTask(db, storyId, 'agent-kit', 'queued', 'dev');
      queue.cancelAllQueued('agent-kit');

      const result = queue.dequeue('dev', 'agent-kit');
      expect(result).toBeNull();
    });

    it('should not affect dequeue for tasks belonging to other teams', () => {
      const keptId = seedTask(db, storyId, 'other-team', 'queued', 'dev');
      seedTask(db, storyId, 'agent-kit', 'queued', 'dev');

      queue.cancelAllQueued('agent-kit');

      // The other-team queued task is unaffected and can still be dequeued
      const result = queue.dequeue('dev', 'other-team');
      expect(result).not.toBeNull();
      expect(result!.id).toBe(keptId);
    });
  });

  describe('edge cases', () => {
    it('should return 0 when no queued tasks exist for the team', () => {
      const count = queue.cancelAllQueued('agent-kit');
      expect(count).toBe(0);
    });

    it('should return 0 when called with empty string team and no matching tasks', () => {
      seedTask(db, storyId, 'agent-kit', 'queued');
      const count = queue.cancelAllQueued('');
      expect(count).toBe(0);
    });

    it('should NOT cancel tasks with status=running (only queued)', () => {
      const runningId = seedTask(db, storyId, 'agent-kit', 'running');
      seedTask(db, storyId, 'agent-kit', 'queued');

      queue.cancelAllQueued('agent-kit');

      expect(getTaskById(db, runningId).status).toBe('running');
    });

    it('should only count queued tasks — running tasks not included in return value', () => {
      seedTask(db, storyId, 'agent-kit', 'running');
      seedTask(db, storyId, 'agent-kit', 'running');
      seedTask(db, storyId, 'agent-kit', 'queued');

      const count = queue.cancelAllQueued('agent-kit');
      expect(count).toBe(1);
    });

    it('should NOT cancel tasks with status=completed', () => {
      const completedId = seedTask(db, storyId, 'agent-kit', 'completed');
      queue.cancelAllQueued('agent-kit');

      expect(getTaskById(db, completedId).status).toBe('completed');
    });

    it('should NOT cancel tasks with status=failed', () => {
      const failedId = seedTask(db, storyId, 'agent-kit', 'failed');
      queue.cancelAllQueued('agent-kit');

      expect(getTaskById(db, failedId).status).toBe('failed');
    });

    it('should be safe to call cancelAllQueued() twice — second call returns 0', () => {
      for (let i = 0; i < 3; i++) {
        seedTask(db, storyId, 'agent-kit', 'queued');
      }

      const first = queue.cancelAllQueued('agent-kit');
      const second = queue.cancelAllQueued('agent-kit');

      expect(first).toBe(3);
      expect(second).toBe(0);
    });
  });
});
