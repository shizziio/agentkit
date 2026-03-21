import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories } from '@core/db/schema';
import { MarkDoneService } from '@core/MarkDoneService';
import { MarkDoneError } from '@core/Errors';
import type { EventBus } from '@core/EventBus';

function makeEventBus(): EventBus & { emit: ReturnType<typeof vi.fn> } {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as EventBus & { emit: ReturnType<typeof vi.fn> };
}

function getStory(db: DrizzleDB, storyId: number) {
  return db.select().from(stories).where(eq(stories.id, storyId)).all()[0];
}

function getEpic(db: DrizzleDB, epicId: number) {
  return db.select().from(epics).where(eq(epics.id, epicId)).all()[0];
}

describe('MarkDoneService', () => {
  let db: DrizzleDB;
  let projectId: number;
  let epicId: number;
  let storyId1: number; // done
  let storyId2: number; // done
  let storyId3: number; // in_progress
  let eventBus: ReturnType<typeof makeEventBus>;
  let service: MarkDoneService;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    eventBus = makeEventBus();
    service = new MarkDoneService(db, eventBus);

    projectId = db
      .insert(projects)
      .values({ projectName: 'test-project' })
      .returning({ id: projects.id })
      .get().id;

    epicId = db
      .insert(epics)
      .values({ projectId, epicKey: '1', title: 'Epic One', orderIndex: 0 })
      .returning({ id: epics.id })
      .get().id;

    storyId1 = db
      .insert(stories)
      .values({ epicId, storyKey: '1.1', title: 'Story 1.1', orderIndex: 0, status: 'done' })
      .returning({ id: stories.id })
      .get().id;

    storyId2 = db
      .insert(stories)
      .values({ epicId, storyKey: '1.2', title: 'Story 1.2', orderIndex: 1, status: 'done' })
      .returning({ id: stories.id })
      .get().id;

    storyId3 = db
      .insert(stories)
      .values({ epicId, storyKey: '1.3', title: 'Story 1.3', orderIndex: 2, status: 'in_progress' })
      .returning({ id: stories.id })
      .get().id;
  });

  describe('markStoriesDone', () => {
    it('(a) sets status=done and emits story:done per story', () => {
      const result = service.markStoriesDone([storyId3]);

      expect(getStory(db, storyId3)?.status).toBe('done');
      expect(result.storiesMarked).toBe(1);
      expect(result.epicsMarked).toBe(0);

      expect(eventBus.emit).toHaveBeenCalledWith('story:done', {
        storyId: storyId3,
        storyKey: '1.3',
      });
    });

    it('(a) emits story:done for each story when multiple IDs provided', () => {
      service.markStoriesDone([storyId1, storyId2]);

      expect(eventBus.emit).toHaveBeenCalledTimes(2);
      expect(eventBus.emit).toHaveBeenCalledWith('story:done', { storyId: storyId1, storyKey: '1.1' });
      expect(eventBus.emit).toHaveBeenCalledWith('story:done', { storyId: storyId2, storyKey: '1.2' });
    });

    it('(b) returns {storiesMarked:0, epicsMarked:0} for empty array without hitting DB', () => {
      const result = service.markStoriesDone([]);

      expect(result).toEqual({ storiesMarked: 0, epicsMarked: 0 });
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('increments version after marking done', () => {
      const before = getStory(db, storyId3);
      const versionBefore = before?.version ?? 1;

      service.markStoriesDone([storyId3]);

      const after = getStory(db, storyId3);
      expect(after?.version).toBe(versionBefore + 1);
    });
  });

  describe('markEpicDone', () => {
    it('(c) succeeds when all stories done and emits epic:done', () => {
      // Mark story3 as done first so all are done
      db.update(stories).set({ status: 'done' }).where(eq(stories.id, storyId3)).run();

      const result = service.markEpicDone(epicId);

      expect(result.storiesMarked).toBe(0);
      expect(result.epicsMarked).toBe(1);
      expect(getEpic(db, epicId)?.status).toBe('done');
      expect(eventBus.emit).toHaveBeenCalledWith('epic:done', { epicId, epicKey: '1' });
    });

    it('(c) increments epic version after marking done', () => {
      db.update(stories).set({ status: 'done' }).where(eq(stories.id, storyId3)).run();
      const versionBefore = getEpic(db, epicId)?.version ?? 1;

      service.markEpicDone(epicId);

      expect(getEpic(db, epicId)?.version).toBe(versionBefore + 1);
    });

    it('(d) throws MarkDoneError listing undone storyKeys when some not done', () => {
      // storyId3 is in_progress
      let thrown: MarkDoneError | undefined;
      try {
        service.markEpicDone(epicId);
      } catch (err) {
        if (err instanceof MarkDoneError) thrown = err;
      }

      expect(thrown).toBeDefined();
      expect(thrown).toBeInstanceOf(MarkDoneError);
      expect(thrown?.undoneStoryKeys).toContain('1.3');
      expect(thrown?.message).toMatch(/Cannot mark epic done/);
    });

    it('(d) throws MarkDoneError with correct code', () => {
      expect(() => service.markEpicDone(epicId)).toThrow(MarkDoneError);
      try {
        service.markEpicDone(epicId);
      } catch (err) {
        expect((err as MarkDoneError).code).toBe('MARK_DONE_ERROR');
        expect((err as MarkDoneError).name).toBe('MarkDoneError');
      }
    });

    it('(d) no DB writes occur when some stories not done', () => {
      const epicBefore = getEpic(db, epicId);

      expect(() => service.markEpicDone(epicId)).toThrow(MarkDoneError);

      const epicAfter = getEpic(db, epicId);
      expect(epicAfter?.status).toBe(epicBefore?.status);
      expect(epicAfter?.version).toBe(epicBefore?.version);
    });

    it('(e) throws MarkDoneError "Epic not found" for unknown epicId', () => {
      expect(() => service.markEpicDone(999999)).toThrow(MarkDoneError);
      try {
        service.markEpicDone(999999);
      } catch (err) {
        expect((err as MarkDoneError).message).toBe('Epic not found');
      }
    });
  });

  describe('getMarkableStories', () => {
    it('(f) returns only non-done stories with epicKey and epicTitle', () => {
      const result = service.getMarkableStories(projectId);

      // storyId1 (done) and storyId2 (done) excluded; storyId3 (in_progress) included
      expect(result).toHaveLength(1);
      expect(result[0]?.storyKey).toBe('1.3');
      expect(result[0]?.epicKey).toBe('1');
      expect(result[0]?.epicTitle).toBe('Epic One');
      expect(result[0]?.status).toBe('in_progress');
    });

    it('(f) returns empty array when all stories are done', () => {
      db.update(stories).set({ status: 'done' }).where(eq(stories.id, storyId3)).run();

      const result = service.getMarkableStories(projectId);

      expect(result).toEqual([]);
    });

    it('returns empty array when projectId has no epics/stories', () => {
      const result = service.getMarkableStories(999999);
      expect(result).toEqual([]);
    });

    it('(f) enriches each story with epicId', () => {
      const result = service.getMarkableStories(projectId);

      expect(result[0]?.epicId).toBe(epicId);
    });
  });

  describe('getMarkableEpics', () => {
    it('(g) returns totalStories, doneStories, allDone per epic', () => {
      const result = service.getMarkableEpics(projectId);

      expect(result).toHaveLength(1);
      const info = result[0]!;
      expect(info.id).toBe(epicId);
      expect(info.epicKey).toBe('1');
      expect(info.title).toBe('Epic One');
      expect(info.totalStories).toBe(3);
      expect(info.doneStories).toBe(2);
      expect(info.allDone).toBe(false);
    });

    it('(h) allDone=false when some stories not done', () => {
      const result = service.getMarkableEpics(projectId);
      expect(result[0]?.allDone).toBe(false);
    });

    it('allDone=true when all stories are done', () => {
      db.update(stories).set({ status: 'done' }).where(eq(stories.id, storyId3)).run();

      const result = service.getMarkableEpics(projectId);
      expect(result[0]?.allDone).toBe(true);
      expect(result[0]?.doneStories).toBe(3);
    });

    it('allDone=false when epic has 0 stories', () => {
      const emptyEpicId = db
        .insert(epics)
        .values({ projectId, epicKey: '2', title: 'Empty Epic', orderIndex: 1 })
        .returning({ id: epics.id })
        .get().id;

      const result = service.getMarkableEpics(projectId);
      const emptyEpicInfo = result.find((e) => e.id === emptyEpicId);

      expect(emptyEpicInfo?.totalStories).toBe(0);
      expect(emptyEpicInfo?.doneStories).toBe(0);
      expect(emptyEpicInfo?.allDone).toBe(false);
    });

    it('returns empty array when projectId has no epics', () => {
      const result = service.getMarkableEpics(999999);
      expect(result).toEqual([]);
    });
  });
});
