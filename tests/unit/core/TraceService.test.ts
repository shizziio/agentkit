import { describe, it, expect, beforeEach } from 'vitest';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks, taskLogs } from '@core/db/schema';
import { TraceService } from '@core/TraceService';

describe('TraceService', () => {
  let db: DrizzleDB;
  let service: TraceService;
  let projectId: number;
  let epicId: number;
  let storyId: number;
  let taskId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    service = new TraceService(db);

    const proj = db
      .insert(projects)
      .values({ projectName: 'test-project', team: 'agentkit' } as any)
      .returning({ id: projects.id })
      .get();
    projectId = proj.id;

    const epic = db
      .insert(epics)
      .values({ projectId, epicKey: 'E1', title: 'Epic One', orderIndex: 0 })
      .returning({ id: epics.id })
      .get();
    epicId = epic.id;

    const story = db
      .insert(stories)
      .values({ epicId, storyKey: 'S1.1', title: 'Story One', orderIndex: 0 })
      .returning({ id: stories.id })
      .get();
    storyId = story.id;

    const task = db
      .insert(tasks)
      .values({
        storyId,
        stageName: 'dev',
        status: 'done',
        attempt: 1,
        maxAttempts: 3,
        durationMs: 5000,
        workerModel: 'claude-3-sonnet',
      } as any)
      .returning({ id: tasks.id })
      .get();
    taskId = task.id;

    db.insert(taskLogs).values([
      { taskId, sequence: 1, eventType: 'text', eventData: 'hello' },
      { taskId, sequence: 2, eventType: 'done', eventData: '{}' },
    ]).run();
  });

  describe('getEpics', () => {
    it('returns epics for the project', () => {
      const result = service.getEpics(projectId);
      expect(result).toHaveLength(1);
      expect(result[0].epicKey).toBe('E1');
      expect(result[0].title).toBe('Epic One');
    });

    it('returns storyCount and completionPct', () => {
      const result = service.getEpics(projectId);
      expect(result[0].storyCount).toBe(1);
      // story status is 'draft' by default, so 0%
      expect(result[0].completionPct).toBe(0);
    });

    it('completionPct is 100 when all stories done', () => {
      db.update(stories).set({ status: 'done' } as any).where(undefined as never).run();
      const result = service.getEpics(projectId);
      expect(result[0].completionPct).toBe(100);
    });

    it('returns empty array for unknown project', () => {
      const result = service.getEpics(99999);
      expect(result).toHaveLength(0);
    });

    it('returns epics in orderIndex order', () => {
      db.insert(epics)
        .values({ projectId, epicKey: 'E0', title: 'Epic Zero', orderIndex: -1 })
        .run();
      const result = service.getEpics(projectId);
      expect(result[0].epicKey).toBe('E0');
      expect(result[1].epicKey).toBe('E1');
    });
  });

  describe('getStoriesForEpic', () => {
    it('returns stories for the epic', () => {
      const result = service.getStoriesForEpic(epicId);
      expect(result).toHaveLength(1);
      expect(result[0].storyKey).toBe('S1.1');
    });

    it('calculates totalDurationMs from tasks', () => {
      const result = service.getStoriesForEpic(epicId);
      expect(result[0].totalDurationMs).toBe(5000);
    });

    it('returns null totalDurationMs when all task durations are null', () => {
      db.update(tasks).set({ durationMs: null } as any).where(undefined as never).run();
      const result = service.getStoriesForEpic(epicId);
      expect(result[0].totalDurationMs).toBeNull();
    });

    it('returns empty array for unknown epic', () => {
      const result = service.getStoriesForEpic(99999);
      expect(result).toHaveLength(0);
    });

    it('aggregates totalDurationMs independently for each story (no N+1)', () => {
      // Add a second story to the same epic with a different task duration
      const story2 = db
        .insert(stories)
        .values({ epicId, storyKey: 'S1.2', title: 'Story Two', orderIndex: 1 })
        .returning({ id: stories.id })
        .get();
      db.insert(tasks)
        .values({ storyId: story2.id, stageName: 'sm', status: 'done', durationMs: 3000 } as any)
        .run();

      const result = service.getStoriesForEpic(epicId);
      expect(result).toHaveLength(2);
      const s1 = result.find((s) => s.storyKey === 'S1.1')!;
      const s2 = result.find((s) => s.storyKey === 'S1.2')!;
      expect(s1.totalDurationMs).toBe(5000);
      expect(s2.totalDurationMs).toBe(3000);
    });

    it('sums only non-null durations', () => {
      // Add a second task with null duration to the existing story
      db.insert(tasks)
        .values({ storyId, stageName: 'review', status: 'running', durationMs: null } as any)
        .run();
      const result = service.getStoriesForEpic(epicId);
      expect(result[0]!.totalDurationMs).toBe(5000);
    });
  });

  describe('getTasksForStory', () => {
    it('returns tasks for the story', () => {
      const result = service.getTasksForStory(storyId);
      expect(result).toHaveLength(1);
      expect(result[0].stageName).toBe('dev');
      expect(result[0].status).toBe('done');
    });

    it('sets reworkLabel to null for attempt 1', () => {
      const result = service.getTasksForStory(storyId);
      expect(result[0].reworkLabel).toBeNull();
    });

    it('sets reworkLabel for attempt > 1', () => {
      db.insert(tasks)
        .values({ storyId, stageName: 'review', status: 'queued', attempt: 2, maxAttempts: 3 } as any)
        .run();
      const result = service.getTasksForStory(storyId);
      const reworkTask = result.find((t) => t.attempt === 2);
      expect(reworkTask?.reworkLabel).toBe('Review rework #1');
    });

    it('returns empty array for unknown story', () => {
      const result = service.getTasksForStory(99999);
      expect(result).toHaveLength(0);
    });
  });

  describe('getTaskLogs', () => {
    it('returns logs ordered by sequence', () => {
      const result = service.getTaskLogs(taskId);
      expect(result).toHaveLength(2);
      expect(result[0].sequence).toBe(1);
      expect(result[1].sequence).toBe(2);
    });

    it('returns empty array for task with no logs', () => {
      const task2 = db
        .insert(tasks)
        .values({ storyId, stageName: 'sm', status: 'queued', attempt: 1, maxAttempts: 3 } as any)
        .returning({ id: tasks.id })
        .get();
      const result = service.getTaskLogs(task2.id);
      expect(result).toHaveLength(0);
    });
  });

  describe('replayTask', () => {
    it('resets task status to queued', () => {
      service.replayTask(taskId);
      const updated = db.select({ status: tasks.status }).from(tasks).get();
      expect(updated?.status).toBe('queued');
    });

    it('resets attempt to 1 and clears timing fields', () => {
      // Create a task with attempt=2 and all timing fields set
      const reworkTask = db
        .insert(tasks)
        .values({
          storyId,
          stageName: 'review',
          status: 'failed',
          attempt: 2,
          maxAttempts: 3,
          durationMs: 8000,
          startedAt: '2024-01-01T10:00:00Z',
          completedAt: '2024-01-01T10:02:00Z',
        } as any)
        .returning({ id: tasks.id })
        .get();

      service.replayTask(reworkTask.id);

      const updated = db
        .select({
          status: tasks.status,
          attempt: tasks.attempt,
          durationMs: tasks.durationMs,
          startedAt: tasks.startedAt,
          completedAt: tasks.completedAt,
        })
        .from(tasks)
        .all()
        .find((t) => t.attempt === 1 && t.startedAt === null)!;

      // The reset task should have attempt=1, status=queued, and nulled timing
      const directQuery = db.select().from(tasks).all().find((t) => t.id === reworkTask.id)!;
      expect(directQuery.status).toBe('queued');
      expect(directQuery.attempt).toBe(1);
      expect(directQuery.startedAt).toBeNull();
      expect(directQuery.completedAt).toBeNull();
      expect(directQuery.durationMs).toBeNull();
    });
  });

  describe('getSummary', () => {
    it('returns summary for project', () => {
      const result = service.getSummary(projectId);
      expect(result.totalEpics).toBe(1);
      expect(result.totalStories).toBe(1);
      expect(result.totalTasks).toBe(1);
    });

    it('returns zero completionRate when no done stories', () => {
      const result = service.getSummary(projectId);
      expect(result.completionRate).toBe(0);
    });

    it('returns 100 completionRate when all stories done', () => {
      db.update(stories).set({ status: 'done' } as any).where(undefined as never).run();
      const result = service.getSummary(projectId);
      expect(result.completionRate).toBe(100);
    });

    it('returns averageDurationPerStage', () => {
      const result = service.getSummary(projectId);
      expect(result.averageDurationPerStage).toHaveLength(1);
      expect(result.averageDurationPerStage[0].stageName).toBe('dev');
      expect(result.averageDurationPerStage[0].avgMs).toBe(5000);
    });

    it('returns zero counts for unknown project', () => {
      const result = service.getSummary(99999);
      expect(result.totalEpics).toBe(0);
      expect(result.totalStories).toBe(0);
      expect(result.totalTasks).toBe(0);
      expect(result.completionRate).toBe(0);
    });
  });

  describe('static helpers', () => {
    it('formatDuration returns - for null', () => {
      expect(TraceService.formatDuration(null)).toBe('-');
    });

    it('formatDuration returns seconds for small values', () => {
      expect(TraceService.formatDuration(5000)).toBe('5s');
    });

    it('formatDuration returns minutes and seconds', () => {
      expect(TraceService.formatDuration(90000)).toBe('1m 30s');
    });

    it('formatDuration returns hours minutes seconds', () => {
      expect(TraceService.formatDuration(3661000)).toBe('1h 1m 1s');
    });

    it('formatReworkLabel returns empty string for attempt 1', () => {
      expect(TraceService.formatReworkLabel('dev', 1)).toBe('');
    });

    it('formatReworkLabel returns label for attempt 2', () => {
      expect(TraceService.formatReworkLabel('dev', 2)).toBe('Dev rework #1');
    });

    it('statusColor returns green for done', () => {
      expect(TraceService.statusColor('done')).toBe('green');
    });

    it('statusColor returns yellow for running', () => {
      expect(TraceService.statusColor('running')).toBe('yellow');
    });

    it('statusColor returns red for failed', () => {
      expect(TraceService.statusColor('failed')).toBe('red');
    });

    it('statusColor returns white for unknown', () => {
      expect(TraceService.statusColor('unknown')).toBe('white');
    });
  });
});
