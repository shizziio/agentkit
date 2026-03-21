export type PlaybackSpeed = 1 | 2 | 4 | 8;
export type PlaybackState = 'playing' | 'paused';

export interface ReplayEvent {
  id: number;
  sequence: number;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: number;
}

export interface ReplayTaskMeta {
  taskId: number;
  stageName: string;
  workerModel: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ReplayPlayerState {
  taskMeta: ReplayTaskMeta;
  totalEvents: number;
  loadedEvents: ReplayEvent[];
  currentIndex: number;
  playbackState: PlaybackState;
  speed: PlaybackSpeed;
  firstTimestampMs: number;
  lastTimestampMs: number;
  playbackOffsetMs: number;
  playbackResumedAt: number;
}
