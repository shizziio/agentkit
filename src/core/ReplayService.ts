import { eq, count, asc } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import { tasks, taskLogs } from '@core/db/schema.js';
import type { TaskLog } from '@core/db/schema.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('ReplayService');

// Columns required by ReplayTaskMeta — explicit to avoid SELECT *
interface TaskRecord {
  id: number;
  stageName: string;
  workerModel: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export class ReplayService {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  getTask(taskId: number): TaskRecord | null {
    logger.debug('replay: query', { taskId });
    return (
      this.db
        .select({
          id: tasks.id,
          stageName: tasks.stageName,
          workerModel: tasks.workerModel,
          durationMs: tasks.durationMs,
          inputTokens: tasks.inputTokens,
          outputTokens: tasks.outputTokens,
        })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get() ?? null
    );
  }

  getTotalLogCount(taskId: number): number {
    const result = this.db
      .select({ total: count() })
      .from(taskLogs)
      .where(eq(taskLogs.taskId, taskId))
      .get();
    return result?.total ?? 0;
  }

  // All TaskLog columns are consumed by parseLogToEvent — explicit select for no-SELECT* compliance
  getLogsPage(taskId: number, offset: number, limit: number): TaskLog[] {
    logger.debug('replay: step', { taskId, offset, limit });
    return this.db
      .select({
        id: taskLogs.id,
        taskId: taskLogs.taskId,
        sequence: taskLogs.sequence,
        eventType: taskLogs.eventType,
        eventData: taskLogs.eventData,
        createdAt: taskLogs.createdAt,
      })
      .from(taskLogs)
      .where(eq(taskLogs.taskId, taskId))
      .orderBy(asc(taskLogs.sequence))
      .limit(limit)
      .offset(offset)
      .all();
  }
}
