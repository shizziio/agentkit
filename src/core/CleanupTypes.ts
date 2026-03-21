export interface DatabaseStats {
  fileSizeBytes: number;
  tableCounts: {
    projects: number;
    epics: number;
    stories: number;
    tasks: number;
    taskLogs: number;
  };
}

export interface OlderThanPreview {
  taskLogCount: number;
  /** ISO 8601 cutoff date */
  cutoffDate: string;
}

export interface KeepLastPreview {
  storiesToDelete: number;
  tasksToDelete: number;
  taskLogsToDelete: number;
  totalCompleted: number;
}

export interface CleanupResult {
  taskLogsDeleted: number;
  tasksDeleted: number;
  storiesDeleted: number;
}
