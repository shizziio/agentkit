export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'blocked';

export interface DequeueResult {
  id: number;
  storyId: number;
  parentId: number | null;
  team: string;
  stageName: string;
  status: TaskStatus;
  prompt: string | null;
  input: string | null;
  output: string | null;
  workerModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  attempt: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PipelineStatus {
  queued: number;
  running: number;
  done: number;
  failed: number;
  total: number;
}

export interface StoryProgress {
  storyId: number;
  currentStage: string | null;
  currentStatus: TaskStatus | null;
  completedStages: string[];
  totalTasks: number;
}

export interface TaskChainItem {
  id: number;
  storyId: number;
  parentId: number | null;
  stageName: string;
  status: TaskStatus;
  createdAt: string;
  superseded: boolean;
}

export interface StageStatistic {
  stageName: string;
  averageDurationMs: number | null;
}

export interface Statistics {
  doneTodayCount: number;
  failedCount: number;
  averageDurationPerStage: StageStatistic[];
}
