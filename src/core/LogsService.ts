import { eq, and, desc, asc, inArray } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import { taskLogs, tasks, stories, epics } from '@core/db/schema.js';
import { LogsError } from '@core/Errors.js';
import type { LogEntry, LogsQueryOptions, LogsResult } from '@core/LogsTypes.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('LogsService');

export class LogsService {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  query(projectId: number, opts: LogsQueryOptions): LogsResult {
    try {
      logger.debug('logs: query', { taskId: opts.taskId, limit: opts.lastN ?? 5 });
      const lastN = opts.lastN ?? 5;

      if (opts.taskId !== undefined) {
        return this.queryByTaskId(projectId, opts.taskId);
      }

      if (opts.stageName !== undefined) {
        return this.queryByStageName(projectId, opts.stageName, lastN);
      }

      return this.queryDefault(projectId, lastN);
    } catch (err: unknown) {
      logger.error('logs: query failed', { taskId: opts.taskId, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private queryByTaskId(projectId: number, taskId: number): LogsResult {
    // Verify task belongs to project
    const taskRow = this.db
      .select({ id: tasks.id, stageName: tasks.stageName, storyId: tasks.storyId })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .innerJoin(epics, and(eq(stories.epicId, epics.id), eq(epics.projectId, projectId)))
      .where(eq(tasks.id, taskId))
      .get();

    if (!taskRow) {
      throw new LogsError(`Task ${taskId} not found in project ${projectId}`);
    }

    const rows = this.db
      .select({
        id: taskLogs.id,
        taskId: taskLogs.taskId,
        sequence: taskLogs.sequence,
        eventType: taskLogs.eventType,
        eventData: taskLogs.eventData,
        createdAt: taskLogs.createdAt,
        stageName: tasks.stageName,
        storyId: tasks.storyId,
      })
      .from(taskLogs)
      .innerJoin(tasks, eq(taskLogs.taskId, tasks.id))
      .where(eq(taskLogs.taskId, taskId))
      .orderBy(asc(taskLogs.sequence))
      .all();

    const entries = rows.map((r) => this.mapRow(r));
    return { entries, taskIds: [taskId] };
  }

  private queryByStageName(projectId: number, stageName: string, lastN: number): LogsResult {
    const taskRows = this.db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .innerJoin(epics, and(eq(stories.epicId, epics.id), eq(epics.projectId, projectId)))
      .where(eq(tasks.stageName, stageName))
      .orderBy(desc(tasks.id))
      .limit(lastN)
      .all();

    if (taskRows.length === 0) {
      return { entries: [], taskIds: [] };
    }

    const taskIds = taskRows.map((r) => r.id).sort((a, b) => a - b);
    return this.fetchLogsForTaskIds(taskIds);
  }

  private queryDefault(projectId: number, lastN: number): LogsResult {
    const taskRows = this.db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .innerJoin(epics, and(eq(stories.epicId, epics.id), eq(epics.projectId, projectId)))
      .orderBy(desc(tasks.id))
      .limit(lastN)
      .all();

    if (taskRows.length === 0) {
      return { entries: [], taskIds: [] };
    }

    const taskIds = taskRows.map((r) => r.id).sort((a, b) => a - b);
    return this.fetchLogsForTaskIds(taskIds);
  }

  private fetchLogsForTaskIds(taskIds: number[]): LogsResult {
    const rows = this.db
      .select({
        id: taskLogs.id,
        taskId: taskLogs.taskId,
        sequence: taskLogs.sequence,
        eventType: taskLogs.eventType,
        eventData: taskLogs.eventData,
        createdAt: taskLogs.createdAt,
        stageName: tasks.stageName,
        storyId: tasks.storyId,
      })
      .from(taskLogs)
      .innerJoin(tasks, eq(taskLogs.taskId, tasks.id))
      .where(inArray(taskLogs.taskId, taskIds))
      .orderBy(asc(taskLogs.taskId), asc(taskLogs.sequence))
      .all();

    const entries = rows.map((r) => this.mapRow(r));
    return { entries, taskIds };
  }

  private mapRow(r: {
    id: number;
    taskId: number;
    sequence: number;
    eventType: string;
    eventData: string;
    createdAt: string;
    stageName: string;
    storyId: number;
  }): LogEntry {
    let eventData: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(r.eventData);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        eventData = parsed as Record<string, unknown>;
      }
    } catch {
      // leave as empty object
    }
    return {
      id: r.id,
      taskId: r.taskId,
      sequence: r.sequence,
      eventType: r.eventType,
      eventData,
      createdAt: r.createdAt,
      stageName: r.stageName,
      storyId: r.storyId,
    };
  }
}
