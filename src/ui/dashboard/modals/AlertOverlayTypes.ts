export interface AlertOverlayEntry {
  id: string;
  taskId: number;
  storyId: number;
  storyTitle: string;
  stageName: string;
  issues: string[];
  routedTo?: string;
  attempt: number;
  maxAttempts: number;
  isBlocked: boolean;
  timestamp: number;
}

export interface UseAlertOverlayResult {
  currentAlert: AlertOverlayEntry | null;
  queueLength: number;
  dismiss: () => void;
  viewDetails: () => void;
}
