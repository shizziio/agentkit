export interface AncestorEntry {
  id: number;
  stageName: string;
  status: string;
  attempt: number;
  durationMs: number | null;
}

export interface ChildEntry {
  id: number;
  stageName: string;
  status: string;
  attempt: number;
  durationMs: number | null;
}

export interface InspectEventLogEntry {
  sequence: number;
  eventType: string;
  eventData: string;
}

export interface TaskInspectData {
  task: {
    id: number;
    stageName: string;
    status: string;
    workerModel: string | null;
    attempt: number;
    maxAttempts: number;
    durationMs: number | null;
    startedAt: string | null;
    completedAt: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    prompt: string | null;
    input: string | null;
    output: string | null;
  };
  story: {
    id: number;
    storyKey: string;
    title: string;
    status: string;
  };
  epic: {
    id: number;
    epicKey: string;
    title: string;
  };
  ancestors: AncestorEntry[];
  children: ChildEntry[];
  eventLog: InspectEventLogEntry[];
  chainTruncated: boolean;
}
