/**
 * Tests for workerStore pipelineState transitions and queueStats visibility.
 * Port of useWorkerStatus.drain.test.ts rewritten for direct Zustand store access (Story 26.2).
 * No React rendering — uses store API directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { EventBus } from '@core/EventBus.js';
import type { EventMap, PipelineEvent, PipelineDrainingEvent, WorkerEvent } from '@core/EventTypes.js';
import type { PipelineState } from '@ui/dashboard/shared/DashboardTypes.js';

// ---------------------------------------------------------------------------
// Mock EventBus
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
import { useWorkerStore } from '@stores/workerStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
  useWorkerStore.setState({ workerStatuses: [], pipelineState: 'stopped' }, true);
}

function getState() {
  return useWorkerStore.getState();
}

function makePipelineEvent(): PipelineEvent {
  return { projectId: 1, timestamp: new Date().toISOString() };
}

function makePipelineDrainingEvent(): PipelineDrainingEvent {
  return { projectId: 1, timestamp: new Date().toISOString() };
}

function makeWorkerEvent(stageName: string): WorkerEvent {
  return { workerId: 'worker-1', stageName, model: 'claude-opus' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkerStore — pipelineState transitions (Story 26.2)', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    resetStore();
    eventBus = createMockEventBus();
    getState().cleanup();
    getState().init(eventBus);
  });

  afterEach(() => {
    getState().cleanup();
    resetStore();
  });

  // -------------------------------------------------------------------------
  // AC: initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('pipelineState starts as stopped', () => {
      expect(getState().pipelineState).toBe('stopped');
    });

    it('isPipelineRunning() returns false initially', () => {
      expect(getState().isPipelineRunning()).toBe(false);
    });

    it('queueStats() returns null initially', () => {
      expect(getState().queueStats()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // AC: pipeline:start → pipelineState = 'running'
  // -------------------------------------------------------------------------
  describe('pipeline:start event', () => {
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
  // AC: pipeline:draining → pipelineState = 'draining'
  // -------------------------------------------------------------------------
  describe('pipeline:draining event', () => {
    it('sets pipelineState to draining after running', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      expect(getState().pipelineState).toBe('draining');
    });

    it('sets pipelineState to draining even if received before pipeline:start', () => {
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      expect(getState().pipelineState).toBe('draining');
    });

    it('isPipelineRunning() returns false when draining', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      expect(getState().isPipelineRunning()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // AC: pipeline:stop → pipelineState = 'stopped'
  // -------------------------------------------------------------------------
  describe('pipeline:stop event', () => {
    it('sets pipelineState to stopped after running', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:stop', makePipelineEvent());
      expect(getState().pipelineState).toBe('stopped');
    });

    it('sets pipelineState to stopped after draining', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      expect(getState().pipelineState).toBe('draining');
      eventBus.emit('pipeline:stop', makePipelineEvent());
      expect(getState().pipelineState).toBe('stopped');
    });
  });

  // -------------------------------------------------------------------------
  // AC: pipeline:terminated → pipelineState = 'stopped'
  // -------------------------------------------------------------------------
  describe('pipeline:terminated event', () => {
    it('sets pipelineState to stopped after running', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:terminated', makePipelineEvent());
      expect(getState().pipelineState).toBe('stopped');
    });

    it('sets pipelineState to stopped after draining', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      eventBus.emit('pipeline:terminated', makePipelineEvent());
      expect(getState().pipelineState).toBe('stopped');
    });
  });

  // -------------------------------------------------------------------------
  // AC: worker:busy during draining — does NOT revert pipelineState to 'running'
  // -------------------------------------------------------------------------
  describe('worker:busy event during draining state', () => {
    it('does not revert pipelineState from draining to running', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      expect(getState().pipelineState).toBe('draining');
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      expect(getState().pipelineState).toBe('draining');
    });

    it('still updates workerStatuses when draining (worker entry updated)', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      expect(getState().workerStatuses[0]?.status).toBe('run');
      expect(getState().workerStatuses[0]?.stageName).toBe('dev-worker');
    });

    it('uses functional updater to safely read current pipelineState (race-condition guard)', () => {
      // Verify draining is not overwritten when multiple workers go busy concurrently
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      // Multiple busy events — none should revert to 'running'
      eventBus.emit('worker:busy', makeWorkerEvent('dev-worker'));
      eventBus.emit('worker:busy', makeWorkerEvent('sm-worker'));
      eventBus.emit('worker:busy', makeWorkerEvent('review-worker'));
      expect(getState().pipelineState).toBe('draining');
    });
  });

  // -------------------------------------------------------------------------
  // AC: queueStats() visibility rules with pipelineState
  // -------------------------------------------------------------------------
  describe('queueStats() visibility', () => {
    it('exposes queueStats when pipelineState is running', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('queue:updated', { pending: 2, running: 0, completed: 3, failed: 0 });
      expect(getState().queueStats()).not.toBeNull();
    });

    it('exposes queueStats when pipelineState is draining (must stay visible)', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('queue:updated', { pending: 2, running: 0, completed: 3, failed: 0 });
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      expect(getState().pipelineState).toBe('draining');
      expect(getState().queueStats()).not.toBeNull();
    });

    it('hides queueStats when pipelineState is stopped', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('queue:updated', { pending: 2, running: 0, completed: 3, failed: 0 });
      eventBus.emit('pipeline:stop', makePipelineEvent());
      expect(getState().queueStats()).toBeNull();
    });

    it('queueStats returns correct values during draining', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('queue:updated', { pending: 2, running: 0, completed: 3, failed: 1 });
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      const stats = getState().queueStats();
      expect(stats).toEqual({ queued: 2, done: 3, failed: 1 });
    });

    it('queueStats remains accessible after draining transitions to stopped — then hidden', () => {
      eventBus.emit('pipeline:start', makePipelineEvent());
      eventBus.emit('queue:updated', { pending: 5, running: 0, completed: 10, failed: 0 });
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      expect(getState().queueStats()).not.toBeNull(); // visible during draining
      eventBus.emit('pipeline:stop', makePipelineEvent());
      expect(getState().queueStats()).toBeNull(); // hidden after stop
    });
  });

  // -------------------------------------------------------------------------
  // AC: cleanup removes pipeline:draining listener and all others
  // -------------------------------------------------------------------------
  describe('cleanup()', () => {
    it('removes pipeline:draining listener — state stays stopped after cleanup', () => {
      getState().cleanup(); // cleanup the subscription from beforeEach
      resetStore();
      // Emitting draining should have no effect (unsubscribed)
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      expect(getState().pipelineState).toBe('stopped');
    });

    it('unsubscribes all 7 event types on cleanup', () => {
      const offSpy = vi.spyOn(eventBus, 'off');
      getState().cleanup();
      expect(offSpy).toHaveBeenCalledTimes(7);
      const events = offSpy.mock.calls.map((c) => c[0]);
      expect(events).toContain('pipeline:draining');
      expect(events).toContain('pipeline:start');
      expect(events).toContain('pipeline:stop');
      expect(events).toContain('pipeline:terminated');
      expect(events).toContain('worker:busy');
      expect(events).toContain('worker:idle');
      expect(events).toContain('queue:updated');
    });
  });

  // -------------------------------------------------------------------------
  // AC: pipelineState type validation
  // -------------------------------------------------------------------------
  describe('pipelineState type', () => {
    it('is always one of stopped | running | draining across all transitions', () => {
      const validStates: PipelineState[] = ['stopped', 'running', 'draining'];
      expect(validStates).toContain(getState().pipelineState);
      eventBus.emit('pipeline:start', makePipelineEvent());
      expect(validStates).toContain(getState().pipelineState);
      eventBus.emit('pipeline:draining', makePipelineDrainingEvent());
      expect(validStates).toContain(getState().pipelineState);
      eventBus.emit('pipeline:stop', makePipelineEvent());
      expect(validStates).toContain(getState().pipelineState);
    });
  });
});
