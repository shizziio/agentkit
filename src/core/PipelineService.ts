import { eq, sql } from 'drizzle-orm';

import type { DrizzleDB } from './db/Connection.js';
import { tasks } from './db/schema.js';
import type { RecoveryResult, RecoveredTask } from './PipelineTypes.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('PipelineService');

export class PipelineService {
  private readonly db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  recoverOrphanedTasks(): RecoveryResult {
    try {
      logger.info('recovery: starting orphan scan');

      const orphaned = this.db
        .select({
          id: tasks.id,
          storyId: tasks.storyId,
          stageName: tasks.stageName,
          attempt: tasks.attempt,
        })
        .from(tasks)
        .where(eq(tasks.status, 'running'))
        .all();

      if (orphaned.length === 0) {
        logger.info('recovery: complete', { recovered: 0 });
        return { recoveredCount: 0, recoveredTasks: [] };
      }

      logger.warn('recovery: orphaned tasks found', { count: orphaned.length });

      const now = new Date().toISOString();

      this.db.transaction((tx) => {
        for (const task of orphaned) {
          tx.update(tasks)
            .set({
              status: 'queued',
              startedAt: null,
              updatedAt: now,
              version: sql`${tasks.version} + 1`,
            })
            .where(eq(tasks.id, task.id))
            .run();
        }
      });

      const recoveredTasks: RecoveredTask[] = orphaned.map((t) => ({
        id: t.id,
        storyId: t.storyId,
        stageName: t.stageName,
        attempt: t.attempt,
      }));

      logger.info('recovery: complete', { recovered: recoveredTasks.length });
      return { recoveredCount: recoveredTasks.length, recoveredTasks };
    } catch (err: unknown) {
      logger.error('recovery: failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
