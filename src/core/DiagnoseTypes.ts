export type IssueType = 'stuck' | 'orphaned' | 'queue_gap' | 'loop_blocked' | 'failed' | 'blocked';

export interface DiagnoseIssue {
  taskId: number;
  storyId: number;
  storyTitle: string;
  stageName: string;
  status: string;
  elapsedMs: number;
  type: IssueType;
  suggestedAction: string;
  gapNextStage?: string;
  completedOutput?: string | null;
}

export interface DiagnoseResult {
  issues: DiagnoseIssue[];
  summary: {
    stuckCount: number;
    orphanedCount: number;
    queueGapCount: number;
    loopBlockedCount: number;
    failedCount: number;
    blockedCount: number;
  };
}

export interface AutoFixResult {
  resetCount: number;
  reroutedCount: number;
  skippedCount: number;
  markedDoneCount: number;
}

export interface IDiagnoseService {
  diagnose(): DiagnoseResult;
  autoFix(result: DiagnoseResult): AutoFixResult;
  resetTask(taskId: number): void;
  rerouteGap(issue: DiagnoseIssue): void;
  rerouteLoopBlocked(issue: DiagnoseIssue): void;
  skipTask(taskId: number): void;
  markTaskDone(taskId: number): void;
}
