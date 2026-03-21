import type { PipelineConfig } from '@core/ConfigTypes.js';
import type { EventBus } from '@core/EventBus.js';
import type { DrizzleDB } from '@core/db/Connection.js';
import { Pipeline as CorePipeline } from '@core/Pipeline.js';
import { Pipeline as WorkerPipeline } from '@workers/Pipeline.js';
import { ClaudeCliProvider } from '@providers/agent/ClaudeCliProvider.js';
import { GeminiCliProvider } from '@providers/agent/GeminiCliProvider.js';
import { CodexCliProvider } from '@providers/agent/CodexCliProvider.js';
import { Logger } from '@core/Logger.js';
import type { PipelineRef } from '@core/TeamSwitchTypes.js';

const logger = Logger.getOrNoop('WorkerToggle');

interface WorkerToggleOptions {
  db: DrizzleDB;
  pipelineConfig: PipelineConfig;
  eventBus: EventBus;
  projectId: number;
  projectRoot: string;
}

/**
 * Manages start/stop toggling of pipeline workers.
 * Guards against race conditions from rapid toggles.
 */
export class WorkerToggle implements PipelineRef {
  private workerPipeline: WorkerPipeline | null = null;
  private coreStarted = false;
  private isTransitioning = false;
  private readyListener: (() => void) | null = null;
  private reconfigureListener: ((newConfig: PipelineConfig) => void) | null = null;
  private opts: WorkerToggleOptions;

  constructor(opts: WorkerToggleOptions) {
    this.opts = opts;
    this.registerReconfigureListener();
  }

  isRunning(): boolean {
    return this.workerPipeline !== null && !this.isTransitioning;
  }

  toggle(): void {
    if (this.isTransitioning) return;

    if (this.workerPipeline) {
      this.stopWorkers();
    } else if (this.coreStarted) {
      this.startWorkers();
    } else {
      this.firstStart();
    }
  }

  /**
   * Start workers directly (for use by agentkit run where core pipeline
   * is started separately). Registers a one-time pipeline:ready listener.
   */
  registerReadyListener(): void {
    this.removeReadyListener();
    this.readyListener = (): void => {
      this.removeReadyListener();
      this.startWorkers();
    };
    this.opts.eventBus.on('pipeline:ready', this.readyListener);
    this.coreStarted = true;
    this.registerReconfigureListener();
  }

  private registerReconfigureListener(): void {
    if (this.reconfigureListener) return;

    this.reconfigureListener = (newConfig: PipelineConfig): void => {
      this.opts.pipelineConfig = newConfig;
      if (this.isRunning()) {
        // restart with new provider configs
        const pipeline = this.workerPipeline;
        if (!pipeline) return;
        this.isTransitioning = true;
        pipeline
          .stop()
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('Worker pipeline restart stop error', { error: message });
          })
          .finally(() => {
            this.workerPipeline = null;
            this.isTransitioning = false;
            this.startWorkers();
          });
      }
    };
    this.opts.eventBus.on('pipeline:reconfigured', this.reconfigureListener);
  }

  private startWorkers(): void {
    if (this.workerPipeline) return;
    
    const provider = this.opts.pipelineConfig.provider === 'gemini-cli' 
      ? new GeminiCliProvider()
      : this.opts.pipelineConfig.provider === 'codex-cli'
      ? new CodexCliProvider()
      : new ClaudeCliProvider();

    this.workerPipeline = new WorkerPipeline({
      db: this.opts.db,
      pipelineConfig: this.opts.pipelineConfig,
      provider,
      projectRoot: this.opts.projectRoot,
    });
    this.workerPipeline.start().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Worker pipeline error', { error: message });
      this.workerPipeline = null;
    });
  }

  terminate(): void {
    const pipeline = this.workerPipeline;
    if (!pipeline) return;
    this.isTransitioning = true;
    pipeline
      .terminate()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Worker pipeline terminate error', { error: message });
      })
      .finally(() => {
        this.workerPipeline = null;
        this.isTransitioning = false;
      });
  }

  drain(): void {
    if (!this.workerPipeline || this.isTransitioning) return;
    this.isTransitioning = true;
    this.workerPipeline.drain().then(
      () => {
        this.workerPipeline = null;
        this.isTransitioning = false;
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Drain error', { error: message });
        this.workerPipeline = null;
        this.isTransitioning = false;
      },
    );
  }

  private stopWorkers(): void {
    const pipeline = this.workerPipeline;
    if (!pipeline) return;
    this.isTransitioning = true;
    pipeline
      .stop()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Worker pipeline stop error', { error: message });
      })
      .finally(() => {
        this.workerPipeline = null;
        this.isTransitioning = false;
      });
  }

  private firstStart(): void {
    this.coreStarted = true;
    this.removeReadyListener();
    this.readyListener = (): void => {
      this.removeReadyListener();
      this.startWorkers();
    };
    this.opts.eventBus.on('pipeline:ready', this.readyListener);
    const corePipeline = new CorePipeline({
      db: this.opts.db,
      eventBus: this.opts.eventBus,
      projectId: this.opts.projectId,
    });
    corePipeline.start().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Core pipeline error', { error: message });
      this.removeReadyListener();
    });
  }

  private removeReadyListener(): void {
    if (this.readyListener) {
      this.opts.eventBus.off('pipeline:ready', this.readyListener);
      this.readyListener = null;
    }
  }

  // NOTE: reconfigureListener is currently left active for the life of WorkerToggle
}
