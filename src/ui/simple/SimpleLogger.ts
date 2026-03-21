import chalk from 'chalk';

import type { EventBus } from '@core/EventBus.js';
import type {
  PipelineEvent,
  PipelineReadyEvent,
  TaskEvent,
  TaskRecoveredEvent,
  StoryCompleteEvent,
  StoryBlockedEvent,
} from '@core/EventTypes.js';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

const STAGE_COLORS: Record<string, (s: string) => string> = {
  sm: (s) => chalk.blue(s),
  dev: (s) => chalk.cyan(s),
  review: (s) => chalk.yellow(s),
  tester: (s) => chalk.magenta(s),
};

const DEFAULT_COLOR = (s: string): string => chalk.bold.white(s);

export class SimpleLogger {
  private readonly eventBus: EventBus;

  private readonly onPipelineStart: (p: PipelineEvent) => void;
  private readonly onPipelineReady: (p: PipelineReadyEvent) => void;
  private readonly onPipelineStop: (p: PipelineEvent) => void;
  private readonly onTaskStarted: (p: TaskEvent) => void;
  private readonly onTaskCompleted: (p: TaskEvent) => void;
  private readonly onTaskFailed: (p: TaskEvent) => void;
  private readonly onTaskRouted: (p: TaskEvent) => void;
  private readonly onTaskRejected: (p: TaskEvent) => void;
  private readonly onTaskRecovered: (p: TaskRecoveredEvent) => void;
  private readonly onStoryCompleted: (p: StoryCompleteEvent) => void;
  private readonly onStoryBlocked: (p: StoryBlockedEvent) => void;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;

    this.onPipelineStart = () => {
      this.log('PIPELINE', 'Pipeline starting...');
    };

    this.onPipelineReady = (payload) => {
      const count = payload.recoveryResult.recoveredCount;
      if (count > 0) {
        this.log('PIPELINE', `Pipeline ready. Recovered ${count} task(s).`);
      } else {
        this.log('PIPELINE', 'Pipeline ready.');
      }
    };

    this.onPipelineStop = () => {
      this.log('PIPELINE', 'Pipeline stopped.');
    };

    this.onTaskStarted = (payload) => {
      const attempt = payload.attempt ?? 1;
      this.log(payload.stageName, `Task #${payload.taskId} started (attempt ${attempt})`);
    };

    this.onTaskCompleted = (payload) => {
      let msg = `Task #${payload.taskId} completed`;
      if (payload.durationMs != null) {
        msg += ` in ${payload.durationMs}ms`;
      }
      this.log(payload.stageName, chalk.green(msg));
    };

    this.onTaskFailed = (payload) => {
      const error = payload.error ?? 'unknown error';
      this.log(payload.stageName, chalk.red(`Task #${payload.taskId} FAILED: ${error}`));
    };

    this.onTaskRouted = (payload) => {
      this.log(payload.stageName, `Task #${payload.taskId} routed to next stage`);
    };

    this.onTaskRejected = (payload) => {
      const attempt = payload.attempt ?? '?';
      this.log(
        payload.stageName,
        chalk.yellow(`Task #${payload.taskId} rejected (attempt ${attempt})`),
      );
    };

    this.onTaskRecovered = (payload) => {
      this.log(
        payload.stageName,
        chalk.magenta(`Task #${payload.taskId} recovered from previous run`),
      );
    };

    this.onStoryCompleted = (payload) => {
      const duration = formatDuration(payload.durationMs);
      const border = '━'.repeat(50);
      const block =
        `${border}\n` +
        `  ✓ Story Completed: ${payload.storyKey}  (${payload.epicKey})\n` +
        `    Duration: ${duration}\n` +
        `${border}\n`;
      process.stdout.write(chalk.green(block));
    };

    this.onStoryBlocked = (payload) => {
      this.log('PIPELINE', chalk.red(`Story ${payload.storyKey} BLOCKED: ${payload.reason}`));
    };

    eventBus.on('pipeline:start', this.onPipelineStart);
    eventBus.on('pipeline:ready', this.onPipelineReady);
    eventBus.on('pipeline:stop', this.onPipelineStop);
    eventBus.on('task:started', this.onTaskStarted);
    eventBus.on('task:completed', this.onTaskCompleted);
    eventBus.on('task:failed', this.onTaskFailed);
    eventBus.on('task:routed', this.onTaskRouted);
    eventBus.on('task:rejected', this.onTaskRejected);
    eventBus.on('task:recovered', this.onTaskRecovered);
    eventBus.on('story:completed', this.onStoryCompleted);
    eventBus.on('story:blocked', this.onStoryBlocked);
  }

  private formatTimestamp(): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  private formatStage(stageName: string): string {
    const colorFn = STAGE_COLORS[stageName] ?? DEFAULT_COLOR;
    return colorFn(`[${stageName.toUpperCase()}]`);
  }

  private log(stageName: string, message: string): void {
    const ts = `[${this.formatTimestamp()}]`;
    const stage = this.formatStage(stageName);
    process.stdout.write(`${ts} ${stage} ${message}\n`);
  }

  detach(): void {
    this.eventBus.off('pipeline:start', this.onPipelineStart);
    this.eventBus.off('pipeline:ready', this.onPipelineReady);
    this.eventBus.off('pipeline:stop', this.onPipelineStop);
    this.eventBus.off('task:started', this.onTaskStarted);
    this.eventBus.off('task:completed', this.onTaskCompleted);
    this.eventBus.off('task:failed', this.onTaskFailed);
    this.eventBus.off('task:routed', this.onTaskRouted);
    this.eventBus.off('task:rejected', this.onTaskRejected);
    this.eventBus.off('task:recovered', this.onTaskRecovered);
    this.eventBus.off('story:completed', this.onStoryCompleted);
    this.eventBus.off('story:blocked', this.onStoryBlocked);
  }
}
