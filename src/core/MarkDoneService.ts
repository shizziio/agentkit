import { eq, ne, and, inArray, sql } from 'drizzle-orm';

import { Logger } from '@core/Logger.js';

import type { DrizzleDB } from './db/Connection.js';
import { epics, stories } from './db/schema.js';
import { MarkDoneError } from './Errors.js';
import type { EventBus } from './EventBus.js';
import type { MarkDoneResult, MarkableStory, EpicMarkInfo, IMarkDoneService } from './MarkDoneTypes.js';

const log = Logger.getOrNoop('MarkDoneService');

export class MarkDoneService implements IMarkDoneService {
  constructor(
    private db: DrizzleDB,
    private eventBus: EventBus,
  ) {}

  startListening(): void {
    this.eventBus.on('story:request-done', ({ storyId }) => {
      try {
        this.markStoriesDone([storyId]);
      } catch (err) {
        log.error('story:request-done listener failed', { storyId, error: String(err) });
      }
    });

    this.eventBus.on('epic:request-done', ({ epicId }) => {
      try {
        this.markEpicDone(epicId);
      } catch (err) {
        log.error('epic:request-done listener failed', { epicId, error: String(err) });
      }
    });
  }

  /**
   * Mark multiple stories as done in a single transaction.
   * Note: storyIds that don't exist in the DB are no-ops; storiesMarked reflects
   * the count of IDs passed in, not rows actually updated — callers should validate
   * IDs beforehand if needed.
   */
  markStoriesDone(storyIds: number[]): MarkDoneResult {
    if (storyIds.length === 0) return { storiesMarked: 0, epicsMarked: 0 };

    // Pre-query story keys before transaction for event emission
    const storyRows = this.db
      .select({ id: stories.id, storyKey: stories.storyKey })
      .from(stories)
      .where(inArray(stories.id, storyIds))
      .all();

    const now = new Date().toISOString();

    // Update each story individually within the transaction.
    // Per-row updates inside the transaction avoid SQLite variable limit (999)
    // that would be triggered by inArray() on large arrays.
    this.db.transaction((tx) => {
      for (const id of storyIds) {
        tx.update(stories)
          .set({ status: 'done', updatedAt: now, version: sql`${stories.version} + 1` })
          .where(eq(stories.id, id))
          .run();
      }
    });

    for (const row of storyRows) {
      this.eventBus.emit('story:done', { storyId: row.id, storyKey: row.storyKey });
    }

    log.info('markStoriesDone: success', { count: storyIds.length });
    return { storiesMarked: storyIds.length, epicsMarked: 0 };
  }

  markEpicDone(epicId: number): MarkDoneResult {
    // Check epic existence before proceeding
    const epicRow = this.db
      .select({ id: epics.id, epicKey: epics.epicKey })
      .from(epics)
      .where(eq(epics.id, epicId))
      .get();

    if (!epicRow) {
      throw new MarkDoneError('Epic not found');
    }

    const epicStories = this.db
      .select({ id: stories.id, storyKey: stories.storyKey, status: stories.status })
      .from(stories)
      .where(eq(stories.epicId, epicId))
      .all();

    const undone = epicStories.filter((s) => s.status !== 'done');
    // allDone requires at least one story; epics with 0 stories cannot be marked done
    const allDone = epicStories.length > 0 && undone.length === 0;

    if (!allDone) {
      throw new MarkDoneError(
        `Cannot mark epic done: ${undone.length} stories not done`,
        undone.map((s) => s.storyKey),
      );
    }

    const now = new Date().toISOString();

    this.db.transaction((tx) => {
      tx.update(epics)
        .set({ status: 'done', updatedAt: now, version: sql`${epics.version} + 1` })
        .where(eq(epics.id, epicId))
        .run();
    });

    this.eventBus.emit('epic:done', { epicId, epicKey: epicRow.epicKey });
    log.info('markEpicDone: success', { epicId, epicKey: epicRow.epicKey });
    return { storiesMarked: 0, epicsMarked: 1 };
  }

  getMarkableStories(projectId: number): MarkableStory[] {
    const rows = this.db
      .select({
        id: stories.id,
        storyKey: stories.storyKey,
        title: stories.title,
        status: stories.status,
        epicId: epics.id,
        epicKey: epics.epicKey,
        epicTitle: epics.title,
      })
      .from(stories)
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(and(eq(epics.projectId, projectId), ne(stories.status, 'done')))
      .all();

    return rows.map((r) => ({
      id: r.id,
      storyKey: r.storyKey,
      title: r.title,
      status: r.status,
      epicId: r.epicId,
      epicKey: r.epicKey,
      epicTitle: r.epicTitle,
    }));
  }

  getMarkableEpics(projectId: number): EpicMarkInfo[] {
    const allEpics = this.db
      .select({ id: epics.id, epicKey: epics.epicKey, title: epics.title })
      .from(epics)
      .where(eq(epics.projectId, projectId))
      .all();

    const result: EpicMarkInfo[] = [];

    for (const epic of allEpics) {
      const epicStories = this.db
        .select({ status: stories.status })
        .from(stories)
        .where(eq(stories.epicId, epic.id))
        .all();

      const totalStories = epicStories.length;
      const doneStories = epicStories.filter((s) => s.status === 'done').length;
      const allDone = totalStories > 0 && doneStories === totalStories;

      result.push({
        id: epic.id,
        epicKey: epic.epicKey,
        title: epic.title,
        totalStories,
        doneStories,
        allDone,
      });
    }

    log.debug('getMarkableEpics', { projectId, count: result.length });
    return result;
  }
}
