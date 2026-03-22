import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { EventBus } from '@core/EventBus.js';
import type { WorkerEvent, QueueEvent, PipelineEvent, PipelineDrainingEvent } from '@core/EventTypes.js';
import type { WorkerStatusEntry, PipelineState } from '@ui/dashboard/shared/DashboardTypes.js';

export interface QueueStats {
  done: number;
  queued: number;
  failed: number;
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

export interface WorkerStore {
  workerStatuses: WorkerStatusEntry[];
  pipelineState: PipelineState;
  queueStats: QueueStats | null;
  init: (eventBus: EventBus) => void;
  cleanup: () => void;
  isPipelineRunning: () => boolean;
}

// Module-level closure variables — NOT React refs
let _workerStatusesBuf: WorkerStatusEntry[] = [];
let _rawQueueStatsBuf: QueueStats | null = null;
let _dirty = false;
let _lastUpdate = 0;
let _flushInterval: ReturnType<typeof setInterval> | null = null;

// Stored handler refs for cleanup
let _eventBus: EventBus | null = null;
let _onBusy: ((e: WorkerEvent) => void) | null = null;
let _onIdle: ((e: WorkerEvent) => void) | null = null;
let _onPipelineStart: ((e: PipelineEvent) => void) | null = null;
let _onPipelineDraining: ((e: PipelineDrainingEvent) => void) | null = null;
let _onPipelineStop: ((e: PipelineEvent) => void) | null = null;
let _onPipelineTerminated: ((e: PipelineEvent) => void) | null = null;
let _onQueueUpdated: ((e: QueueEvent) => void) | null = null;

const THROTTLE_MS = 250;

function queueStatsEqual(a: QueueStats | null, b: QueueStats | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.done === b.done && a.queued === b.queued && a.failed === b.failed;
}

const _store = create<WorkerStore>()(
  subscribeWithSelector((set, get) => ({
    workerStatuses: [],
    pipelineState: 'stopped',
    queueStats: null,

    isPipelineRunning: (): boolean => {
      return get().pipelineState === 'running';
    },

    init: (eventBus: EventBus): void => {
      get().cleanup();

      const computeQueueStats = (): QueueStats | null => {
        return get().pipelineState !== 'stopped' ? _rawQueueStatsBuf : null;
      };

      const flushUpdates = (): void => {
        if (!_dirty) return;
        const now = Date.now();
        if (now - _lastUpdate >= THROTTLE_MS) {
          const newQueueStats = computeQueueStats();
          const prevQueueStats = get().queueStats;
          const patch: Partial<WorkerStore> = { workerStatuses: [..._workerStatusesBuf] };
          if (!queueStatsEqual(newQueueStats, prevQueueStats)) {
            patch.queueStats = newQueueStats;
          }
          set(patch);
          _lastUpdate = now;
          _dirty = false;
        }
      };

      const updateWorker = (stageName: string, status: 'run' | 'idle'): void => {
        const prev = _workerStatusesBuf;
        const existing = prev.find((w) => w.stageName === stageName);
        if (existing) {
          _workerStatusesBuf = prev.map((w) =>
            w.stageName === stageName
              ? { ...w, status, runStartedAt: status === 'run' ? Date.now() : null }
              : w,
          );
        } else {
          _workerStatusesBuf = [
            ...prev,
            {
              stageName,
              displayName: deriveDisplayName(stageName),
              status,
              runStartedAt: status === 'run' ? Date.now() : null,
            },
          ];
        }
        _dirty = true;
        flushUpdates();
      };

      _onBusy = (event: WorkerEvent): void => {
        updateWorker(event.stageName, 'run');
        set((s) => ({ pipelineState: s.pipelineState === 'draining' ? 'draining' : 'running' }));
      };

      _onIdle = (event: WorkerEvent): void => {
        updateWorker(event.stageName, 'idle');
      };

      _onPipelineStart = (_event: PipelineEvent): void => {
        set({ pipelineState: 'running' });
      };

      _onPipelineDraining = (_event: PipelineDrainingEvent): void => {
        set({ pipelineState: 'draining' });
      };

      _onPipelineStop = (_event: PipelineEvent): void => {
        _workerStatusesBuf = _workerStatusesBuf.map((w) => ({
          ...w,
          status: 'idle' as const,
          runStartedAt: null,
        }));
        set({ pipelineState: 'stopped', workerStatuses: [..._workerStatusesBuf], queueStats: null });
      };

      _onPipelineTerminated = (_event: PipelineEvent): void => {
        _workerStatusesBuf = _workerStatusesBuf.map((w) => ({
          ...w,
          status: 'idle' as const,
          runStartedAt: null,
        }));
        set({ pipelineState: 'stopped', workerStatuses: [..._workerStatusesBuf], queueStats: null });
      };

      _onQueueUpdated = (event: QueueEvent): void => {
        _rawQueueStatsBuf = {
          done: event.completed,
          queued: event.pending,
          failed: event.failed,
        };
        _dirty = true;
        flushUpdates();
      };

      eventBus.on('worker:busy', _onBusy);
      eventBus.on('worker:idle', _onIdle);
      eventBus.on('pipeline:start', _onPipelineStart);
      eventBus.on('pipeline:draining', _onPipelineDraining);
      eventBus.on('pipeline:stop', _onPipelineStop);
      eventBus.on('pipeline:terminated', _onPipelineTerminated);
      eventBus.on('queue:updated', _onQueueUpdated);

      _eventBus = eventBus;
      _flushInterval = setInterval(flushUpdates, 2000);
    },

    cleanup: (): void => {
      if (_eventBus) {
        if (_onBusy) _eventBus.off('worker:busy', _onBusy);
        if (_onIdle) _eventBus.off('worker:idle', _onIdle);
        if (_onPipelineStart) _eventBus.off('pipeline:start', _onPipelineStart);
        if (_onPipelineDraining) _eventBus.off('pipeline:draining', _onPipelineDraining);
        if (_onPipelineStop) _eventBus.off('pipeline:stop', _onPipelineStop);
        if (_onPipelineTerminated) _eventBus.off('pipeline:terminated', _onPipelineTerminated);
        if (_onQueueUpdated) _eventBus.off('queue:updated', _onQueueUpdated);
        _eventBus = null;
      }
      _onBusy = null;
      _onIdle = null;
      _onPipelineStart = null;
      _onPipelineDraining = null;
      _onPipelineStop = null;
      _onPipelineTerminated = null;
      _onQueueUpdated = null;
      if (_flushInterval !== null) {
        clearInterval(_flushInterval);
        _flushInterval = null;
      }
      // Reset buffers for clean state on next init
      _workerStatusesBuf = [];
      _rawQueueStatsBuf = null;
      _dirty = false;
      _lastUpdate = 0;
    },
  })),
);

// Patch setState to always merge (never replace) so test resets preserve action methods.
const _origSetState = _store.setState;
_store.setState = (partial, _replace) => {
  const resolved = typeof partial === 'function' ? partial(_store.getState()) : partial;
  _origSetState(resolved);
};

export const useWorkerStore = _store;
