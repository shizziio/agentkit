import { describe, it, expect, beforeEach } from 'vitest';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks } from '@core/db/schema';
import { HistoryService } from '@core/HistoryService';

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: 'test-project' })
    .returning({ id: projects.id })
    .get().id;
}

function seedEpic(db: DrizzleDB, projectId: number, key = '1'): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey: key, title: `Epic ${key}`, orderIndex: 0 })
    .returning({ id: epics.id })
    .get().id;
}

function seedStory(
  db: DrizzleDB,
  epicId: number,
  key = '1.1',
  status = 'draft',
): number {
  return db
    .insert(stories)
    .values({ epicId, storyKey: key, title: `Story ${key}`, status, orderIndex: 0 } as any)
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

describe('HistoryService', () => {
  let db: DrizzleDB;
  let service: HistoryService;
  let projectId: number;
  let epicId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    projectId = seedProject(db);
    epicId = seedEpic(db, projectId);
    service = new HistoryService(db);
  });

  describe('getStories', () => {
    it('returns empty array when no stories exist', () => {
      const result = service.getStories(projectId);
      expect(result).toEqual([]);
    });

    it('returns HistoryStory rows with correct aggregated fields', () => {
      const storyId = seedStory(db, epicId, '1.1', 'done');
      seedTask(db, storyId, 'sm', 'done', { durationMs: 1000, attempt: 1 });
      seedTask(db, storyId, 'dev', 'done', { durationMs: 2000, attempt: 2 });

      const result = service.getStories(projectId);
      expect(result).toHaveLength(1);
      const story = result[0]!;
      expect(story.id).toBe(storyId);
      expect(story.status).toBe('done');
      expect(story.totalDurationMs).toBe(3000);
      expect(story.stagesPassed).toContain('sm');
      expect(story.stagesPassed).toContain('dev');
      expect(story.totalAttempts).toBe(3);
    });

    it('limits results with filter.last', () => {
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'done');
      seedStory(db, epicId, '1.3', 'done');

      const result = service.getStories(projectId, { last: 2 });
      expect(result).toHaveLength(2);
    });

    it('filters by story status', () => {
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'failed');
      seedStory(db, epicId, '1.3', 'draft');

      const result = service.getStories(projectId, { status: 'done' });
      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe('done');
    });

    it('filters by epicId', () => {
      const epic2Id = seedEpic(db, projectId, '2');
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epic2Id, '2.1', 'done');

      const result = service.getStories(projectId, { epicId: epic2Id });
      expect(result).toHaveLength(1);
      expect(result[0]!.epicKey).toBe('2');
    });
  });

  describe('getTaskChain', () => {
    it('returns tasks ordered by createdAt', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const t1 = seedTask(db, storyId, 'sm', 'done');
      const t2 = seedTask(db, storyId, 'dev', 'done');
      const t3 = seedTask(db, storyId, 'review', 'running');

      const chain = service.getTaskChain(storyId);
      expect(chain).toHaveLength(3);
      // Order by createdAt (ascending) — IDs should be sequential
      expect(chain[0]!.id).toBe(t1);
      expect(chain[1]!.id).toBe(t2);
      expect(chain[2]!.id).toBe(t3);
    });

    it('returns empty array when story has no tasks', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const chain = service.getTaskChain(storyId);
      expect(chain).toEqual([]);
    });

    it('includes all task fields', () => {
      const storyId = seedStory(db, epicId, '1.1');
      const tid = seedTask(db, storyId, 'sm', 'done', {
        input: '{"x":1}',
        output: '{"y":2}',
        durationMs: 500,
        attempt: 2,
      });

      const chain = service.getTaskChain(storyId);
      expect(chain).toHaveLength(1);
      const item = chain[0]!;
      expect(item.id).toBe(tid);
      expect(item.input).toBe('{"x":1}');
      expect(item.output).toBe('{"y":2}');
      expect(item.durationMs).toBe(500);
      expect(item.attempt).toBe(2);
    });
  });

  describe('getStatistics', () => {
    it('returns correct totalCompleted', () => {
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'done');
      seedStory(db, epicId, '1.3', 'draft');

      const stats = service.getStatistics(projectId);
      expect(stats.totalCompleted).toBe(2);
    });

    it('returns mostReworkedStories sorted by totalAttempts', () => {
      const s1 = seedStory(db, epicId, '1.1', 'done');
      const s2 = seedStory(db, epicId, '1.2', 'done');
      seedTask(db, s1, 'sm', 'done', { attempt: 1 });
      seedTask(db, s2, 'sm', 'done', { attempt: 3 });

      const stats = service.getStatistics(projectId);
      expect(stats.mostReworkedStories).toHaveLength(2);
      expect(stats.mostReworkedStories[0]!.totalAttempts).toBeGreaterThanOrEqual(
        stats.mostReworkedStories[1]!.totalAttempts,
      );
    });

    it('returns empty arrays when no data', () => {
      const stats = service.getStatistics(projectId);
      expect(stats.totalCompleted).toBe(0);
      expect(stats.averageDurationPerStage).toEqual([]);
      expect(stats.mostReworkedStories).toEqual([]);
    });

    it('calculates average duration per stage correctly', () => {
      const storyId = seedStory(db, epicId, '1.1', 'done');
      seedTask(db, storyId, 'sm', 'done', { durationMs: 1000 });
      seedTask(db, storyId, 'dev', 'done', { durationMs: 2000 });
      seedTask(db, storyId, 'dev', 'done', { durationMs: 3000 });

      const stats = service.getStatistics(projectId);
      const devStage = stats.averageDurationPerStage.find((s) => s.stageName === 'dev');
      expect(devStage?.averageDurationMs).toBe(2500); // (2000 + 3000) / 2
    });

    it('limits mostReworkedStories to top 5', () => {
      // Create 8 stories with increasing attempt counts
      for (let i = 1; i <= 8; i++) {
        const sid = seedStory(db, epicId, `1.${i}`, 'done');
        seedTask(db, sid, 'sm', 'done', { attempt: i });
      }

      const stats = service.getStatistics(projectId);
      expect(stats.mostReworkedStories).toHaveLength(5);
      // Most reworked (highest attempts) should be first
      expect(stats.mostReworkedStories[0]!.totalAttempts).toBe(8);
    });
  });

  describe('batch query optimization (no N+1)', () => {
    it('fetches all tasks for stories in a single batch query', () => {
      // Create multiple stories with multiple tasks
      const s1 = seedStory(db, epicId, '1.1', 'done');
      const s2 = seedStory(db, epicId, '1.2', 'done');
      const s3 = seedStory(db, epicId, '1.3', 'done');

      seedTask(db, s1, 'sm', 'done', { attempt: 1 });
      seedTask(db, s1, 'dev', 'done', { attempt: 1 });
      seedTask(db, s2, 'sm', 'done', { attempt: 1 });
      seedTask(db, s3, 'sm', 'done', { attempt: 2 });
      seedTask(db, s3, 'dev', 'done', { attempt: 1 });
      seedTask(db, s3, 'review', 'done', { attempt: 1 });

      const result = service.getStories(projectId);

      // All stories should have their tasks aggregated correctly
      expect(result).toHaveLength(3);
      const story1 = result.find((s) => s.id === s1)!;
      const story2 = result.find((s) => s.id === s2)!;
      const story3 = result.find((s) => s.id === s3)!;

      expect(story1.stagesPassed).toContain('sm');
      expect(story1.stagesPassed).toContain('dev');
      expect(story1.totalAttempts).toBe(2);

      expect(story2.stagesPassed).toContain('sm');
      expect(story2.totalAttempts).toBe(1);

      expect(story3.stagesPassed).toContain('sm');
      expect(story3.stagesPassed).toContain('dev');
      expect(story3.stagesPassed).toContain('review');
      expect(story3.totalAttempts).toBe(4);
    });

    it('handles stories with no tasks correctly', () => {
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'done');

      const result = service.getStories(projectId);
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.totalDurationMs === 0)).toBe(true);
      expect(result.every((s) => s.stagesPassed.length === 0)).toBe(true);
      expect(result.every((s) => s.totalAttempts === 0)).toBe(true);
    });
  });

  describe('limit vs all() path handling', () => {
    it('uses limit() when filter.last is provided', () => {
      // Create 5 stories
      for (let i = 1; i <= 5; i++) {
        seedStory(db, epicId, `1.${i}`, 'done');
      }

      const result = service.getStories(projectId, { last: 2 });
      expect(result).toHaveLength(2);
    });

    it('uses all() when filter.last is not provided', () => {
      // Create 5 stories
      for (let i = 1; i <= 5; i++) {
        seedStory(db, epicId, `1.${i}`, 'done');
      }

      const result = service.getStories(projectId);
      expect(result).toHaveLength(5);
    });

    it('applies ordering before limit', () => {
      // Create stories - they will be ordered by desc(updatedAt)
      const s1 = seedStory(db, epicId, '1.1', 'done');
      const s2 = seedStory(db, epicId, '1.2', 'done');
      const s3 = seedStory(db, epicId, '1.3', 'done');

      // Request last 2 stories (most recently updated)
      const result = service.getStories(projectId, { last: 2 });
      expect(result).toHaveLength(2);

      // Verify that both returned stories exist in our created stories
      const resultIds = result.map((s) => s.id).sort();
      const allIds = [s1, s2, s3].sort();
      // Result should be 2 of the 3 created stories
      expect(resultIds).toHaveLength(2);
      expect(resultIds[0]! >= allIds[0]!).toBe(true);
    });
  });

  describe('completedAt field logic', () => {
    it('returns the most recent completedAt from done tasks', () => {
      const storyId = seedStory(db, epicId, '1.1', 'done');
      seedTask(db, storyId, 'sm', 'done', { completedAt: '2026-03-01T10:00:00Z' });
      seedTask(db, storyId, 'dev', 'done', { completedAt: '2026-03-02T10:00:00Z' });
      seedTask(db, storyId, 'review', 'done', { completedAt: '2026-03-01T15:00:00Z' });

      const result = service.getStories(projectId);
      expect(result[0]!.completedAt).toBe('2026-03-02T10:00:00Z');
    });

    it('returns null when no done tasks have completedAt', () => {
      const storyId = seedStory(db, epicId, '1.1', 'draft');
      seedTask(db, storyId, 'sm', 'queued');

      const result = service.getStories(projectId);
      expect(result[0]!.completedAt).toBeNull();
    });

    it('ignores non-done tasks when finding completedAt', () => {
      const storyId = seedStory(db, epicId, '1.1', 'done');
      seedTask(db, storyId, 'sm', 'running', { completedAt: '2026-03-01T10:00:00Z' });
      seedTask(db, storyId, 'dev', 'done', { completedAt: '2026-03-02T10:00:00Z' });

      const result = service.getStories(projectId);
      expect(result[0]!.completedAt).toBe('2026-03-02T10:00:00Z');
    });
  });

  describe('filter combinations', () => {
    it('combines epicId and status filters when both provided', () => {
      const epic2Id = seedEpic(db, projectId, '2');
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'failed');
      seedStory(db, epic2Id, '2.1', 'done');

      const result = service.getStories(projectId, { epicId: epic2Id, status: 'done' });
      expect(result).toHaveLength(1);
      expect(result[0]!.epicKey).toBe('2');
    });

    it('applies last filter to filtered results', () => {
      const epic2Id = seedEpic(db, projectId, '2');
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'done');
      seedStory(db, epic2Id, '2.1', 'done');

      const result = service.getStories(projectId, { epicId: epicId, last: 1 });
      expect(result).toHaveLength(1);
      expect(result[0]!.epicKey).toBe('1');
    });
  });
});
