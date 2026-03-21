import { Logger } from '@core/Logger.js';

import type { PipelineOptions, RecoveryResult } from './PipelineTypes.js';
import { PipelineService } from './PipelineService.js';

const logger = Logger.getOrNoop('Pipeline');

export class Pipeline {
  private readonly options: PipelineOptions;

  constructor(options: PipelineOptions) {
    this.options = options;
  }

  async start(): Promise<RecoveryResult> {
    try {
      logger.info('pipeline: starting');

      const pipelineService = new PipelineService(this.options.db);
      const result = pipelineService.recoverOrphanedTasks();

      for (const task of result.recoveredTasks) {
        logger.warn('pipeline: orphaned task recovered', { taskId: task.id, stageName: task.stageName, storyId: task.storyId });
        this.options.eventBus.emit('task:recovered', {
          taskId: task.id,
          storyId: task.storyId,
          stageName: task.stageName,
          attempt: task.attempt,
        });
      }

      this.options.eventBus.emit('pipeline:start', {
        projectId: this.options.projectId,
        timestamp: new Date().toISOString(),
      });

      this.options.eventBus.emit('pipeline:ready', {
        projectId: this.options.projectId,
        recoveryResult: result,
      });
      logger.info('pipeline: ready');

      return result;
    } catch (err: unknown) {
      logger.error('pipeline: startup failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
