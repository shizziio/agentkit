// Core-layer type definitions for the trace browser feature

export interface EpicNode {
  id: number;
  epicKey: string;
  title: string;
  status: string;
  storyCount: number;
  completionPct: number;
  orderIndex: number;
}

export interface StoryNode {
  id: number;
  epicId: number;
  storyKey: string;
  title: string;
  status: string;
  totalDurationMs: number | null;
  orderIndex: number;
}

export interface TaskNode {
  id: number;
  storyId: number;
  team: string;
  stageName: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  reworkLabel: string | null;
  workerModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  input: string | null;
  output: string | null;
  sessionName: string | null;
  superseded: boolean;
}

export type TreeNode = EpicNode | StoryNode | TaskNode;

export interface TraceState {
  expandedEpics: Set<number>;
  expandedStories: Set<number>;
  focusedLine: number;
  searchFilter: string;
  inspectMode: null | 'details' | 'logs';
  selectedTaskId: number | null;
  logsScrollIndex: number;
}

export interface TraceSummary {
  totalEpics: number;
  totalStories: number;
  totalTasks: number;
  completionRate: number; // percentage of stories with status 'done'
  averageDurationPerStage: Array<{ stageName: string; avgMs: number }>;
}

export interface TraceTaskLog {
  id: number;
  taskId: number;
  sequence: number;
  eventType: string;
  eventData: string;
  createdAt: string;
}

export interface ITraceService {
  getEpics(projectId: number): EpicNode[];
  getStoriesForEpic(epicId: number): StoryNode[];
  getTasksForStory(storyId: number, showSuperseded?: boolean, teamFilter?: string): TaskNode[];
  getTaskLogs(taskId: number): TraceTaskLog[];
  replayTask(taskId: number): void;
  markTaskDone(taskId: number): void;
  markStoryDone(storyId: number): void;
  getSummary(projectId: number): TraceSummary;
}
