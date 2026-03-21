import { useState, useEffect, useCallback } from 'react';

import type { EventBus } from '@core/EventBus.js';
import type { AlertEvent } from '@core/EventTypes.js';
import type { AlertOverlayEntry, UseAlertOverlayResult } from '../modals/AlertOverlayTypes.js';

export function useAlertOverlay(
  eventBus: EventBus,
  onViewDetails: () => void,
): UseAlertOverlayResult {
  const [queue, setQueue] = useState<AlertOverlayEntry[]>([]);

  useEffect(() => {
    const onAlert = (event: AlertEvent): void => {
      const entry: AlertOverlayEntry = {
        id: Math.random().toString(36).slice(2),
        taskId: event.taskId,
        storyId: event.storyId,
        storyTitle: event.storyTitle,
        stageName: event.stageName,
        issues: event.issues,
        routedTo: event.routedTo,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        isBlocked: event.isBlocked,
        timestamp: Date.now(),
      };
      setQueue((prev) => [...prev, entry]);
    };

    eventBus.on('task:alert', onAlert);
    return () => {
      eventBus.off('task:alert', onAlert);
    };
  }, [eventBus]);

  const dismiss = useCallback((): void => {
    setQueue((prev) => prev.slice(1));
  }, []);

  const viewDetails = useCallback((): void => {
    onViewDetails();
    setQueue((prev) => prev.slice(1));
  }, [onViewDetails]);

  return {
    currentAlert: queue[0] ?? null,
    queueLength: queue.length,
    dismiss,
    viewDetails,
  };
}
