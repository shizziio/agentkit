import { eq, and, count, avg, sum, desc, inArray } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import { stories, epics, tasks, taskLogs } from '@core/db/schema.js';
import type {
  HistoryStory,
  HistoryTaskChainItem,
  HistoryStatistics,
  HistoryFilter,
} from '@core/HistoryTypes.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('HistoryService');

export class HistoryService {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  getStories(projectId: number, filter: HistoryFilter = {}): HistoryStory[] {
    try {
    logger.debug('history: query', { projectId, filter });
    const baseQuery = this.db
      .select({
        id: stories.id,
        storyKey: stories.storyKey,
        title: stories.title,
        status: stories.status,
        updatedAt: stories.updatedAt,
        epicKey: epics.epicKey,
        epicTitle: epics.title,
        epicId: epics.id,
      })
      .from(stories)
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(
        filter.epicId !== undefined
          ? and(eq(epics.projectId, projectId), eq(epics.id, filter.epicId))
          : filter.status !== undefined
            ? and(eq(epics.projectId, projectId), eq(stories.status, filter.status))
            : eq(epics.projectId, projectId),
      )
      .orderBy(desc(stories.updatedAt));

    const rows =
      filter.last !== undefined ? baseQuery.limit(filter.last).all() : baseQuery.all();

    if (rows.length === 0) return [];

    // Batch-fetch all tasks for the returned stories in a single query to avoid N+1
    const storyIds = rows.map((r) => r.id);
    const allTaskRows = this.db
      .select({
        storyId: tasks.storyId,
        stageName: tasks.stageName,
        status: tasks.status,
        attempt: tasks.attempt,
        durationMs: tasks.durationMs,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(inArray(tasks.storyId, storyIds))
      .all();

    // Group tasks by storyId in application code
    const tasksByStory = new Map<number, typeof allTaskRows>();
    for (const task of allTaskRows) {
      const list = tasksByStory.get(task.storyId) ?? [];
      list.push(task);
      tasksByStory.set(task.storyId, list);
    }

    return rows.map((row) => {
      const taskRows = tasksByStory.get(row.id) ?? [];
      const doneTasks = taskRows.filter((t) => t.status === 'done');
      const totalDurationMs = doneTasks.reduce((acc, t) => acc + (t.durationMs ?? 0), 0);
      const stagesPassed = [...new Set(doneTasks.map((t) => t.stageName))];
      const totalAttempts = taskRows.reduce((acc, t) => acc + t.attempt, 0);
      const completedAt = doneTasks
        .map((t) => t.completedAt)
        .filter((c): c is string => c !== null)
        .sort()
        .pop() ?? null;

      return {
        id: row.id,
        storyKey: row.storyKey,
        title: row.title,
        epicKey: row.epicKey,
        epicTitle: row.epicTitle,
        status: row.status,
        totalDurationMs,
        stagesPassed,
        totalAttempts,
        completedAt,
      };
    });
    } catch (err: unknown) {
      logger.error('history: query failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  getTaskChain(storyId: number): HistoryTaskChainItem[] {
    const rows = this.db
      .select({
        id: tasks.id,
        parentId: tasks.parentId,
        stageName: tasks.stageName,
        status: tasks.status,
        attempt: tasks.attempt,
        input: tasks.input,
        output: tasks.output,
        durationMs: tasks.durationMs,
        startedAt: tasks.startedAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(eq(tasks.storyId, storyId))
      .orderBy(tasks.createdAt)
      .all();

    return rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      stageName: r.stageName,
      status: r.status,
      attempt: r.attempt,
      input: r.input,
      output: r.output,
      durationMs: r.durationMs,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    }));
  }

  changeStoryStatus(storyId: number, newStatus: string): void {
    const now = new Date().toISOString();
    this.db
      .update(stories)
      .set({ status: newStatus, updatedAt: now })
      .where(eq(stories.id, storyId))
      .run();
    logger.info('history: status changed', { storyId, newStatus });
  }

  deleteStory(storyId: number): void {
    logger.info('history: deleting story', { storyId });
    this.db.transaction((tx) => {
      // Find all tasks for the story to delete their logs first
      const storyTasks = tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.storyId, storyId))
        .all();
      
      const taskIds = storyTasks.map((t) => t.id);

      // Manually cascade delete task logs -> tasks -> story
      if (taskIds.length > 0) {
        tx.delete(taskLogs).where(inArray(taskLogs.taskId, taskIds)).run();
      }
      tx.delete(tasks).where(eq(tasks.storyId, storyId)).run();
      tx.delete(stories).where(eq(stories.id, storyId)).run();
    });
  }

  getStatistics(projectId: number): HistoryStatistics {
    const completedRow = this.db
      .select({ cnt: count() })
      .from(stories)
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(and(eq(epics.projectId, projectId), eq(stories.status, 'done')))
      .get();
    const totalCompleted = completedRow?.cnt ?? 0;

    const avgRows = this.db
      .select({ stageName: tasks.stageName, avgDur: avg(tasks.durationMs) })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(and(eq(epics.projectId, projectId), eq(tasks.status, 'done')))
      .groupBy(tasks.stageName)
      .all();

    const averageDurationPerStage = avgRows.map((r) => ({
      stageName: r.stageName,
      averageDurationMs: r.avgDur !== null ? Number(r.avgDur) : 0,
    }));

    // Trade-off: sum(attempt) ranks stories with high per-task attempt numbers highest.
    // A story with three tasks each at attempt=1 scores 3, same as one task retried 3 times.
    // This is an approximation — use count of tasks with attempt > 1 for a stricter rework signal.
    const reworkRows = this.db
      .select({
        storyKey: stories.storyKey,
        title: stories.title,
        totalAttempts: sum(tasks.attempt),
      })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(eq(epics.projectId, projectId))
      .groupBy(stories.id)
      .orderBy(desc(sum(tasks.attempt)))
      .limit(5)
      .all();

    const mostReworkedStories = reworkRows.map((r) => ({
      storyKey: r.storyKey,
      title: r.title,
      totalAttempts: r.totalAttempts !== null ? Number(r.totalAttempts) : 0,
    }));

    return { totalCompleted, averageDurationPerStage, mostReworkedStories };
  }
}
