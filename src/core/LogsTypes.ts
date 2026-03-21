export interface LogEntry {
  id: number;
  taskId: number;
  sequence: number;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: string;
  stageName: string;
  storyId: number;
}

export interface LogsQueryOptions {
  taskId?: number;
  stageName?: string;
  lastN?: number;
}

export interface LogsResult {
  entries: LogEntry[];
  taskIds: number[];
}
