import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { EventBus } from '@core/EventBus.js';
import type { EventMap, TaskEvent, TaskStatus } from '@core/EventTypes.js';
import type { RobotState } from '@ui/dashboard/crew/CrewTypes.js';

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
// Module under test — will fail to import until crewStore.ts is created.
// ---------------------------------------------------------------------------
import { useCrewStore } from '@stores/crewStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_STAGES = ['sm', 'dev', 'review', 'tester'];

function resetStore(): void {
  useCrewStore.setState({ workers: [], globalBlinkPhase: false });
}

function getState() {
  return useCrewStore.getState();
}

function makeTaskEvent(
  stageName: string,
  status: TaskStatus,
  storyId = 1,
  taskId = 1,
): TaskEvent {
  return { taskId, storyId, stageName, status };
}

function workerState(stageName: string): RobotState | undefined {
  return getState().workers.find((w) => w.name === stageName)?.state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCrewStore', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
    eventBus = createMockEventBus();
    // Ensure no leftover subscriptions from previous test
    getState().cleanup();
  });

  afterEach(() => {
    getState().cleanup();
    resetStore();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // AC1: init() initialises all workers to 'idle'
  // -------------------------------------------------------------------------
  describe('init()', () => {
    it('should initialise 4 worker entries all in idle state', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      const { workers } = getState();
      expect(workers).toHaveLength(4);
      workers.forEach((w) => expect(w.state).toBe('idle'));
    });

    it('should set correct name and displayName for each worker', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      const { workers } = getState();
      expect(workers.find((w) => w.name === 'sm')?.displayName).toBe('SM');
      expect(workers.find((w) => w.name === 'dev')?.displayName).toBe('Dev');
      expect(workers.find((w) => w.name === 'review')?.displayName).toBe('Rev');
      expect(workers.find((w) => w.name === 'tester')?.displayName).toBe('Tes');
    });

    it('should set blinkPhase false for all workers on init', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      getState().workers.forEach((w) => expect(w.blinkPhase).toBe(false));
    });

    it('should set globalBlinkPhase to false on init', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      expect(getState().globalBlinkPhase).toBe(false);
    });

    it('should call cleanup() first if init() called while previous is active', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      // Trigger a state change
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      expect(workerState('dev')).toBe('running');

      // Calling init() again should reset workers and not duplicate listeners
      const eventBus2 = createMockEventBus();
      getState().init(eventBus2, DEFAULT_STAGES);
      // Workers re-initialised to idle
      expect(workerState('dev')).toBe('idle');
      // Old eventBus no longer triggers changes
      eventBus.emit('task:started', makeTaskEvent('sm', 'running'));
      expect(workerState('sm')).toBe('idle');
    });

    it('should handle empty stages array gracefully', () => {
      getState().init(eventBus, []);
      expect(getState().workers).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // AC2: task:started → worker transitions to 'running'
  // -------------------------------------------------------------------------
  describe('task:started event', () => {
    it('should transition the worker to running state', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      expect(workerState('dev')).toBe('running');
    });

    it('should not affect other workers', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      expect(workerState('sm')).toBe('idle');
      expect(workerState('review')).toBe('idle');
      expect(workerState('tester')).toBe('idle');
    });

    it('should cancel pending idle timeout for the stage', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      // Trigger a completed → done → (3s) → idle cycle
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      expect(workerState('dev')).toBe('done');

      // Start a new task before idle timeout fires
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      expect(workerState('dev')).toBe('running');

      // Advance past the original 3s timeout — worker should stay running
      vi.advanceTimersByTime(3000);
      expect(workerState('dev')).toBe('running');
    });
  });

  // -------------------------------------------------------------------------
  // AC3: task:completed → done immediately → idle after 3 seconds
  // -------------------------------------------------------------------------
  describe('task:completed event', () => {
    it('should transition worker to done immediately', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      expect(workerState('dev')).toBe('done');
    });

    it('should keep worker in done state before 3 seconds elapse', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      vi.advanceTimersByTime(2999);
      expect(workerState('dev')).toBe('done');
    });

    it('should transition worker to idle exactly after 3 seconds', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      vi.advanceTimersByTime(3000);
      expect(workerState('dev')).toBe('idle');
    });

    it('should cancel previous idle timeout on duplicate task:completed events', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      vi.advanceTimersByTime(1000);
      // Second completed event resets the timer
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      // Should still be done at 2999ms after second event (original would have fired at t=3000)
      vi.advanceTimersByTime(2999);
      expect(workerState('dev')).toBe('done');
      // After another 1ms (3000ms from second event) → idle
      vi.advanceTimersByTime(1);
      expect(workerState('dev')).toBe('idle');
    });
  });

  // -------------------------------------------------------------------------
  // AC4: task:failed → error immediately → idle after 5 seconds
  // -------------------------------------------------------------------------
  describe('task:failed event', () => {
    it('should transition worker to error immediately', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      eventBus.emit('task:failed', makeTaskEvent('dev', 'failed'));
      expect(workerState('dev')).toBe('error');
    });

    it('should keep worker in error state before 5 seconds elapse', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:failed', makeTaskEvent('dev', 'failed'));
      vi.advanceTimersByTime(4999);
      expect(workerState('dev')).toBe('error');
    });

    it('should transition worker to idle exactly after 5 seconds', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:failed', makeTaskEvent('dev', 'failed'));
      vi.advanceTimersByTime(5000);
      expect(workerState('dev')).toBe('idle');
    });

    it('should cancel previous idle timeout on duplicate task:failed events', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:failed', makeTaskEvent('dev', 'failed'));
      vi.advanceTimersByTime(2000);
      // Second failed event resets timer
      eventBus.emit('task:failed', makeTaskEvent('dev', 'failed'));
      vi.advanceTimersByTime(4999);
      expect(workerState('dev')).toBe('error');
      vi.advanceTimersByTime(1);
      expect(workerState('dev')).toBe('idle');
    });
  });

  // -------------------------------------------------------------------------
  // AC5: task:routed → source 'done' (+3s idle), target 'queued'
  // -------------------------------------------------------------------------
  describe('task:routed event', () => {
    it('should set source worker to done and target worker to queued', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      // Track source via task:started
      eventBus.emit('task:started', { taskId: 10, storyId: 1, stageName: 'sm', status: 'running' });
      eventBus.emit('task:routed', { taskId: 10, storyId: 1, stageName: 'dev', status: 'routed' });

      expect(workerState('sm')).toBe('done');
      expect(workerState('dev')).toBe('queued');
    });

    it('should transition source to idle after 3 seconds', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', { taskId: 10, storyId: 1, stageName: 'sm', status: 'running' });
      eventBus.emit('task:routed', { taskId: 10, storyId: 1, stageName: 'dev', status: 'routed' });

      vi.advanceTimersByTime(3000);
      expect(workerState('sm')).toBe('idle');
      expect(workerState('dev')).toBe('queued'); // target unchanged
    });

    it('should fallback to previous stage in list when storySourceStages has no entry', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      // No task:started fired — fallback: dev is index 1, source is stages[0] = sm
      eventBus.emit('task:routed', { taskId: 99, storyId: 99, stageName: 'dev', status: 'routed' });

      expect(workerState('sm')).toBe('done');
      expect(workerState('dev')).toBe('queued');
    });

    it('should skip source update when target is first in stages list (no previous)', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      // Target is 'sm' (index 0) — no previous stage to update
      eventBus.emit('task:routed', { taskId: 99, storyId: 99, stageName: 'sm', status: 'routed' });

      // sm should be queued (target), nothing else changes
      expect(workerState('sm')).toBe('queued');
      // Other workers remain idle
      expect(workerState('dev')).toBe('idle');
    });

    it('should cancel pending idle timeout on target stage when routing to it', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      // dev has a pending done→idle timeout
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      expect(workerState('dev')).toBe('done');

      // Route to dev — should override done→idle and set to queued
      eventBus.emit('task:started', { taskId: 5, storyId: 5, stageName: 'sm', status: 'running' });
      eventBus.emit('task:routed', { taskId: 5, storyId: 5, stageName: 'dev', status: 'routed' });

      expect(workerState('dev')).toBe('queued');
      // Advance past original 3s done→idle timeout — dev stays queued
      vi.advanceTimersByTime(3000);
      expect(workerState('dev')).toBe('queued');
    });

    it('should update storySourceStages so subsequent routing uses correct source', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      // sm → dev → review chain
      eventBus.emit('task:started', { taskId: 1, storyId: 1, stageName: 'sm', status: 'running' });
      eventBus.emit('task:routed', { taskId: 1, storyId: 1, stageName: 'dev', status: 'routed' });
      // Now route from dev to review (storySourceStages[1] should be 'dev')
      eventBus.emit('task:routed', { taskId: 1, storyId: 1, stageName: 'review', status: 'routed' });

      expect(workerState('dev')).toBe('done');
      expect(workerState('review')).toBe('queued');
    });
  });

  // -------------------------------------------------------------------------
  // AC6: Blink interval — toggles globalBlinkPhase every 800ms when running
  // -------------------------------------------------------------------------
  describe('globalBlinkPhase and blink interval', () => {
    it('should start blink interval when a worker transitions to running', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));

      expect(getState().globalBlinkPhase).toBe(false);
      vi.advanceTimersByTime(800);
      expect(getState().globalBlinkPhase).toBe(true);
      vi.advanceTimersByTime(800);
      expect(getState().globalBlinkPhase).toBe(false);
    });

    it('should stop blink interval and set globalBlinkPhase to false when no workers running', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      vi.advanceTimersByTime(800);
      expect(getState().globalBlinkPhase).toBe(true);

      // Complete task — no more running workers
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      expect(getState().globalBlinkPhase).toBe(false);

      // Advance — blink should NOT toggle anymore
      vi.advanceTimersByTime(1600);
      expect(getState().globalBlinkPhase).toBe(false);
    });

    it('should not start blink interval when all workers are idle', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      vi.advanceTimersByTime(5000);
      expect(getState().globalBlinkPhase).toBe(false);
    });

    it('should not start blink interval for queued workers (only running)', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:queued', makeTaskEvent('dev', 'queued'));
      vi.advanceTimersByTime(800);
      // Blink only for 'running', not 'queued'
      expect(getState().globalBlinkPhase).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // AC7: orchestratorState computed getter
  // -------------------------------------------------------------------------
  describe('orchestratorState()', () => {
    it('should return idle when all workers are idle', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      expect(getState().orchestratorState()).toBe('idle');
    });

    it('should return running when any worker is running', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      expect(getState().orchestratorState()).toBe('running');
    });

    it('should return running when any worker is queued', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:queued', makeTaskEvent('review', 'queued'));
      expect(getState().orchestratorState()).toBe('running');
    });

    it('should return idle when all workers are done or error', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      eventBus.emit('task:failed', makeTaskEvent('sm', 'failed'));
      expect(getState().orchestratorState()).toBe('idle');
    });

    it('should return idle after all workers fully transition to idle', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      expect(getState().orchestratorState()).toBe('running');
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      vi.advanceTimersByTime(3000);
      expect(getState().orchestratorState()).toBe('idle');
    });
  });

  // -------------------------------------------------------------------------
  // AC8: task:queued → worker transitions to 'queued'
  // -------------------------------------------------------------------------
  describe('task:queued event', () => {
    it('should transition worker to queued state', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:queued', makeTaskEvent('sm', 'queued'));
      expect(workerState('sm')).toBe('queued');
    });

    it('should cancel pending idle timeout for the stage', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      expect(workerState('dev')).toBe('done');

      eventBus.emit('task:queued', makeTaskEvent('dev', 'queued'));
      expect(workerState('dev')).toBe('queued');

      // Original 3s timeout was cleared — dev stays queued
      vi.advanceTimersByTime(3000);
      expect(workerState('dev')).toBe('queued');
    });
  });

  // -------------------------------------------------------------------------
  // AC9: Store persists across remounts (no reset to all-idle on cleanup+re-init)
  // -------------------------------------------------------------------------
  describe('persistence across remounts', () => {
    it('should preserve workers state between cleanup and re-init', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      expect(workerState('dev')).toBe('running');

      // Simulate unmount (cleanup) + remount (init again)
      getState().cleanup();
      // Workers state should still be preserved (not reset by cleanup)
      expect(workerState('dev')).toBe('running');

      // Re-init — NOTE: per spec, init() resets workers to idle when called fresh
      // But the key win is that the Zustand store instance persists, unlike the module cache hack
      getState().init(eventBus, DEFAULT_STAGES);
      // Workers are reset on init() — this is expected and tested here
      // The critical test is that cleanup() alone does NOT reset state
    });

    it('cleanup() should NOT reset workers state', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('sm', 'running'));
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));

      getState().cleanup();
      // State preserved
      expect(workerState('sm')).toBe('running');
      expect(workerState('dev')).toBe('done');
    });
  });

  // -------------------------------------------------------------------------
  // AC10: cleanup() — stops event processing, clears timers, stops blink
  // -------------------------------------------------------------------------
  describe('cleanup()', () => {
    it('should stop processing task events after cleanup', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));

      getState().cleanup();

      // These should have no effect after cleanup
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      eventBus.emit('task:failed', makeTaskEvent('sm', 'failed'));
      eventBus.emit('task:routed', { taskId: 1, storyId: 1, stageName: 'review', status: 'routed' });

      expect(workerState('dev')).toBe('running'); // unchanged
      expect(workerState('sm')).toBe('idle'); // unchanged (never started)
      expect(workerState('review')).toBe('idle'); // unchanged
    });

    it('should stop blink interval on cleanup', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:started', makeTaskEvent('dev', 'running'));
      vi.advanceTimersByTime(800);
      expect(getState().globalBlinkPhase).toBe(true);

      getState().cleanup();
      // globalBlinkPhase should be false after cleanup
      expect(getState().globalBlinkPhase).toBe(false);

      // Advancing time should not toggle blink
      vi.advanceTimersByTime(1600);
      expect(getState().globalBlinkPhase).toBe(false);
    });

    it('should clear all pending idle timeouts on cleanup', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      eventBus.emit('task:completed', makeTaskEvent('dev', 'completed'));
      eventBus.emit('task:failed', makeTaskEvent('sm', 'failed'));

      getState().cleanup();

      // Timeouts should be cleared — state does not change after they would fire
      vi.advanceTimersByTime(5000);
      expect(workerState('dev')).toBe('done'); // NOT idle (timer was cleared)
      expect(workerState('sm')).toBe('error'); // NOT idle (timer was cleared)
    });

    it('should not throw when cleanup() is called before init()', () => {
      // Should not throw
      expect(() => getState().cleanup()).not.toThrow();
    });

    it('should not throw when cleanup() is called multiple times', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      expect(() => {
        getState().cleanup();
        getState().cleanup();
        getState().cleanup();
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Structural / codebase checks
  // -------------------------------------------------------------------------
  describe('store structure', () => {
    it('should export useCrewStore with getState, setState, and subscribe', () => {
      expect(typeof useCrewStore.getState).toBe('function');
      expect(typeof useCrewStore.setState).toBe('function');
      expect(typeof useCrewStore.subscribe).toBe('function');
    });

    it('should expose init, cleanup, workers, globalBlinkPhase, orchestratorState on state', () => {
      getState().init(eventBus, DEFAULT_STAGES);
      const state = getState();
      expect(Array.isArray(state.workers)).toBe(true);
      expect(typeof state.globalBlinkPhase).toBe('boolean');
      expect(typeof state.init).toBe('function');
      expect(typeof state.cleanup).toBe('function');
      expect(typeof state.orchestratorState).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // deriveDisplayName helper (exported from the store module)
  // -------------------------------------------------------------------------
  describe('deriveDisplayName', () => {
    it('should uppercase names ≤ 2 chars', async () => {
      // Access via the store workers after init
      getState().init(eventBus, ['sm', 'qa']);
      expect(getState().workers.find((w) => w.name === 'sm')?.displayName).toBe('SM');
      expect(getState().workers.find((w) => w.name === 'qa')?.displayName).toBe('QA');
    });

    it('should capitalise first letter of first-3-chars for longer names', () => {
      getState().init(eventBus, ['dev', 'review', 'tester', 'architect']);
      expect(getState().workers.find((w) => w.name === 'dev')?.displayName).toBe('Dev');
      expect(getState().workers.find((w) => w.name === 'review')?.displayName).toBe('Rev');
      expect(getState().workers.find((w) => w.name === 'tester')?.displayName).toBe('Tes');
      expect(getState().workers.find((w) => w.name === 'architect')?.displayName).toBe('Arc');
    });

    it('should strip -worker suffix before deriving display name', () => {
      getState().init(eventBus, ['sm-worker', 'dev-worker']);
      expect(getState().workers.find((w) => w.name === 'sm-worker')?.displayName).toBe('SM');
      expect(getState().workers.find((w) => w.name === 'dev-worker')?.displayName).toBe('Dev');
    });
  });
});
