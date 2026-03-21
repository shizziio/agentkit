import { eq, and, asc, desc } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import { tasks, stories } from '@core/db/schema.js';
import type { DequeueResult } from '@core/QueueTypes.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('Queue');

export class Queue {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  dequeue(stageName: string, activeTeam: string): DequeueResult | null {
    try {
      const result = this.db.transaction((tx) => {
        // INNER JOIN stories to read priority. Orphaned tasks (no matching story) are
        // excluded — this is acceptable as a task without a story is an invalid DB state.
        // NOTE: Requires migration 0005_story_priority.sql (Story 20.1) to be applied.
        const task = tx
          .select({
            id: tasks.id,
            storyId: tasks.storyId,
            parentId: tasks.parentId,
            team: tasks.team,
            stageName: tasks.stageName,
            status: tasks.status,
            prompt: tasks.prompt,
            input: tasks.input,
            output: tasks.output,
            workerModel: tasks.workerModel,
            inputTokens: tasks.inputTokens,
            outputTokens: tasks.outputTokens,
            attempt: tasks.attempt,
            maxAttempts: tasks.maxAttempts,
            startedAt: tasks.startedAt,
            completedAt: tasks.completedAt,
            durationMs: tasks.durationMs,
            createdAt: tasks.createdAt,
            updatedAt: tasks.updatedAt,
            version: tasks.version,
          })
          .from(tasks)
          .innerJoin(stories, eq(stories.id, tasks.storyId))
          .where(and(eq(tasks.team, activeTeam), eq(tasks.stageName, stageName), eq(tasks.status, 'queued')))
          .orderBy(desc(stories.priority), asc(tasks.createdAt))
          .limit(1)
          .get();

        if (task === undefined) {
          return null;
        }

        const now = new Date().toISOString();

        tx.update(tasks)
          .set({ status: 'running', startedAt: now, updatedAt: now })
          .where(eq(tasks.id, task.id))
          .run();

        return {
          id: task.id,
          storyId: task.storyId,
          parentId: task.parentId,
          team: task.team,
          stageName: task.stageName,
          status: 'running' as const,
          prompt: task.prompt,
          input: task.input,
          output: task.output,
          workerModel: task.workerModel,
          inputTokens: task.inputTokens,
          outputTokens: task.outputTokens,
          attempt: task.attempt,
          maxAttempts: task.maxAttempts,
          startedAt: now,
          completedAt: task.completedAt,
          durationMs: task.durationMs,
          createdAt: task.createdAt,
          updatedAt: now,
          version: task.version,
        };
      });
      if (result !== null) {
        logger.info(`Dequeued task#${result.id} [stage=${stageName} story#${result.storyId} attempt=${result.attempt}/${result.maxAttempts}]`);
      } else {
        logger.debug(`Poll empty [stage=${stageName}]`);
      }
      return result;
    } catch (err: unknown) {
      logger.error(`Dequeue failed [stage=${stageName}]`, { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  cancelAllQueued(team: string): number {
    const now = new Date().toISOString();
    const result = this.db.transaction((tx) => {
      return tx
        .update(tasks)
        .set({ status: 'cancelled', updatedAt: now })
        .where(and(eq(tasks.team, team), eq(tasks.status, 'queued')))
        .run();
    });
    logger.info(`Cancelled ${result.changes} queued tasks [team=${team}]`);
    return result.changes;
  }
}
