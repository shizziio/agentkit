import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EventBus } from '@core/EventBus.js';
import type { EventMap } from '@core/EventTypes.js';

// ---------------------------------------------------------------------------
// Mock EventBus — structurally matches the on/off interface used by bridgeEvents.
// We cast via `as unknown as EventBus` (two-step cast) because MockEventBus
// intentionally omits EventBus methods not under test (emit, etc.).
// The two-step pattern is auditable and explicit, unlike `as never`.
// ---------------------------------------------------------------------------
type Listener<T> = (payload: T) => void;

interface MockEventBus {
  on: <K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>) => void;
  off: <K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>) => void;
}

function createMockEventBus(): MockEventBus {
  return {
    on: vi.fn(),
    off: vi.fn(),
  };
}

/** Cast helper — explicit two-step, easier to grep than scattered inline casts. */
function asBus(mock: MockEventBus): EventBus {
  return mock as unknown as EventBus;
}

// ---------------------------------------------------------------------------
// Import the module under test — will fail until bridge.ts is implemented.
// ---------------------------------------------------------------------------
import { bridgeEvents } from '@stores/bridge.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('bridgeEvents', () => {
  let mockBus: MockEventBus;

  beforeEach(() => {
    mockBus = createMockEventBus();
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: handlers are subscribed on call
  // -------------------------------------------------------------------------
  describe('subscription on call', () => {
    it('should call eventBus.on() once for a single binding', () => {
      const handler: Listener<EventMap['pipeline:start']> = vi.fn();

      bridgeEvents(asBus(mockBus), [{ event: 'pipeline:start', handler }]);

      expect(mockBus.on).toHaveBeenCalledTimes(1);
      expect(mockBus.on).toHaveBeenCalledWith('pipeline:start', handler);
    });

    it('should call eventBus.on() for each binding in a multi-binding array', () => {
      const handler1: Listener<EventMap['pipeline:start']> = vi.fn();
      const handler2: Listener<EventMap['pipeline:stop']> = vi.fn();
      const handler3: Listener<EventMap['task:queued']> = vi.fn();

      bridgeEvents(asBus(mockBus), [
        { event: 'pipeline:start', handler: handler1 },
        { event: 'pipeline:stop', handler: handler2 },
        { event: 'task:queued', handler: handler3 },
      ]);

      expect(mockBus.on).toHaveBeenCalledTimes(3);
      expect(mockBus.on).toHaveBeenCalledWith('pipeline:start', handler1);
      expect(mockBus.on).toHaveBeenCalledWith('pipeline:stop', handler2);
      expect(mockBus.on).toHaveBeenCalledWith('task:queued', handler3);
    });

    it('should call eventBus.on() for every event type in EventMap without errors', () => {
      const handler: Listener<EventMap['worker:idle']> = vi.fn();

      expect(() =>
        bridgeEvents(asBus(mockBus), [{ event: 'worker:idle', handler }]),
      ).not.toThrow();

      expect(mockBus.on).toHaveBeenCalledWith('worker:idle', handler);
    });

    it('should not call eventBus.off() at subscription time', () => {
      const handler: Listener<EventMap['pipeline:start']> = vi.fn();

      bridgeEvents(asBus(mockBus), [{ event: 'pipeline:start', handler }]);

      expect(mockBus.off).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: cleanup unsubscribes all handlers
  // -------------------------------------------------------------------------
  describe('cleanup function', () => {
    it('should return a function', () => {
      const cleanup = bridgeEvents(asBus(mockBus), []);
      expect(typeof cleanup).toBe('function');
    });

    it('should call eventBus.off() once when cleanup is called with a single binding', () => {
      const handler: Listener<EventMap['pipeline:start']> = vi.fn();
      const cleanup = bridgeEvents(asBus(mockBus), [{ event: 'pipeline:start', handler }]);

      cleanup();

      expect(mockBus.off).toHaveBeenCalledTimes(1);
      expect(mockBus.off).toHaveBeenCalledWith('pipeline:start', handler);
    });

    it('should call eventBus.off() for every binding when cleanup is called', () => {
      const handler1: Listener<EventMap['pipeline:start']> = vi.fn();
      const handler2: Listener<EventMap['task:completed']> = vi.fn();
      const handler3: Listener<EventMap['worker:busy']> = vi.fn();

      const cleanup = bridgeEvents(asBus(mockBus), [
        { event: 'pipeline:start', handler: handler1 },
        { event: 'task:completed', handler: handler2 },
        { event: 'worker:busy', handler: handler3 },
      ]);

      cleanup();

      expect(mockBus.off).toHaveBeenCalledTimes(3);
      expect(mockBus.off).toHaveBeenCalledWith('pipeline:start', handler1);
      expect(mockBus.off).toHaveBeenCalledWith('task:completed', handler2);
      expect(mockBus.off).toHaveBeenCalledWith('worker:busy', handler3);
    });

    it('should not call eventBus.on() during cleanup', () => {
      const handler: Listener<EventMap['pipeline:start']> = vi.fn();
      const cleanup = bridgeEvents(asBus(mockBus), [{ event: 'pipeline:start', handler }]);

      vi.clearAllMocks();
      cleanup();

      expect(mockBus.on).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: handler identity — same reference passed to on and off
  // -------------------------------------------------------------------------
  describe('handler identity', () => {
    it('should pass the exact same handler reference to off() as was passed to on()', () => {
      const handler: Listener<EventMap['queue:enqueued']> = vi.fn();

      const cleanup = bridgeEvents(asBus(mockBus), [{ event: 'queue:enqueued', handler }]);
      cleanup();

      const onCall = (mockBus.on as ReturnType<typeof vi.fn>).mock.calls[0];
      const offCall = (mockBus.off as ReturnType<typeof vi.fn>).mock.calls[0];

      // Same event key
      expect(onCall[0]).toBe(offCall[0]);
      // Same function reference (not a re-created arrow function)
      expect(onCall[1]).toBe(offCall[1]);
      expect(onCall[1]).toBe(handler);
    });

    it('should preserve handler identity for each binding independently', () => {
      const handlerA: Listener<EventMap['stream:text']> = vi.fn();
      const handlerB: Listener<EventMap['stream:done']> = vi.fn();

      const cleanup = bridgeEvents(asBus(mockBus), [
        { event: 'stream:text', handler: handlerA },
        { event: 'stream:done', handler: handlerB },
      ]);
      cleanup();

      const offMock = mockBus.off as ReturnType<typeof vi.fn>;
      const offCallsMap = new Map(offMock.mock.calls.map(([ev, fn]) => [ev, fn]));

      expect(offCallsMap.get('stream:text')).toBe(handlerA);
      expect(offCallsMap.get('stream:done')).toBe(handlerB);
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: empty bindings array
  // -------------------------------------------------------------------------
  describe('empty bindings array', () => {
    it('should not call on() when bindings array is empty', () => {
      bridgeEvents(asBus(mockBus), []);
      expect(mockBus.on).not.toHaveBeenCalled();
    });

    it('should not call off() when cleanup is called with empty bindings', () => {
      const cleanup = bridgeEvents(asBus(mockBus), []);
      cleanup();
      expect(mockBus.off).not.toHaveBeenCalled();
    });

    it('should not throw when cleanup is called on empty bindings', () => {
      const cleanup = bridgeEvents(asBus(mockBus), []);
      expect(() => cleanup()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: duplicate bindings (same event+handler pair twice)
  // -------------------------------------------------------------------------
  describe('duplicate bindings', () => {
    it('should call on() twice when the same event+handler appears twice in bindings', () => {
      const handler: Listener<EventMap['pipeline:start']> = vi.fn();

      bridgeEvents(asBus(mockBus), [
        { event: 'pipeline:start', handler },
        { event: 'pipeline:start', handler },
      ]);

      expect(mockBus.on).toHaveBeenCalledTimes(2);
    });

    it('should call off() twice when the same event+handler appears twice and cleanup runs', () => {
      const handler: Listener<EventMap['pipeline:start']> = vi.fn();

      const cleanup = bridgeEvents(asBus(mockBus), [
        { event: 'pipeline:start', handler },
        { event: 'pipeline:start', handler },
      ]);

      cleanup();

      expect(mockBus.off).toHaveBeenCalledTimes(2);
    });

    it('should not deduplicate duplicate bindings (mirror behaviour, caller owns correctness)', () => {
      const handler: Listener<EventMap['task:started']> = vi.fn();

      const cleanup = bridgeEvents(asBus(mockBus), [
        { event: 'task:started', handler },
        { event: 'task:started', handler },
        { event: 'task:started', handler },
      ]);

      expect(mockBus.on).toHaveBeenCalledTimes(3);

      cleanup();

      expect(mockBus.off).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: cleanup called multiple times
  // -------------------------------------------------------------------------
  describe('cleanup called multiple times', () => {
    it('should call off() for each binding on each cleanup invocation', () => {
      const handler: Listener<EventMap['pipeline:stop']> = vi.fn();

      const cleanup = bridgeEvents(asBus(mockBus), [{ event: 'pipeline:stop', handler }]);

      cleanup();
      cleanup();

      // off() should be called each time cleanup runs — no guard against double-cleanup
      // (caller owns lifecycle management, bridge just mirrors subscriptions)
      expect(mockBus.off).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Comprehensive: wires multiple domain-spanning events correctly
  // -------------------------------------------------------------------------
  describe('multiple domain bindings', () => {
    it('should correctly subscribe and unsubscribe handlers across different EventMap domains', () => {
      const onPipelineStart = vi.fn<[EventMap['pipeline:start']], void>();
      const onTaskCompleted = vi.fn<[EventMap['task:completed']], void>();
      const onWorkerIdle = vi.fn<[EventMap['worker:idle']], void>();
      const onQueueUpdated = vi.fn<[EventMap['queue:updated']], void>();
      const onAppLog = vi.fn<[EventMap['app:log']], void>();

      const cleanup = bridgeEvents(asBus(mockBus), [
        { event: 'pipeline:start', handler: onPipelineStart },
        { event: 'task:completed', handler: onTaskCompleted },
        { event: 'worker:idle', handler: onWorkerIdle },
        { event: 'queue:updated', handler: onQueueUpdated },
        { event: 'app:log', handler: onAppLog },
      ]);

      expect(mockBus.on).toHaveBeenCalledTimes(5);

      cleanup();

      expect(mockBus.off).toHaveBeenCalledTimes(5);
      expect(mockBus.off).toHaveBeenCalledWith('pipeline:start', onPipelineStart);
      expect(mockBus.off).toHaveBeenCalledWith('task:completed', onTaskCompleted);
      expect(mockBus.off).toHaveBeenCalledWith('worker:idle', onWorkerIdle);
      expect(mockBus.off).toHaveBeenCalledWith('queue:updated', onQueueUpdated);
      expect(mockBus.off).toHaveBeenCalledWith('app:log', onAppLog);
    });
  });
});
