import { useState, useEffect } from 'react';

import type { DiagnoseResult } from '@core/DiagnoseTypes.js';
import type { EventBus } from '@core/EventBus.js';
import type { DiagnoseResultEvent } from '@core/EventTypes.js';

export interface UseDiagnosePollingResult {
  lastResult: DiagnoseResult | null;
  lastPollAt: number | null;
  nextPollAt: number | null;
  nextPollIn: number;
  isPolling: boolean;
  pollError: string | null;
}

const POLL_INTERVAL_MS = 30_000

export function useDiagnosePolling(eventBus: EventBus | undefined): UseDiagnosePollingResult {
  const [lastResult, setLastResult] = useState<DiagnoseResult | null>(null);
  const [lastPollAt, setLastPollAt] = useState<number | null>(null);
  const [nextPollAt, setNextPollAt] = useState<number | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventBus) return;

    const onDiagnoseResult = (event: DiagnoseResultEvent): void => {
      const now = Date.now();
      setLastResult(event.result);
      setLastPollAt(now);
      setNextPollAt(now + POLL_INTERVAL_MS);
      setIsPolling(true);
      setPollError(event.error ?? null);
    };

    eventBus.on('diagnose:result', onDiagnoseResult);

    return () => {
      eventBus.off('diagnose:result', onDiagnoseResult);
    };
  }, [eventBus]);

  // Compute nextPollIn as derived value — no timer needed
  const nextPollIn = nextPollAt !== null
    ? Math.max(0, Math.ceil((nextPollAt - Date.now()) / 1000))
    : 0;

  return { lastResult, lastPollAt, nextPollAt, nextPollIn, isPolling, pollError };
}
