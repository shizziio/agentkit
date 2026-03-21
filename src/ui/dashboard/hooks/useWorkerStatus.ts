import { useEffect, useState, useRef } from 'react';

import type { EventBus } from '@core/EventBus.js';
import type { WorkerEvent, QueueEvent, PipelineEvent } from '@core/EventTypes.js';
import type { WorkerStatusEntry, PipelineState } from '../shared/DashboardTypes.js';

export interface QueueStats {
  done: number;
  queued: number;
  failed: number;
}

export interface UseWorkerStatusResult {
  workerStatuses: WorkerStatusEntry[];
  /** @deprecated Use pipelineState instead */
  isPipelineRunning: boolean;
  pipelineState: PipelineState;
  queueStats: QueueStats | null;
}

export function deriveDisplayName(stageName: string): string {
  const base = stageName.replace(/-worker$/, '');
  if (base.length <= 2) return base.toUpperCase();
  const first3 = base.slice(0, 3);
  return first3.charAt(0).toUpperCase() + first3.slice(1).toLowerCase();
}

export function formatElapsed(runStartedAt: number | null): string {
  if (runStartedAt === null) return '';
  const ms = Date.now() - runStartedAt;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function useWorkerStatus(eventBus: EventBus): UseWorkerStatusResult {
  const [workerStatuses, setWorkerStatuses] = useState<WorkerStatusEntry[]>([]);
  const [pipelineState, setPipelineState] = useState<PipelineState>('stopped');
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);

  // Use refs for throttling updates to the TUI
  const workerStatusesRef = useRef<WorkerStatusEntry[]>([]);
  const queueStatsRef = useRef<QueueStats | null>(null);
  const lastUpdateRef = useRef(0);
  const dirtyRef = useRef(false);
  const THROTTLE_MS = 250; // Max 4 updates per second for TUI stability

  useEffect(() => {
    const flushUpdates = () => {
      if (!dirtyRef.current) return;
      const now = Date.now();
      if (now - lastUpdateRef.current >= THROTTLE_MS) {
        setWorkerStatuses([...workerStatusesRef.current]);
        setQueueStats(queueStatsRef.current ? { ...queueStatsRef.current } : null);
        lastUpdateRef.current = now;
        dirtyRef.current = false;
      }
    };

    const updateWorker = (stageName: string, status: 'run' | 'idle') => {
      const prev = workerStatusesRef.current;
      const existing = prev.find((w) => w.stageName === stageName);
      if (existing) {
        workerStatusesRef.current = prev.map((w) =>
          w.stageName === stageName
            ? { ...w, status, runStartedAt: status === 'run' ? Date.now() : null }
            : w,
        );
      } else {
        workerStatusesRef.current = [
          ...prev,
          {
            stageName,
            displayName: deriveDisplayName(stageName),
            status,
            runStartedAt: status === 'run' ? Date.now() : null,
          }
        ];
      }
      dirtyRef.current = true;
      flushUpdates();
    };

    const onBusy = (event: WorkerEvent): void => {
      updateWorker(event.stageName, 'run');
      // If a worker is busy, the pipeline must be running — cover cases where
      // pipeline:start was missed (auto-start race, trace mode remount).
      // Only set to 'running' if not already in 'draining' state.
      setPipelineState((prev) => prev === 'draining' ? prev : 'running');
    };

    const onIdle = (event: WorkerEvent): void => {
      updateWorker(event.stageName, 'idle');
    };

    const onPipelineStart = (_event: PipelineEvent): void => {
      setPipelineState('running');
    };

    const onPipelineDraining = (_event: PipelineEvent): void => {
      setPipelineState('draining');
    };

    const onPipelineStop = (_event: PipelineEvent): void => {
      setPipelineState('stopped');
      workerStatusesRef.current = workerStatusesRef.current.map((w) => ({
        ...w,
        status: 'idle' as const,
        runStartedAt: null,
      }));
      setWorkerStatuses([...workerStatusesRef.current]);
    };

    const onPipelineTerminated = (_event: PipelineEvent): void => {
      setPipelineState('stopped');
      workerStatusesRef.current = workerStatusesRef.current.map((w) => ({
        ...w,
        status: 'idle' as const,
        runStartedAt: null,
      }));
      setWorkerStatuses([...workerStatusesRef.current]);
    };

    const onQueueUpdated = (event: QueueEvent): void => {
      queueStatsRef.current = {
        done: event.completed,
        queued: event.pending,
        failed: event.failed,
      };
      dirtyRef.current = true;
      flushUpdates();
    };

    eventBus.on('worker:busy', onBusy);
    eventBus.on('worker:idle', onIdle);
    eventBus.on('pipeline:start', onPipelineStart);
    eventBus.on('pipeline:draining', onPipelineDraining);
    eventBus.on('pipeline:stop', onPipelineStop);
    eventBus.on('pipeline:terminated', onPipelineTerminated);
    eventBus.on('queue:updated', onQueueUpdated);

    // Final flush every 2s guaranteed if there are pending updates
    const interval = setInterval(flushUpdates, 2000);

    return () => {
      clearInterval(interval);
      eventBus.off('worker:busy', onBusy);
      eventBus.off('worker:idle', onIdle);
      eventBus.off('pipeline:start', onPipelineStart);
      eventBus.off('pipeline:draining', onPipelineDraining);
      eventBus.off('pipeline:stop', onPipelineStop);
      eventBus.off('pipeline:terminated', onPipelineTerminated);
      eventBus.off('queue:updated', onQueueUpdated);
    };
  }, [eventBus]);

  const isPipelineRunning = pipelineState === 'running';
  // Only expose queueStats when pipeline is not stopped
  return {
    workerStatuses,
    isPipelineRunning,
    pipelineState,
    queueStats: pipelineState !== 'stopped' ? queueStats : null,
  };
}
