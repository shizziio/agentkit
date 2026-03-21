import { statSync } from 'node:fs';

import { and, count, desc, eq, inArray, isNotNull, lt, notInArray } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import { projects, epics, stories, tasks, taskLogs } from '@core/db/schema.js';
import type {
  CleanupResult,
  DatabaseStats,
  KeepLastPreview,
  OlderThanPreview,
} from './CleanupTypes.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('CleanupService');

const CHUNK_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export class CleanupService {
  constructor(
    private db: DrizzleDB,
    private dbPath: string,
  ) {}

  getDatabaseStats(): DatabaseStats {
    const { size: fileSizeBytes } = statSync(this.dbPath);

    const projectCount = this.db.select({ cnt: count() }).from(projects).get()?.cnt ?? 0;
    const epicCount = this.db.select({ cnt: count() }).from(epics).get()?.cnt ?? 0;
    const storyCount = this.db.select({ cnt: count() }).from(stories).get()?.cnt ?? 0;
    const taskCount = this.db.select({ cnt: count() }).from(tasks).get()?.cnt ?? 0;
    const taskLogCount = this.db.select({ cnt: count() }).from(taskLogs).get()?.cnt ?? 0;

    return {
      fileSizeBytes,
      tableCounts: {
        projects: projectCount,
        epics: epicCount,
        stories: storyCount,
        tasks: taskCount,
        taskLogs: taskLogCount,
      },
    };
  }

  previewOlderThan(days: number): OlderThanPreview {
    const cutoffDate = new Date(Date.now() - days * 86_400_000).toISOString();

    const taskResults = this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(isNotNull(tasks.completedAt), lt(tasks.completedAt, cutoffDate)))
      .all();

    if (taskResults.length === 0) {
      return { taskLogCount: 0, cutoffDate };
    }

    const taskIds = taskResults.map((r) => r.id);
    let taskLogCount = 0;

    for (const chunk of chunkArray(taskIds, CHUNK_SIZE)) {
      const result = this.db
        .select({ cnt: count() })
        .from(taskLogs)
        .where(inArray(taskLogs.taskId, chunk))
        .get();
      taskLogCount += result?.cnt ?? 0;
    }

    return { taskLogCount, cutoffDate };
  }

  previewKeepLast(n: number): KeepLastPreview {
    const totalResult = this.db
      .select({ cnt: count() })
      .from(stories)
      .where(eq(stories.status, 'done'))
      .get();
    const totalCompleted = totalResult?.cnt ?? 0;

    if (totalCompleted <= n) {
      return { storiesToDelete: 0, tasksToDelete: 0, taskLogsToDelete: 0, totalCompleted };
    }

    const keepResults = this.db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.status, 'done'))
      .orderBy(desc(stories.updatedAt))
      .limit(n)
      .all();
    const keepIds = keepResults.map((r) => r.id);

    const deleteStoryResults =
      keepIds.length > 0
        ? this.db
            .select({ id: stories.id })
            .from(stories)
            .where(and(eq(stories.status, 'done'), notInArray(stories.id, keepIds)))
            .all()
        : this.db
            .select({ id: stories.id })
            .from(stories)
            .where(eq(stories.status, 'done'))
            .all();

    const deleteStoryIds = deleteStoryResults.map((r) => r.id);
    const storiesToDelete = deleteStoryIds.length;

    if (storiesToDelete === 0) {
      return { storiesToDelete: 0, tasksToDelete: 0, taskLogsToDelete: 0, totalCompleted };
    }

    let tasksToDelete = 0;
    let taskIdsToDelete: number[] = [];

    for (const chunk of chunkArray(deleteStoryIds, CHUNK_SIZE)) {
      const taskResults = this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(inArray(tasks.storyId, chunk))
        .all();
      taskIdsToDelete = taskIdsToDelete.concat(taskResults.map((r) => r.id));
      tasksToDelete += taskResults.length;
    }

    let taskLogsToDelete = 0;
    if (taskIdsToDelete.length > 0) {
      for (const chunk of chunkArray(taskIdsToDelete, CHUNK_SIZE)) {
        const logResult = this.db
          .select({ cnt: count() })
          .from(taskLogs)
          .where(inArray(taskLogs.taskId, chunk))
          .get();
        taskLogsToDelete += logResult?.cnt ?? 0;
      }
    }

    return { storiesToDelete, tasksToDelete, taskLogsToDelete, totalCompleted };
  }

  cleanupOlderThan(days: number): CleanupResult {
    try {
      logger.info('cleanup: starting');
      const cutoffDate = new Date(Date.now() - days * 86_400_000).toISOString();

      const taskResults = this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(isNotNull(tasks.completedAt), lt(tasks.completedAt, cutoffDate)))
        .all();

      if (taskResults.length === 0) {
        logger.info('cleanup: complete', { taskLogsDeleted: 0, tasksDeleted: 0, storiesDeleted: 0 });
        return { taskLogsDeleted: 0, tasksDeleted: 0, storiesDeleted: 0 };
      }

      const taskIds = taskResults.map((r) => r.id);

      if (taskIds.length > 100) {
        logger.warn('cleanup: large operation', { count: taskIds.length });
      }

      let taskLogsDeleted = 0;

      this.db.transaction((tx) => {
        for (const chunk of chunkArray(taskIds, CHUNK_SIZE)) {
          const deleted = tx
            .delete(taskLogs)
            .where(inArray(taskLogs.taskId, chunk))
            .returning({ id: taskLogs.id })
            .all();
          taskLogsDeleted += deleted.length;
        }
      });

      logger.info('cleanup: complete', { taskLogsDeleted, tasksDeleted: 0, storiesDeleted: 0 });
      return { taskLogsDeleted, tasksDeleted: 0, storiesDeleted: 0 };
    } catch (err: unknown) {
      logger.error('cleanup: failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  cleanupKeepLast(n: number): CleanupResult {
    try {
      logger.info('cleanup: starting');
      const keepResults = this.db
        .select({ id: stories.id })
        .from(stories)
        .where(eq(stories.status, 'done'))
        .orderBy(desc(stories.updatedAt))
        .limit(n)
        .all();
      const keepIds = keepResults.map((r) => r.id);

      const deleteStoryResults =
        keepIds.length > 0
          ? this.db
              .select({ id: stories.id })
              .from(stories)
              .where(and(eq(stories.status, 'done'), notInArray(stories.id, keepIds)))
              .all()
          : this.db
              .select({ id: stories.id })
              .from(stories)
              .where(eq(stories.status, 'done'))
              .all();

      const deleteStoryIds = deleteStoryResults.map((r) => r.id);

      if (deleteStoryIds.length === 0) {
        logger.info('cleanup: complete', { taskLogsDeleted: 0, tasksDeleted: 0, storiesDeleted: 0 });
        return { taskLogsDeleted: 0, tasksDeleted: 0, storiesDeleted: 0 };
      }

      if (deleteStoryIds.length > 100) {
        logger.warn('cleanup: large operation', { count: deleteStoryIds.length });
      }

      let taskIdsToDelete: number[] = [];
      for (const chunk of chunkArray(deleteStoryIds, CHUNK_SIZE)) {
        const taskResults = this.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.storyId, chunk))
          .all();
        taskIdsToDelete = taskIdsToDelete.concat(taskResults.map((r) => r.id));
      }

      let taskLogsDeleted = 0;
      let tasksDeleted = 0;
      let storiesDeleted = 0;

      this.db.transaction((tx) => {
        if (taskIdsToDelete.length > 0) {
          for (const chunk of chunkArray(taskIdsToDelete, CHUNK_SIZE)) {
            const deleted = tx
              .delete(taskLogs)
              .where(inArray(taskLogs.taskId, chunk))
              .returning({ id: taskLogs.id })
              .all();
            taskLogsDeleted += deleted.length;
          }
        }

        for (const chunk of chunkArray(deleteStoryIds, CHUNK_SIZE)) {
          const deleted = tx
            .delete(tasks)
            .where(inArray(tasks.storyId, chunk))
            .returning({ id: tasks.id })
            .all();
          tasksDeleted += deleted.length;
        }

        for (const chunk of chunkArray(deleteStoryIds, CHUNK_SIZE)) {
          const deleted = tx
            .delete(stories)
            .where(inArray(stories.id, chunk))
            .returning({ id: stories.id })
            .all();
          storiesDeleted += deleted.length;
        }
      });

      logger.info('cleanup: complete', { taskLogsDeleted, tasksDeleted, storiesDeleted });
      return { taskLogsDeleted, tasksDeleted, storiesDeleted };
    } catch (err: unknown) {
      logger.error('cleanup: failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
