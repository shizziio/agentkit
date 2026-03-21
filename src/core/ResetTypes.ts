export interface ResetResult {
  success: boolean;
  storyId: number;
  targetStage: string;
  supersededTaskIds: number[];
  newTaskId: number;
}

export interface CancelResult {
  success: boolean;
  storyId: number;
  cancelledTaskIds: number[];
}

export interface ReopenResult {
  success: boolean;
  storyId: number;
  supersededTaskIds: number[];
  newTaskId: number;
}

export interface ResetTarget {
  stageName: string;
  displayName: string;
  icon: string;
}

export interface StoryRow {
  id: number;
  storyKey: string;
  title: string;
  status: string;
}

export interface IResetService {
  getResetTargets(storyId: number): ResetTarget[];
  getStoriesWithActiveTasks(projectId: number): StoryRow[];
  getResetableStories(projectId: number): StoryRow[];
  startListening(): void;
  resetStory(storyId: number, targetStage: string): ResetResult;
  cancelStory(storyId: number): CancelResult;
  reopenStory(storyId: number): ReopenResult;
  deleteTask(taskId: number): void;
  retryTask(taskId: number): void;
  pushNextStage(taskId: number): void;
}
