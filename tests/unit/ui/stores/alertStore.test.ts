import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EventBus } from '@core/EventBus.js';
import type { AlertEvent, EventMap } from '@core/EventTypes.js';

// ---------------------------------------------------------------------------
// Mock EventBus — structurally matches the on/off/emit interface.
// Using a real EventEmitter so that emitting events actually fires handlers,
// which lets us test the full init→emit→state flow without mocking internals.
// ---------------------------------------------------------------------------
import { EventEmitter } from 'node:events';

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
// Module under test — will fail to import until alertStore.ts is created.
// ---------------------------------------------------------------------------
import { useAlertStore } from '@stores/alertStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Initial state snapshot used to reset the singleton store between tests. */
const INITIAL_STATE = {
  queue: [] as import('@ui/dashboard/modals/AlertOverlayTypes.js').AlertOverlayEntry[],
};

function resetStore(): void {
  useAlertStore.setState(INITIAL_STATE, true);
}

function getState() {
  return useAlertStore.getState();
}

function makeAlertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    taskId: 1,
    storyId: 10,
    storyTitle: 'Fix login bug',
    stageName: 'review',
    issues: ['Code style issue', 'Missing test'],
    routedTo: 'dev',
    attempt: 2,
    maxAttempts: 3,
    isBlocked: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAlertStore', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    resetStore();
    eventBus = createMockEventBus();
    // Call cleanup in case a previous test left a subscription hanging
    getState().cleanup();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('should have an empty queue', () => {
      expect(getState().queue).toEqual([]);
    });

    it('should return null for currentAlert when queue is empty', () => {
      expect(getState().currentAlert).toBeNull();
    });

    it('should return 0 for queueLength when queue is empty', () => {
      expect(getState().queueLength).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: init() subscribes to task:alert events
  // -------------------------------------------------------------------------
  describe('init(eventBus)', () => {
    it('should subscribe to "task:alert" events via bridgeEvents()', () => {
      const onSpy = vi.spyOn(eventBus, 'on');

      getState().init(eventBus);

      expect(onSpy).toHaveBeenCalledWith('task:alert', expect.any(Function));
    });

    it('should not throw when called', () => {
      expect(() => getState().init(eventBus)).not.toThrow();
    });

    it('should not update queue before any event is emitted', () => {
      getState().init(eventBus);
      expect(getState().queue).toEqual([]);
      expect(getState().currentAlert).toBeNull();
    });

    // Edge case: init() called multiple times — must not create duplicate handlers
    it('should clean up previous subscription when init() is called a second time', () => {
      const offSpy = vi.spyOn(eventBus, 'off');

      getState().init(eventBus);
      getState().init(eventBus);

      // After second init, the first subscription must have been cleaned up
      expect(offSpy).toHaveBeenCalledWith('task:alert', expect.any(Function));
    });

    it('should not duplicate handlers when init() is called twice — emitting once yields one entry', () => {
      getState().init(eventBus);
      getState().init(eventBus); // second init must unsubscribe first

      const alertEvent = makeAlertEvent();
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', alertEvent);

      expect(getState().queue).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: task:alert event appends entry to queue
  // -------------------------------------------------------------------------
  describe('task:alert event handling', () => {
    it('should append an AlertOverlayEntry when a task:alert event is emitted', () => {
      getState().init(eventBus);
      const event = makeAlertEvent();

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', event);

      expect(getState().queue).toHaveLength(1);
    });

    it('should map all AlertEvent fields to AlertOverlayEntry correctly', () => {
      getState().init(eventBus);
      const event = makeAlertEvent({
        taskId: 42,
        storyId: 99,
        storyTitle: 'My Story',
        stageName: 'qa',
        issues: ['issue-1', 'issue-2'],
        routedTo: 'tester',
        attempt: 1,
        maxAttempts: 5,
        isBlocked: false,
      });

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', event);

      const entry = getState().queue[0];
      expect(entry).toBeDefined();
      expect(entry!.taskId).toBe(42);
      expect(entry!.storyId).toBe(99);
      expect(entry!.storyTitle).toBe('My Story');
      expect(entry!.stageName).toBe('qa');
      expect(entry!.issues).toEqual(['issue-1', 'issue-2']);
      expect(entry!.routedTo).toBe('tester');
      expect(entry!.attempt).toBe(1);
      expect(entry!.maxAttempts).toBe(5);
      expect(entry!.isBlocked).toBe(false);
    });

    it('should generate a non-empty string id for the entry', () => {
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());

      const entry = getState().queue[0];
      expect(typeof entry!.id).toBe('string');
      expect(entry!.id.length).toBeGreaterThan(0);
    });

    it('should set timestamp as a recent epoch ms number', () => {
      const before = Date.now();
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());
      const after = Date.now();

      const entry = getState().queue[0];
      expect(entry!.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry!.timestamp).toBeLessThanOrEqual(after);
    });

    it('should set currentAlert to the first queued entry', () => {
      getState().init(eventBus);
      const event = makeAlertEvent({ storyTitle: 'First Alert' });

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', event);

      expect(getState().currentAlert).not.toBeNull();
      expect(getState().currentAlert!.storyTitle).toBe('First Alert');
    });

    it('should set queueLength to 1 after one event', () => {
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());

      expect(getState().queueLength).toBe(1);
    });

    it('should append multiple alerts to the queue in order', () => {
      getState().init(eventBus);

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Alert A' }));
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Alert B' }));
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Alert C' }));

      expect(getState().queue).toHaveLength(3);
      expect(getState().queue[0]!.storyTitle).toBe('Alert A');
      expect(getState().queue[1]!.storyTitle).toBe('Alert B');
      expect(getState().queue[2]!.storyTitle).toBe('Alert C');
    });

    it('should set queueLength to 3 after three events', () => {
      getState().init(eventBus);

      for (let i = 0; i < 3; i++) {
        (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());
      }

      expect(getState().queueLength).toBe(3);
    });

    it('should keep currentAlert pointing to queue[0] when multiple alerts are queued', () => {
      getState().init(eventBus);

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'First' }));
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Second' }));

      expect(getState().currentAlert!.storyTitle).toBe('First');
    });

    it('should handle isBlocked: true alerts correctly', () => {
      getState().init(eventBus);
      const event = makeAlertEvent({ isBlocked: true, routedTo: undefined });

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', event);

      expect(getState().currentAlert!.isBlocked).toBe(true);
      expect(getState().currentAlert!.routedTo).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: dismiss() removes first alert
  // -------------------------------------------------------------------------
  describe('dismiss()', () => {
    it('should remove the first alert from the queue', () => {
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'A' }));
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'B' }));

      getState().dismiss();

      expect(getState().queue).toHaveLength(1);
      expect(getState().queue[0]!.storyTitle).toBe('B');
    });

    it('should make currentAlert return the second alert after dismissing the first', () => {
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'First' }));
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Second' }));

      getState().dismiss();

      expect(getState().currentAlert!.storyTitle).toBe('Second');
    });

    it('should set currentAlert to null after dismissing the only alert', () => {
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());

      getState().dismiss();

      expect(getState().currentAlert).toBeNull();
    });

    it('should set queueLength to 0 after dismissing the only alert', () => {
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());

      getState().dismiss();

      expect(getState().queueLength).toBe(0);
    });

    it('should be idempotent when called on empty queue — no throw', () => {
      expect(() => getState().dismiss()).not.toThrow();
    });

    it('should leave queue empty when called on already-empty queue', () => {
      getState().dismiss();
      expect(getState().queue).toEqual([]);
      expect(getState().queueLength).toBe(0);
    });

    it('should remove alerts one by one until queue is empty', () => {
      getState().init(eventBus);
      for (let i = 0; i < 3; i++) {
        (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: `Alert ${i}` }));
      }

      getState().dismiss();
      expect(getState().queueLength).toBe(2);

      getState().dismiss();
      expect(getState().queueLength).toBe(1);

      getState().dismiss();
      expect(getState().queueLength).toBe(0);
      expect(getState().currentAlert).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: currentAlert / queueLength computed getters
  // -------------------------------------------------------------------------
  describe('currentAlert computed getter', () => {
    it('should return null when queue is empty', () => {
      expect(getState().currentAlert).toBeNull();
    });

    it('should always return queue[0] when queue is non-empty', () => {
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Head' }));
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Tail' }));

      expect(getState().currentAlert!.storyTitle).toBe('Head');
    });
  });

  describe('queueLength computed getter', () => {
    it('should return 0 when queue is empty', () => {
      expect(getState().queueLength).toBe(0);
    });

    it('should return the exact number of entries in the queue', () => {
      getState().init(eventBus);

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());
      expect(getState().queueLength).toBe(1);

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());
      expect(getState().queueLength).toBe(2);

      getState().dismiss();
      expect(getState().queueLength).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: cleanup() unsubscribes from task:alert
  // -------------------------------------------------------------------------
  describe('cleanup()', () => {
    it('should unsubscribe from "task:alert" when cleanup() is called', () => {
      const offSpy = vi.spyOn(eventBus, 'off');

      getState().init(eventBus);
      getState().cleanup();

      expect(offSpy).toHaveBeenCalledWith('task:alert', expect.any(Function));
    });

    it('should stop receiving task:alert events after cleanup()', () => {
      getState().init(eventBus);
      getState().cleanup();

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());

      // Queue must stay empty because handler was unsubscribed
      expect(getState().queue).toHaveLength(0);
      expect(getState().currentAlert).toBeNull();
    });

    it('should not throw when cleanup() is called before init()', () => {
      expect(() => getState().cleanup()).not.toThrow();
    });

    it('should not throw when cleanup() is called multiple times', () => {
      getState().init(eventBus);
      expect(() => {
        getState().cleanup();
        getState().cleanup();
      }).not.toThrow();
    });

    it('should not affect queue state already accumulated before cleanup()', () => {
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Before cleanup' }));

      getState().cleanup();

      // Queue retains alerts that arrived before cleanup
      expect(getState().queue).toHaveLength(1);
      expect(getState().currentAlert!.storyTitle).toBe('Before cleanup');
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('should generate unique ids for separate alert entries', () => {
      getState().init(eventBus);

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent());

      const [first, second] = getState().queue;
      expect(first!.id).not.toBe(second!.id);
    });

    it('should not mutate existing queue entries when a new event is appended', () => {
      getState().init(eventBus);
      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Original' }));

      const snapshotBefore = getState().queue[0];

      (eventBus as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'New' }));

      // First entry reference or value should remain unchanged
      expect(getState().queue[0]!.storyTitle).toBe('Original');
      expect(getState().queue[0]).toBe(snapshotBefore);
    });

    it('should work correctly after re-init on a new eventBus', () => {
      const bus1 = createMockEventBus();
      const bus2 = createMockEventBus();

      getState().init(bus1);
      (bus1 as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'From bus1' }));

      expect(getState().queue).toHaveLength(1);

      // Re-init with bus2 — bus1 handler should be unsubscribed
      resetStore();
      getState().init(bus2);

      (bus1 as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'Should be ignored' }));
      expect(getState().queue).toHaveLength(0);

      (bus2 as unknown as { emit: (e: string, p: AlertEvent) => void }).emit('task:alert', makeAlertEvent({ storyTitle: 'From bus2' }));
      expect(getState().queue).toHaveLength(1);
      expect(getState().currentAlert!.storyTitle).toBe('From bus2');
    });

    it('setState patch preserves action methods after reset — dismiss/init/cleanup survive setState(INITIAL_STATE, true)', () => {
      resetStore(); // calls setState with replace=true
      const state = getState();
      expect(typeof state.init).toBe('function');
      expect(typeof state.dismiss).toBe('function');
      expect(typeof state.cleanup).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // Pure Zustand — no React/Ink dependency
  // -------------------------------------------------------------------------
  describe('store purity', () => {
    it('should have getState() as a function (Zustand API)', () => {
      expect(typeof useAlertStore.getState).toBe('function');
    });

    it('should have setState() as a function (Zustand API)', () => {
      expect(typeof useAlertStore.setState).toBe('function');
    });

    it('should have subscribe() as a function (Zustand API)', () => {
      expect(typeof useAlertStore.subscribe).toBe('function');
    });

    it('should be usable without mounting a React component', () => {
      expect(() => getState()).not.toThrow();
    });
  });
});
