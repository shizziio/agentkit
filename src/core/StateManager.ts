import { eq, and, gte, count, avg } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import { tasks, stories } from '@core/db/schema.js';
import { MAX_CHAIN_LENGTH } from '@config/defaults.js';
import type {
  PipelineStatus,
  StoryProgress,
  TaskChainItem,
  Statistics,
  StageStatistic,
  TaskStatus,
} from '@core/QueueTypes.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('StateManager');

export class StateManager {
  private db: DrizzleDB;
  private activeTeam: string;

  constructor(db: DrizzleDB, activeTeam: string) {
    this.db = db;
    this.activeTeam = activeTeam;
  }

  getPipelineStatus(): PipelineStatus {
    try {
      logger.debug('stateManager: status query', { activeTeam: this.activeTeam });

      const rows = this.db
        .select({ status: tasks.status, cnt: count() })
        .from(tasks)
        .where(and(eq(tasks.team, this.activeTeam), eq(tasks.superseded, 0)))
        .groupBy(tasks.status)
        .all();

      const result: PipelineStatus = { queued: 0, running: 0, done: 0, failed: 0, total: 0 };

      for (const row of rows) {
        const c = row.cnt;
        result.total += c;
        if (row.status === 'queued') result.queued = c;
        else if (row.status === 'running') result.running = c;
        else if (row.status === 'done') result.done = c;
        else if (row.status === 'failed') result.failed = c;
      }

      logger.debug('stateManager: status result', { running: result.running, queued: result.queued, done: result.done, failed: result.failed });
      return result;
    } catch (err: unknown) {
      logger.error('stateManager: query failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  getStoryProgress(storyId: number): StoryProgress {
    const allTasks = this.db
      .select({ stageName: tasks.stageName, status: tasks.status, storyId: tasks.storyId, createdAt: tasks.createdAt, superseded: tasks.superseded })
      .from(tasks)
      .where(and(eq(tasks.storyId, storyId), eq(tasks.team, this.activeTeam)))
      .orderBy(tasks.createdAt, tasks.id)
      .all();

    const activeTasks = allTasks.filter((t) => t.superseded === 0);
    const latestTask = activeTasks[activeTasks.length - 1];

    return {
      storyId,
      currentStage: latestTask?.stageName ?? null,
      // safe: DB enforces TaskStatus values via application-level constraint — cast required because Drizzle returns string
      currentStatus: (latestTask?.status ?? null) as TaskStatus | null,
      completedStages: activeTasks
        .filter((t) => t.status === 'done')
        .map((t) => t.stageName),
      totalTasks: activeTasks.length,
    };
  }

  getTaskChain(taskId: number): TaskChainItem[] {
    const chain: TaskChainItem[] = [];
    let currentId: number | null | undefined = taskId;
    let iterations = 0;

    while (currentId !== null && currentId !== undefined && iterations < MAX_CHAIN_LENGTH) {
      const task = this.db
        .select({ id: tasks.id, storyId: tasks.storyId, parentId: tasks.parentId, stageName: tasks.stageName, status: tasks.status, createdAt: tasks.createdAt, superseded: tasks.superseded })
        .from(tasks)
        .where(eq(tasks.id, currentId))
        .get();

      if (task === undefined) break;

      chain.unshift({
        id: task.id,
        storyId: task.storyId,
        parentId: task.parentId,
        stageName: task.stageName,
        status: task.status as TaskStatus,
        createdAt: task.createdAt,
        superseded: task.superseded === 1,
      });

      currentId = task.parentId;
      iterations++;
    }

    return chain;
  }

  getQueueDepthByStage(): Record<string, number> {
    const rows = this.db
      .select({ stageName: tasks.stageName, cnt: count() })
      .from(tasks)
      .where(and(eq(tasks.team, this.activeTeam), eq(tasks.status, 'queued'), eq(tasks.superseded, 0)))
      .groupBy(tasks.stageName)
      .all();

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.stageName] = row.cnt;
    }
    return result;
  }

  getStoryCountsByStatus(): Record<string, number> {
    const rows = this.db
      .select({ status: stories.status, cnt: count() })
      .from(stories)
      .groupBy(stories.status)
      .all();

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.status] = row.cnt;
    }
    return result;
  }

  getRunningTasksByStage(): Record<string, number> {
    const rows = this.db
      .select({ stageName: tasks.stageName, cnt: count() })
      .from(tasks)
      .where(and(eq(tasks.team, this.activeTeam), eq(tasks.status, 'running'), eq(tasks.superseded, 0)))
      .groupBy(tasks.stageName)
      .all();

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.stageName] = row.cnt;
    }
    return result;
  }

  getStatistics(): Statistics {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStart = today.toISOString();

    const doneTodayRow = this.db
      .select({ cnt: count() })
      .from(tasks)
      .where(and(eq(tasks.team, this.activeTeam), eq(tasks.status, 'done'), gte(tasks.completedAt, todayStart), eq(tasks.superseded, 0)))
      .get();
    const doneTodayCount = doneTodayRow?.cnt ?? 0;

    const failedRow = this.db
      .select({ cnt: count() })
      .from(tasks)
      .where(and(eq(tasks.team, this.activeTeam), eq(tasks.status, 'failed'), eq(tasks.superseded, 0)))
      .get();
    const failedCount = failedRow?.cnt ?? 0;

    const avgRows = this.db
      .select({ stageName: tasks.stageName, avgDuration: avg(tasks.durationMs) })
      .from(tasks)
      .where(and(eq(tasks.team, this.activeTeam), eq(tasks.status, 'done'), eq(tasks.superseded, 0)))
      .groupBy(tasks.stageName)
      .all();

    const averageDurationPerStage: StageStatistic[] = avgRows.map((r) => ({
      stageName: r.stageName,
      averageDurationMs: r.avgDuration !== null ? Number(r.avgDuration) : null,
    }));

    return { doneTodayCount, failedCount, averageDurationPerStage };
  }
}
