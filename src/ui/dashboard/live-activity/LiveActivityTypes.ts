export const MAX_LIVE_EVENTS = 300;

export interface WorkerFocus {
  taskId: number;
  stageName: string;
  label: string;
}

export interface LiveActivityEvent {
  id: number;
  taskId: number;
  stageName: string;
  timestamp: number;
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'error';
  lines: string[];
}

export interface LiveActivityState {
  events: LiveActivityEvent[];
  workers: WorkerFocus[];
  focusedWorkerIndex: number;
  scrollOffset: number;
}

export interface FullscreenUseLiveActivityResult {
  state: LiveActivityState;
  scrollUp: () => void;
  scrollDown: () => void;
  focusNextWorker: () => void;
  focusPrevWorker: () => void;
}
