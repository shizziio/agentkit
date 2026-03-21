export interface HistoryStory {
  id: number;
  storyKey: string;
  title: string;
  epicKey: string;
  epicTitle: string;
  status: string;
  totalDurationMs: number;
  stagesPassed: string[];
  totalAttempts: number;
  completedAt: string | null;
}

export interface HistoryTaskChainItem {
  id: number;
  parentId: number | null;
  stageName: string;
  status: string;
  attempt: number;
  input: string | null;
  output: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface HistoryStatistics {
  totalCompleted: number;
  averageDurationPerStage: Array<{
    stageName: string;
    averageDurationMs: number;
  }>;
  mostReworkedStories: Array<{
    storyKey: string;
    title: string;
    totalAttempts: number;
  }>;
}

export interface HistoryFilter {
  epicId?: number;
  status?: 'done' | 'failed';
  last?: number;
}
