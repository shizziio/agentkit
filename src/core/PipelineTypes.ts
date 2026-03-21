import type { DrizzleDB } from './db/Connection.js';
import type { EventBus } from './EventBus.js';

export interface RecoveredTask {
  id: number;
  storyId: number;
  stageName: string;
  attempt: number;
}

export interface RecoveryResult {
  recoveredCount: number;
  recoveredTasks: RecoveredTask[];
}

export interface PipelineOptions {
  db: DrizzleDB;
  eventBus: EventBus;
  projectId: number;
}
