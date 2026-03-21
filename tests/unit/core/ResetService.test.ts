import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories, tasks } from '@core/db/schema.js';
import { ResetService } from '@core/ResetService.js';
import { ResetError } from '@core/Errors.js';
import type { EventBus } from '@core/EventBus.js';
import type { PipelineConfig } from '@core/ConfigTypes.js';
import type { StoryResetEvent, StoryCancelEvent } from '@core/EventTypes.js';

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

function seedStory(db: DrizzleDB, epicId: number, key = '1.1', status = 'in_progress'): number {
  return db
    .insert(stories)
    .values({ epicId, storyKey: key, title: `Story ${key}`, orderIndex: 0, status })
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

function getTask(db: DrizzleDB, taskId: number) {
  return db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0];
}

function getStory(db: DrizzleDB, storyId: number) {
  return db.select().from(stories).where(eq(stories.id, storyId)).all()[0];
}

function getActiveTasks(db: DrizzleDB, storyId: number) {
  return db.select().from(tasks).where(and(eq(tasks.storyId, storyId), eq(tasks.superseded, 0))).all();
}

function makeEventBus(): EventBus & { emittedEvents: Array<{ event: string; payload: unknown }> } {
  const emittedEvents: Array<{ event: string; payload: unknown }> = [];
  return {
    emittedEvents,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((event: string, payload: unknown) => {
      emittedEvents.push({ event, payload });
    }),
  } as unknown as EventBus & { emittedEvents: Array<{ event: string; payload: unknown }> };
}

describe('ResetService', () => {
  let db: DrizzleDB;
  let storyId: number;
  let eventBus: ReturnType<typeof makeEventBus>;
  let service: ResetService;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    eventBus = makeEventBus();
    service = new ResetService(db, eventBus, PIPELINE_CONFIG);

    const projectId = seedProject(db);
    const epicId = seedEpic(db, projectId);
    storyId = seedStory(db, epicId);
  });

  describe('resetStory', () => {
    it('(a) marks active tasks superseded=1 and creates new queued task at targetStage', () => {
      const taskId1 = seedTask(db, storyId, 'dev', 'completed');
      const taskId2 = seedTask(db, storyId, 'dev', 'queued');

      service.resetStory(storyId, 'sm');

      const task1 = getTask(db, taskId1);
      const task2 = getTask(db, taskId2);

      expect(task1?.superseded).toBe(1);
      expect(task2?.superseded).toBe(1);

      // Find the new queued task
      const newTasks = db
        .select()
        .from(tasks)
        .where(and(eq(tasks.storyId, storyId), eq(tasks.stageName, 'sm'), eq(tasks.superseded, 0)))
        .all();
      expect(newTasks).toHaveLength(1);
      expect(newTasks[0]?.status).toBe('queued');
      expect(newTasks[0]?.attempt).toBe(1);
    });

    it('throws ResetError when a running task exists', () => {
      seedTask(db, storyId, 'dev', 'running');

      expect(() => service.resetStory(storyId, 'sm')).toThrow(ResetError);
    });

    it('no DB changes when resetStory throws due to running task', () => {
      const taskId = seedTask(db, storyId, 'dev', 'running');

      expect(() => service.resetStory(storyId, 'sm')).toThrow(ResetError);

      const task = getTask(db, taskId);
      expect(task?.superseded).toBe(0);
      const allTasks = db.select().from(tasks).all();
      expect(allTasks).toHaveLength(1);
    });

    it('(b) superseded tasks excluded from active task queries (filter superseded=0)', () => {
      seedTask(db, storyId, 'dev', 'completed', { superseded: 1 });
      seedTask(db, storyId, 'review', 'completed', { superseded: 0 });

      service.resetStory(storyId, 'sm');

      const activeTasksAfter = getActiveTasks(db, storyId);

      // Only the new sm task should be active
      expect(activeTasksAfter).toHaveLength(1);
      expect(activeTasksAfter[0]?.stageName).toBe('sm');
      expect(activeTasksAfter[0]?.status).toBe('queued');
    });

    it('(c) old tasks still exist with superseded=1 after reset', () => {
      const taskId = seedTask(db, storyId, 'dev', 'completed');

      service.resetStory(storyId, 'sm');

      const oldTask = getTask(db, taskId);
      expect(oldTask).toBeDefined();
      expect(oldTask?.superseded).toBe(1);
      expect(oldTask?.stageName).toBe('dev');
    });

    it('(e) story:reset event emitted with correct payload', () => {
      const taskId1 = seedTask(db, storyId, 'dev', 'completed');
      const taskId2 = seedTask(db, storyId, 'dev', 'queued');

      service.resetStory(storyId, 'sm');

      expect(eventBus.emit).toHaveBeenCalledWith('story:reset', expect.objectContaining({
        storyId,
        targetStage: 'sm',
        supersededTaskIds: expect.arrayContaining([taskId1, taskId2]),
      }));

      const emitted = eventBus.emittedEvents.find((e) => e.event === 'story:reset');
      expect(emitted).toBeDefined();
      const payload = emitted?.payload as StoryResetEvent;
      expect(payload.supersededTaskIds).toHaveLength(2);
      expect(typeof payload.newTaskId).toBe('number');
      expect(payload.storyKey).toBe('1.1');
    });

    it('(f) throws ResetError when targetStage not in pipelineConfig.stages', () => {
      expect(() => service.resetStory(storyId, 'nonexistent-stage')).toThrow(ResetError);
    });

    it('(g) failed transaction leaves DB unchanged (rollback test)', () => {
      const taskId = seedTask(db, storyId, 'dev', 'completed');

      // Reset a story that doesn't exist -> should roll back and not affect the real story's tasks
      expect(() => service.resetStory(999999, 'sm')).toThrow(ResetError);

      // Tasks for our original story should be unchanged
      const task = getTask(db, taskId);
      expect(task?.superseded).toBe(0);

      // And no new task should have been created
      const allTasks = db.select().from(tasks).all();
      expect(allTasks).toHaveLength(1);
    });

    it('cancelled tasks are excluded from superseded list', () => {
      const cancelledId = seedTask(db, storyId, 'dev', 'cancelled');
      const completedId = seedTask(db, storyId, 'dev', 'completed');

      service.resetStory(storyId, 'sm');

      const cancelledTask = getTask(db, cancelledId);
      const completedTask = getTask(db, completedId);

      // Cancelled task should not be superseded (excluded from selection by ne(status, 'cancelled'))
      expect(cancelledTask?.superseded).toBe(0);
      // Completed task should be superseded
      expect(completedTask?.superseded).toBe(1);
    });

    it('updates story status to in_progress and increments version', () => {
      seedTask(db, storyId, 'dev', 'completed');

      const storyBefore = getStory(db, storyId);
      const versionBefore = storyBefore?.version ?? 1;

      service.resetStory(storyId, 'sm');

      const storyAfter = getStory(db, storyId);
      expect(storyAfter?.status).toBe('in_progress');
      expect(storyAfter?.version).toBe(versionBefore + 1);
    });

    it('returns ResetResult with newTaskId', () => {
      seedTask(db, storyId, 'dev', 'completed');

      const result = service.resetStory(storyId, 'sm');

      expect(result.success).toBe(true);
      expect(result.storyId).toBe(storyId);
      expect(result.targetStage).toBe('sm');
      expect(typeof result.newTaskId).toBe('number');
      expect(result.newTaskId).toBeGreaterThan(0);
    });
  });

  describe('getStoriesWithActiveTasks', () => {
    it('returns stories with queued or running tasks', () => {
      seedTask(db, storyId, 'dev', 'running');
      
      // Use a DIFFERENT project name for the second project
      const projectId2 = db
        .insert(projects)
        .values({ projectName: 'test-project-2' })
        .returning({ id: projects.id })
        .get().id;
      const epicId2 = seedEpic(db, projectId2);
      const storyId2 = seedStory(db, epicId2, '2.1');
      seedTask(db, storyId2, 'sm', 'queued');

      const storyId3 = seedStory(db, epicId2, '2.2');
      seedTask(db, storyId3, 'sm', 'completed');

      const result = service.getStoriesWithActiveTasks(projectId2);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(storyId2);
    });

    it('returns empty array when no active tasks', () => {
      seedTask(db, storyId, 'dev', 'completed');
      const projectId = db.select({ id: projects.id }).from(projects).get()?.id ?? 0;
      const result = service.getStoriesWithActiveTasks(projectId);
      expect(result).toHaveLength(0);
    });
  });

  describe('getResetableStories', () => {
    it('returns stories with blocked or failed status', () => {
      const projectId = db.select({ id: projects.id }).from(projects).get()?.id ?? 0;
      const epicId = db.select({ id: epics.id }).from(epics).get()?.id ?? 0;
      
      const storyId1 = seedStory(db, epicId, '1.2', 'blocked');
      const storyId2 = seedStory(db, epicId, '1.3', 'failed');
      seedStory(db, epicId, '1.4', 'in_progress');

      const result = service.getResetableStories(projectId);
      expect(result).toHaveLength(2);
      const ids = result.map(r => r.id);
      expect(ids).toContain(storyId1);
      expect(ids).toContain(storyId2);
    });
  });

  describe('startListening', () => {
    it('registers listeners for story:request-reset and story:request-cancel', () => {
      service.startListening();

      expect(eventBus.on).toHaveBeenCalledWith('story:request-reset', expect.any(Function));
      expect(eventBus.on).toHaveBeenCalledWith('story:request-cancel', expect.any(Function));
    });

    it('calls resetStory when story:request-reset is emitted', () => {
      let resetListener: ((payload: { storyId: number; targetStage: string }) => void) | undefined;
      (eventBus.on as any).mockImplementation((event: string, listener: any) => {
        if (event === 'story:request-reset') resetListener = listener;
      });

      service.startListening();
      const resetSpy = vi.spyOn(service, 'resetStory').mockReturnValue({} as any);
      
      if (resetListener) {
        resetListener({ storyId: 123, targetStage: 'dev' });
      }

      expect(resetSpy).toHaveBeenCalledWith(123, 'dev');
    });

    it('calls cancelStory when story:request-cancel is emitted', () => {
      let cancelListener: ((payload: { storyId: number }) => void) | undefined;
      (eventBus.on as any).mockImplementation((event: string, listener: any) => {
        if (event === 'story:request-cancel') cancelListener = listener;
      });

      service.startListening();
      const cancelSpy = vi.spyOn(service, 'cancelStory').mockReturnValue({} as any);

      if (cancelListener) {
        cancelListener({ storyId: 456 });
      }

      expect(cancelSpy).toHaveBeenCalledWith(456);
    });
  });

  describe('getResetTargets', () => {
    it('(d) returns correct targets with displayName and icon from config', () => {
      seedTask(db, storyId, 'review', 'running');

      const targets = service.getResetTargets(storyId);

      expect(targets).toHaveLength(2);
      expect(targets).toContainEqual({ stageName: 'sm', displayName: 'Story Manager', icon: '📋' });
      expect(targets).toContainEqual({ stageName: 'dev', displayName: 'Developer', icon: '💻' });
    });

    it('returns empty array when no active tasks exist', () => {
      const targets = service.getResetTargets(storyId);
      expect(targets).toEqual([]);
    });

    it('returns empty array when current stage has no reset_to config', () => {
      seedTask(db, storyId, 'sm', 'running');

      const targets = service.getResetTargets(storyId);
      expect(targets).toEqual([]);
    });

    it('excludes superseded tasks from consideration', () => {
      // Add a superseded review task (old)
      seedTask(db, storyId, 'review', 'completed', { superseded: 1 });
      // Add active dev task (current)
      seedTask(db, storyId, 'dev', 'running');

      const targets = service.getResetTargets(storyId);
      // Should see reset_to for 'dev' which is ['sm']
      expect(targets).toHaveLength(1);
      expect(targets[0]?.stageName).toBe('sm');
    });
  });

  describe('cancelStory', () => {
    it('marks queued tasks as cancelled and story as cancelled', () => {
      const taskId1 = seedTask(db, storyId, 'dev', 'queued');
      const taskId2 = seedTask(db, storyId, 'dev', 'queued');

      const result = service.cancelStory(storyId);

      expect(result.success).toBe(true);
      expect(result.storyId).toBe(storyId);
      expect(result.cancelledTaskIds).toHaveLength(2);
      expect(result.cancelledTaskIds).toContain(taskId1);
      expect(result.cancelledTaskIds).toContain(taskId2);

      expect(getTask(db, taskId1)?.status).toBe('cancelled');
      expect(getTask(db, taskId2)?.status).toBe('cancelled');
      expect(getStory(db, storyId)?.status).toBe('cancelled');
    });

    it('emits story:cancelled event with correct payload', () => {
      const taskId = seedTask(db, storyId, 'dev', 'queued');

      service.cancelStory(storyId);

      const emitted = eventBus.emittedEvents.find((e) => e.event === 'story:cancelled');
      expect(emitted).toBeDefined();
      const payload = emitted?.payload as StoryCancelEvent;
      expect(payload.storyId).toBe(storyId);
      expect(payload.storyKey).toBe('1.1');
      expect(payload.cancelledTaskIds).toContain(taskId);
    });

    it('throws ResetError when a running task exists', () => {
      seedTask(db, storyId, 'dev', 'running');

      expect(() => service.cancelStory(storyId)).toThrow(ResetError);
    });

    it('no DB changes when cancel rejected due to running task', () => {
      const taskId = seedTask(db, storyId, 'dev', 'running');

      expect(() => service.cancelStory(storyId)).toThrow(ResetError);

      // Task still running, story still in_progress
      expect(getTask(db, taskId)?.status).toBe('running');
      expect(getStory(db, storyId)?.status).toBe('in_progress');
    });

    it('only cancels queued tasks; completed tasks are left unchanged', () => {
      const completedId = seedTask(db, storyId, 'dev', 'completed');
      const queuedId = seedTask(db, storyId, 'dev', 'queued');

      const result = service.cancelStory(storyId);

      expect(result.cancelledTaskIds).toEqual([queuedId]);
      expect(getTask(db, completedId)?.status).toBe('completed');
      expect(getTask(db, queuedId)?.status).toBe('cancelled');
    });

    it('silently succeeds when story is already cancelled (no queued tasks)', () => {
      const epicId = db.select({ id: epics.id }).from(epics).all()[0]?.id ?? 0;
      const cancelledStoryId = seedStory(db, epicId, '1.2', 'cancelled');

      const result = service.cancelStory(cancelledStoryId);

      expect(result.success).toBe(true);
      expect(result.cancelledTaskIds).toEqual([]);
      expect(getStory(db, cancelledStoryId)?.status).toBe('cancelled');
    });
  });

  describe('reopenStory', () => {
    it('marks all active tasks superseded, creates new sm task, sets story in_progress', () => {
      const doneStoryId = (() => {
        const epicId = db.select({ id: epics.id }).from(epics).all()[0]?.id ?? 0;
        return seedStory(db, epicId, '1.2', 'done');
      })();
      const oldTaskId = seedTask(db, doneStoryId, 'tester', 'completed');

      const result = service.reopenStory(doneStoryId);

      expect(result.success).toBe(true);
      expect(result.storyId).toBe(doneStoryId);
      expect(result.supersededTaskIds).toContain(oldTaskId);
      expect(getTask(db, oldTaskId)?.superseded).toBe(1);

      const activeAfter = getActiveTasks(db, doneStoryId);
      expect(activeAfter).toHaveLength(1);
      expect(activeAfter[0]?.stageName).toBe('sm');
      expect(activeAfter[0]?.status).toBe('queued');
      expect(activeAfter[0]?.attempt).toBe(1);

      expect(getStory(db, doneStoryId)?.status).toBe('in_progress');
    });

    it('emits story:reset event with targetStage=sm', () => {
      const epicId = db.select({ id: epics.id }).from(epics).all()[0]?.id ?? 0;
      const doneStoryId = seedStory(db, epicId, '1.2', 'done');
      seedTask(db, doneStoryId, 'tester', 'completed');

      const result = service.reopenStory(doneStoryId);

      const emitted = eventBus.emittedEvents.find((e) => e.event === 'story:reset');
      expect(emitted).toBeDefined();
      const payload = emitted?.payload as StoryResetEvent;
      expect(payload.storyId).toBe(doneStoryId);
      expect(payload.targetStage).toBe('sm');
      expect(payload.newTaskId).toBe(result.newTaskId);
    });

    it('throws ResetError when a running task exists', () => {
      seedTask(db, storyId, 'dev', 'running');

      expect(() => service.reopenStory(storyId)).toThrow(ResetError);
    });

    it('no DB changes when reopen rejected due to running task', () => {
      const taskId = seedTask(db, storyId, 'dev', 'running');

      expect(() => service.reopenStory(storyId)).toThrow(ResetError);

      expect(getTask(db, taskId)?.superseded).toBe(0);
      expect(getStory(db, storyId)?.status).toBe('in_progress');
    });

    it('works on a story with no tasks (reopens cleanly)', () => {
      const epicId = db.select({ id: epics.id }).from(epics).all()[0]?.id ?? 0;
      const cancelledStoryId = seedStory(db, epicId, '1.2', 'cancelled');

      const result = service.reopenStory(cancelledStoryId);

      expect(result.supersededTaskIds).toEqual([]);
      const activeAfter = getActiveTasks(db, cancelledStoryId);
      expect(activeAfter).toHaveLength(1);
      expect(activeAfter[0]?.stageName).toBe('sm');
      expect(getStory(db, cancelledStoryId)?.status).toBe('in_progress');
    });

    it('throws ResetError when no stages configured', () => {
      const emptyConfig: PipelineConfig = { ...PIPELINE_CONFIG, stages: [] };
      const emptyService = new ResetService(db, eventBus, emptyConfig);

      expect(() => emptyService.reopenStory(storyId)).toThrow(ResetError);
    });
  });
});
