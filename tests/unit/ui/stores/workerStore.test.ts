import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { EventBus } from '@core/EventBus.js';
import type { EventMap, WorkerEvent, QueueEvent, PipelineEvent } from '@core/EventTypes.js';

// ---------------------------------------------------------------------------
// Mock EventBus — structurally matches the on/off/emit interface.
// ---------------------------------------------------------------------------
function createMockEventBus(): EventBus {
  const emitter = new EventEmitter();
  return {
    on: <K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void) => {
      emitter.on(event as string, listener);
    },
    off: <K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void) => {
      emitter.off(event as string, listener);
    },
    emit: <K extends keyof EventMap>(event: K, payload: EventMap[K]) => {
      emitter.emit(event as string, payload);
    },
    once: <K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void) => {
      emitter.once(event as string, listener);
    },
    removeAllListeners: (event?: string) => {
      emitter.removeAllListeners(event);
    },
  } as unknown as EventBus;
}

// ---------------------------------------------------------------------------
// Module under test — will fail to import until workerStore.ts is created.
// ---------------------------------------------------------------------------
import { useWorkerStore, deriveDisplayName, formatElapsed } from '@stores/workerStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INITIAL_STATE = {
  workerStatuses: [] as import('@ui/dashboard/shared/DashboardTypes.js').WorkerStatusEntry[],
  pipelineState: 'stopped' as import('@ui/dashboard/shared/DashboardTypes.js').PipelineState,
};

function resetStore(): void {
  useWorkerStore.setState(INITIAL_STATE, true);
}

function getState() {
  return useWorkerStore.getState();
}

function makeWorkerEvent(stageName: string, workerId = 'worker-1'): WorkerEvent {
  return { workerId, stageName, model: 'claude-opus' };
}

function makePipelineEvent(): PipelineEvent {
  return { projectId: 1, timestamp: new Date().toISOString() };
}

function makeQueueEvent(completed: number, pending: number, failed: number): QueueEvent {
  return { pending, running: 0, completed, failed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkerStore', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    resetStore();
    eventBus = createMockEventBus();
    // Call cleanup in case a previous test left a subscription hanging
    getState().cleanup();
  });

  afterEach(() => {
    getState().cleanup();
    resetStore();
  });

  // -------------------------------------------------------------------------
  // init() — subscription registration
  // -------------------------------------------------------------------------
  describe('init()', () => {
    it('subscribes to all 7 events via eventBus.on', () => {
      const onSpy = vi.spyOn(eventBus, 'on');
      getState().init(eventBus);
      expect(onSpy).toHaveBeenCalledTimes(7);
      const events = onSpy.mock.calls.map((c) => c[0]);
      expect(events).toContain('worker:busy');
      expect(events).toContain('worker:idle');
      expect(events).toContain('pipeline:start');
      expect(events).toContain('pipeline:draining');
      expect(events).toContain('pipeline:stop');
      expect(events).toContain('pipeline:terminated');
      expect(events).toContain('queue:updated');
    });

    it('calls cleanup() first if init() is called multiple times to prevent double-subscribing', () => {
      const offSpy = vi.spyOn(eventBus, 'off');
      getState().init(eventBus);
      getState().init(eventBus); // second call should unsubscribe first
      // Second init triggers 7 off() calls for the first init's handlers
      expect(offSpy).toHaveBeenCalledTimes(7);
    });
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('has empty workerStatuses array', () => {
      expect(getState().workerStatuses).toEqual([]);
    });

    it('has pipelineState of stopped', () => {
      expect(getState().pipelineState).toBe('stopped');
    });

    it('isPipelineRunning() returns false initially', () => {
      expect(getState().isPipelineRunning()).toBe(false);
    });

    it('queueStats() returns null initially (pipeline stopped)', () => {
      expect(getState().queueStats()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // worker:busy event
  // -------------------------------------------------------------------------
  describe('worker:busy event', () => {
    beforeEach(() => {
      getState().init(eventBus);
    });

    it('adds a new worker entry with status run and runStartedAt set', () => {
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      const state = getState();
      expect(state.workerStatuses).toHaveLength(1);
      expect(state.workerStatuses[0]?.stageName).toBe('dev-worker');
      expect(state.workerStatuses[0]?.status).toBe('run');
      expect(state.workerStatuses[0]?.runStartedAt).not.toBeNull();
    });

    it('sets displayName using deriveDisplayName logic', () => {
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      expect(getState().workerStatuses[0]?.displayName).toBe('Dev');
    });

    it('updates an existing worker entry to run status', () => {
      eventBus.emit('worker:idle', makeWorkerEvent('sm-worker'));
      expect(getState().workerStatuses[0]?.status).toBe('idle');
      eventBus.emit('worker:busy', makeWorkerEvent('sm-worker'));
      expect(getState().workerStatuses).toHaveLength(1);
      expect(getState().workerStatuses[0]?.status).toBe('run');
    });

    it('tracks multiple distinct workers independently', () => {
      eventBus.emit('worker:busy', makeWorkerEvent('sm-worker'));
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      eventBus.emit('worker:busy', makeWorkerEvent('review-worker'));
      const statuses = getState().workerStatuses;
      expect(statuses).toHaveLength(3);
      expect(statuses.every((w) => w.status === 'run')).toBe(true);
    });

    it('sets pipelineState to running when pipeline is stopped', () => {
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      expect(getState().pipelineState).toBe('running');
    });

    it('does NOT revert pipelineState from draining to running', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:draining', { projectId: 1, timestamp: new Date().toISOString() });
      expect(getState().pipelineState).toBe('draining');
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      expect(getState().pipelineState).toBe('draining');
    });
  });

  // -------------------------------------------------------------------------
  // worker:idle event
  // -------------------------------------------------------------------------
  describe('worker:idle event', () => {
    beforeEach(() => {
      getState().init(eventBus);
    });

    it('marks an existing worker as idle with runStartedAt null', () => {
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      expect(getState().workerStatuses[0]?.status).toBe('run');
      eventBus.emit('worker:idle', makeWorkerEvent('dev-worker'));
      expect(getState().workerStatuses[0]?.status).toBe('idle');
      expect(getState().workerStatuses[0]?.runStartedAt).toBeNull();
    });

    it('creates a new idle entry for an unknown stage', () => {
      eventBus.emit('worker:idle', makeWorkerEvent('unknown-worker'));
      expect(getState().workerStatuses).toHaveLength(1);
      expect(getState().workerStatuses[0]?.status).toBe('idle');
      expect(getState().workerStatuses[0]?.runStartedAt).toBeNull();
    });

    it('does not change pipelineState', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('worker:idle', makeWorkerEvent('dev-worker'));
      expect(getState().pipelineState).toBe('running');
    });
  });

  // -------------------------------------------------------------------------
  // pipeline:start event
  // -------------------------------------------------------------------------
  describe('pipeline:start event', () => {
    beforeEach(() => {
      getState().init(eventBus);
    });

    it('sets pipelineState to running', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      expect(getState().pipelineState).toBe('running');
    });

    it('isPipelineRunning() returns true after pipeline:start', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      expect(getState().isPipelineRunning()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // pipeline:stop event
  // -------------------------------------------------------------------------
  describe('pipeline:stop event', () => {
    beforeEach(() => {
      getState().init(eventBus);
    });

    it('sets pipelineState to stopped', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:stop', makePipelineEvent());
      expect(getState().pipelineState).toBe('stopped');
    });

    it('resets all workerStatuses to idle with runStartedAt null', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      eventBus.emit('worker:busy', makeWorkerEvent('sm-worker'));
      expect(getState().workerStatuses.some((w) => w.status === 'run')).toBe(true);
      eventBus.emit('pipeline:stop', makePipelineEvent());
      const statuses = getState().workerStatuses;
      expect(statuses.every((w) => w.status === 'idle')).toBe(true);
      expect(statuses.every((w) => w.runStartedAt === null)).toBe(true);
    });

    it('bypasses throttle — workerStatuses reset is reflected immediately (no tick required)', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      eventBus.emit('pipeline:stop', makePipelineEvent());
      // Immediate read — state must be reset synchronously bypassing throttle
      expect(getState().workerStatuses.every((w) => w.status === 'idle')).toBe(true);
    });

    it('isPipelineRunning() returns false after pipeline:stop', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:stop', makePipelineEvent());
      expect(getState().isPipelineRunning()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // pipeline:terminated event
  // -------------------------------------------------------------------------
  describe('pipeline:terminated event', () => {
    beforeEach(() => {
      getState().init(eventBus);
    });

    it('sets pipelineState to stopped', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:terminated', makePipelineEvent());
      expect(getState().pipelineState).toBe('stopped');
    });

    it('resets all workerStatuses to idle with runStartedAt null', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      eventBus.emit('worker:busy', makeWorkerEvent('sm-worker'));
      eventBus.emit('pipeline:terminated', makePipelineEvent());
      const statuses = getState().workerStatuses;
      expect(statuses.every((w) => w.status === 'idle')).toBe(true);
      expect(statuses.every((w) => w.runStartedAt === null)).toBe(true);
    });

    it('bypasses throttle — workerStatuses reset is reflected immediately', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      eventBus.emit('pipeline:terminated', makePipelineEvent());
      expect(getState().workerStatuses.every((w) => w.status === 'idle')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // queue:updated event
  // -------------------------------------------------------------------------
  describe('queue:updated event', () => {
    beforeEach(() => {
      getState().init(eventBus);
    });

    it('updates queueStats when pipeline is running', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('queue:updated', makeQueueEvent(5, 3, 1));
      expect(getState().queueStats()).toEqual({ done: 5, queued: 3, failed: 1 });
    });

    it('returns null from queueStats() when pipelineState is stopped', () => {
      // Emit queue update without starting pipeline
      eventBus.emit('queue:updated', makeQueueEvent(5, 3, 1));
      expect(getState().queueStats()).toBeNull();
    });

    it('hides queueStats after pipeline stops', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('queue:updated', makeQueueEvent(5, 3, 1));
      expect(getState().queueStats()).not.toBeNull();
      eventBus.emit('pipeline:stop', makePipelineEvent());
      expect(getState().queueStats()).toBeNull();
    });

    it('maps event fields correctly: pending→queued, completed→done, failed→failed', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('queue:updated', makeQueueEvent(7, 2, 3));
      const stats = getState().queueStats();
      expect(stats).not.toBeNull();
      expect(stats?.done).toBe(7);
      expect(stats?.queued).toBe(2);
      expect(stats?.failed).toBe(3);
    });

    it('queueStats() reads buffered value directly (not from Zustand state)', () => {
      // Verify queueStats() always returns the latest buffered value
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('queue:updated', { pending: 10, running: 0, completed: 20, failed: 2 });
      const stats = getState().queueStats();
      expect(stats?.queued).toBe(10);
      expect(stats?.done).toBe(20);
      expect(stats?.failed).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // isPipelineRunning() computed getter
  // -------------------------------------------------------------------------
  describe('isPipelineRunning()', () => {
    beforeEach(() => {
      getState().init(eventBus);
    });

    it('returns true when pipelineState is running', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      expect(getState().isPipelineRunning()).toBe(true);
    });

    it('returns false when pipelineState is stopped', () => {
      expect(getState().isPipelineRunning()).toBe(false);
    });

    it('returns false when pipelineState is draining', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:draining', { projectId: 1, timestamp: new Date().toISOString() });
      expect(getState().isPipelineRunning()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Throttle behaviour (250ms min between updates)
  // -------------------------------------------------------------------------
  describe('throttle behaviour', () => {
    it('emits at most 1 workerStatuses update per 250ms window for rapid events', () => {
      vi.useFakeTimers();
      getState().init(eventBus);

      const updates: number[] = [];
      const unsub = useWorkerStore.subscribe(
        (s) => s.workerStatuses,
        () => { updates.push(Date.now()); },
      );

      // Fire multiple events within the same 250ms window (no time advance)
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      eventBus.emit('worker:busy', makeWorkerEvent('sm-worker'));
      eventBus.emit('worker:busy', makeWorkerEvent('review-worker'));

      // State should have been updated at most once during this window
      expect(updates.length).toBeLessThanOrEqual(1);

      unsub();
      vi.useRealTimers();
    });

    it('allows a second update after 250ms has elapsed', () => {
      vi.useFakeTimers();
      getState().init(eventBus);

      let updateCount = 0;
      const unsub = useWorkerStore.subscribe(
        (s) => s.workerStatuses,
        () => { updateCount++; },
      );

      // First event — triggers flush (initial _lastUpdate = 0, so first always passes through)
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      const firstCount = updateCount;

      // Advance time past throttle window
      vi.advanceTimersByTime(250);

      // Second event after throttle window — should trigger another flush
      eventBus.emit('worker:busy', makeWorkerEvent('sm-worker'));
      expect(updateCount).toBeGreaterThan(firstCount);

      unsub();
      vi.useRealTimers();
    });

    it('2s flush interval pushes buffered state even without new events', () => {
      vi.useFakeTimers();
      getState().init(eventBus);

      let updateCount = 0;
      const unsub = useWorkerStore.subscribe(
        (s) => s.workerStatuses,
        () => { updateCount++; },
      );

      // First event saturates the throttle
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      const afterFirst = updateCount;

      // Emit another event within 250ms — throttle prevents flush (dirty = true but not flushed)
      vi.advanceTimersByTime(100);
      eventBus.emit('worker:busy', makeWorkerEvent('sm-worker'));
      expect(updateCount).toBe(afterFirst); // still throttled

      // Advance past 2s flush interval — flushUpdates() should fire
      vi.advanceTimersByTime(2000);
      expect(updateCount).toBeGreaterThan(afterFirst);

      unsub();
      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // cleanup()
  // -------------------------------------------------------------------------
  describe('cleanup()', () => {
    it('unsubscribes all 7 event handlers via eventBus.off', () => {
      const offSpy = vi.spyOn(eventBus, 'off');
      getState().init(eventBus);
      getState().cleanup();
      expect(offSpy).toHaveBeenCalledTimes(7);
      const events = offSpy.mock.calls.map((c) => c[0]);
      expect(events).toContain('worker:busy');
      expect(events).toContain('worker:idle');
      expect(events).toContain('pipeline:start');
      expect(events).toContain('pipeline:draining');
      expect(events).toContain('pipeline:stop');
      expect(events).toContain('pipeline:terminated');
      expect(events).toContain('queue:updated');
    });

    it('clears the 2s flush interval on cleanup', () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      getState().init(eventBus);
      getState().cleanup();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    });

    it('store does NOT update after cleanup() when events are emitted', () => {
      getState().init(eventBus);
      getState().cleanup();
      // After cleanup, events should not affect state
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      expect(getState().pipelineState).toBe('stopped');
      expect(getState().workerStatuses).toHaveLength(0);
    });

    it('is safe to call cleanup() when not initialized (no-op, does not throw)', () => {
      expect(() => getState().cleanup()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // deriveDisplayName() pure function (exported from workerStore)
  // -------------------------------------------------------------------------
  describe('deriveDisplayName()', () => {
    it('derives SM for sm-worker', () => {
      expect(deriveDisplayName('sm-worker')).toBe('SM');
    });

    it('derives Dev for dev-worker', () => {
      expect(deriveDisplayName('dev-worker')).toBe('Dev');
    });

    it('derives Rev for review-worker', () => {
      expect(deriveDisplayName('review-worker')).toBe('Rev');
    });

    it('derives Tes for test-worker', () => {
      expect(deriveDisplayName('test-worker')).toBe('Tes');
    });

    it('handles stage name without -worker suffix (<=2 chars → uppercase)', () => {
      expect(deriveDisplayName('sm')).toBe('SM');
    });

    it('handles stage name without -worker suffix (>2 chars → title-case first 3)', () => {
      expect(deriveDisplayName('dev')).toBe('Dev');
    });
  });

  // -------------------------------------------------------------------------
  // formatElapsed() pure function (exported from workerStore)
  // -------------------------------------------------------------------------
  describe('formatElapsed()', () => {
    it('returns empty string for null runStartedAt', () => {
      expect(formatElapsed(null)).toBe('');
    });

    it('formats 1 minute 5 seconds as 1:05', () => {
      const now = Date.now();
      const result = formatElapsed(now - 65_000);
      expect(result).toBe('1:05');
    });

    it('formats 30 seconds as 0:30', () => {
      const now = Date.now();
      const result = formatElapsed(now - 30_000);
      expect(result).toBe('0:30');
    });

    it('pads single-digit seconds to 2 digits (0:05)', () => {
      const now = Date.now();
      const result = formatElapsed(now - 5_000);
      expect(result).toBe('0:05');
    });

    it('result matches M:SS format', () => {
      const now = Date.now();
      expect(formatElapsed(now - 90_000)).toMatch(/^\d+:\d{2}$/);
    });
  });
});
