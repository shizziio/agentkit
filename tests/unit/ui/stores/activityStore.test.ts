import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { EventBus } from '@core/EventBus.js';
import type { EventMap, StreamEvent, StoryCompleteEvent, LogEvent } from '@core/EventTypes.js';
import { MAX_ACTIVITY_EVENTS, ACTIVITY_VISIBLE_ROWS } from '@config/defaults.js';

// ---------------------------------------------------------------------------
// Module under test — will fail to import until activityStore.ts is created.
// ---------------------------------------------------------------------------
import { useActivityStore, formatStreamEvent, formatLogEvent } from '@stores/activityStore.js';
import type { ActivityEvent } from '@stores/activityStore.js';

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
// Helpers
// ---------------------------------------------------------------------------
const INITIAL_STATE = {
  events: [] as ActivityEvent[],
  scrollIndex: 0,
  isFollowing: true,
};

function resetStore(): void {
  useActivityStore.setState(INITIAL_STATE, true);
}

function getState() {
  return useActivityStore.getState();
}

function makeStreamEvent(type: StreamEvent['type'], overrides: Partial<StreamEvent> = {}): StreamEvent {
  return {
    taskId: 1,
    stageName: 'dev',
    timestamp: new Date('2024-01-01T12:34:56.000Z').getTime(),
    type,
    data: {},
    ...overrides,
  };
}

function makeLogEvent(level: LogEvent['level'], overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    level,
    module: 'test-module',
    message: 'Test message',
    timestamp: '2024-01-01T12:34:56.000Z',
    ...overrides,
  };
}

function makeCompletionEvent(overrides: Partial<StoryCompleteEvent> = {}): StoryCompleteEvent {
  return {
    storyId: 1,
    storyKey: 'STORY-001',
    epicKey: 'EPIC-001',
    durationMs: 60000,
    storyTitle: 'Test Story',
    stageDurations: [{ stageName: 'dev', durationMs: 30000 }],
    totalAttempts: 2,
    ...overrides,
  };
}

function makeActivityEvent(overrides: Partial<Omit<ActivityEvent, 'id'>> = {}): Omit<ActivityEvent, 'id'> {
  return {
    timestamp: '12:34:56',
    stageName: 'dev',
    icon: '💬',
    label: 'text',
    message: 'test message',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useActivityStore', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    resetStore();
    eventBus = createMockEventBus();
    getState().cleanup();
  });

  afterEach(() => {
    getState().cleanup();
    resetStore();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('has empty events array', () => {
      expect(getState().events).toEqual([]);
    });

    it('has scrollIndex of 0', () => {
      expect(getState().scrollIndex).toBe(0);
    });

    it('has isFollowing of true', () => {
      expect(getState().isFollowing).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // init() — subscription registration
  // -------------------------------------------------------------------------
  describe('init()', () => {
    it('subscribes to exactly 8 events via eventBus.on', () => {
      const onSpy = vi.spyOn(eventBus, 'on');
      getState().init(eventBus);
      expect(onSpy).toHaveBeenCalledTimes(8);
      const events = onSpy.mock.calls.map((c) => c[0]);
      expect(events).toContain('stream:tool_use');
      expect(events).toContain('stream:tool_result');
      expect(events).toContain('stream:text');
      expect(events).toContain('stream:thinking');
      expect(events).toContain('stream:error');
      expect(events).toContain('stream:done');
      expect(events).toContain('story:completed');
      expect(events).toContain('app:log');
    });

    it('calls cleanup() first to prevent double-subscribing when init() is called twice', () => {
      const offSpy = vi.spyOn(eventBus, 'off');
      getState().init(eventBus);
      getState().init(eventBus); // second call triggers cleanup of first
      expect(offSpy).toHaveBeenCalledTimes(8);
    });

    it('does not throw when called on an uninitialized store', () => {
      expect(() => getState().init(eventBus)).not.toThrow();
    });

    it('does not double-subscribe: second init replaces first subscriptions', () => {
      vi.useFakeTimers();
      getState().init(eventBus);
      getState().init(eventBus); // internally calls cleanup() first

      // Only one handler per event — no double-dispatch
      eventBus.emit('stream:text', makeStreamEvent('text', { data: { text: 'hello' } }));
      vi.advanceTimersByTime(1000);
      expect(getState().events).toHaveLength(1);
      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // addEvent() action
  // -------------------------------------------------------------------------
  describe('addEvent() action', () => {
    it('adds an event and assigns a numeric id', () => {
      getState().addEvent(makeActivityEvent());
      expect(getState().events).toHaveLength(1);
      expect(typeof getState().events[0]!.id).toBe('number');
    });

    it('assigns monotonically increasing ids across successive addEvent calls', () => {
      getState().addEvent(makeActivityEvent({ message: 'first' }));
      getState().addEvent(makeActivityEvent({ message: 'second' }));
      const [first, second] = getState().events;
      expect(second!.id).toBeGreaterThan(first!.id);
    });

    it('applies FIFO cap at MAX_ACTIVITY_EVENTS: oldest events trimmed', () => {
      for (let i = 0; i < MAX_ACTIVITY_EVENTS + 1; i++) {
        getState().addEvent(makeActivityEvent({ message: `msg-${i}` }));
      }
      expect(getState().events).toHaveLength(MAX_ACTIVITY_EVENTS);
      // msg-0 was shifted out; first remaining event is msg-1
      expect(getState().events[0]!.message).toBe('msg-1');
    });

    it('events.length never exceeds MAX_ACTIVITY_EVENTS', () => {
      for (let i = 0; i < MAX_ACTIVITY_EVENTS + 50; i++) {
        getState().addEvent(makeActivityEvent({ message: `msg-${i}` }));
      }
      expect(getState().events.length).toBeLessThanOrEqual(MAX_ACTIVITY_EVENTS);
    });

    it('auto-advances scrollIndex when isFollowing=true and events exceed ACTIVITY_VISIBLE_ROWS', () => {
      for (let i = 0; i < ACTIVITY_VISIBLE_ROWS + 5; i++) {
        getState().addEvent(makeActivityEvent());
      }
      expect(getState().isFollowing).toBe(true);
      // scrollIndex = ACTIVITY_VISIBLE_ROWS + 5 - ACTIVITY_VISIBLE_ROWS = 5
      expect(getState().scrollIndex).toBe(5);
    });

    it('scrollIndex stays at 0 when events count is <= ACTIVITY_VISIBLE_ROWS (isFollowing=true)', () => {
      for (let i = 0; i < ACTIVITY_VISIBLE_ROWS; i++) {
        getState().addEvent(makeActivityEvent());
      }
      expect(getState().scrollIndex).toBe(0);
    });

    it('does NOT change scrollIndex when isFollowing=false', () => {
      useActivityStore.setState({ isFollowing: false, scrollIndex: 3 });
      getState().addEvent(makeActivityEvent());
      expect(getState().scrollIndex).toBe(3);
    });

    it('preserves all event fields (timestamp, stageName, icon, label, message)', () => {
      const event = makeActivityEvent({
        timestamp: '10:00:00',
        stageName: 'sm-worker',
        icon: '🧠',
        label: 'thinking',
        message: 'deep thought',
      });
      getState().addEvent(event);
      const added = getState().events[0]!;
      expect(added.timestamp).toBe('10:00:00');
      expect(added.stageName).toBe('sm-worker');
      expect(added.icon).toBe('🧠');
      expect(added.label).toBe('thinking');
      expect(added.message).toBe('deep thought');
    });
  });

  // -------------------------------------------------------------------------
  // addCompletion() action
  // -------------------------------------------------------------------------
  describe('addCompletion() action', () => {
    it('adds a completion event with completionData populated', () => {
      getState().addCompletion(makeCompletionEvent());
      expect(getState().events).toHaveLength(1);
      const added = getState().events[0]!;
      expect(added.icon).toBe('✓');
      expect(added.label).toBe('complete');
      expect(added.stageName).toBe('—');
      expect(added.completionData).toBeDefined();
      expect(added.completionData!.storyTitle).toBe('Test Story');
      expect(added.completionData!.stageDurations).toEqual([{ stageName: 'dev', durationMs: 30000 }]);
      expect(added.completionData!.totalDurationMs).toBe(60000);
      expect(added.completionData!.totalAttempts).toBe(2);
    });

    it('falls back to storyKey when storyTitle is undefined', () => {
      getState().addCompletion(makeCompletionEvent({ storyTitle: undefined as unknown as string }));
      const added = getState().events[0]!;
      expect(added.message).toBe('STORY-001');
      expect(added.completionData!.storyTitle).toBe('STORY-001');
    });

    it('applies FIFO cap at MAX_ACTIVITY_EVENTS for completion events', () => {
      for (let i = 0; i < MAX_ACTIVITY_EVENTS; i++) {
        getState().addEvent(makeActivityEvent({ message: `fill-${i}` }));
      }
      getState().addCompletion(makeCompletionEvent());
      expect(getState().events).toHaveLength(MAX_ACTIVITY_EVENTS);
      expect(getState().events[MAX_ACTIVITY_EVENTS - 1]!.label).toBe('complete');
    });

    it('auto-advances scrollIndex when isFollowing=true', () => {
      for (let i = 0; i < ACTIVITY_VISIBLE_ROWS + 2; i++) {
        getState().addEvent(makeActivityEvent());
      }
      const scrollBefore = getState().scrollIndex;
      getState().addCompletion(makeCompletionEvent());
      expect(getState().scrollIndex).toBeGreaterThan(scrollBefore);
    });
  });

  // -------------------------------------------------------------------------
  // scrollUp() action
  // -------------------------------------------------------------------------
  describe('scrollUp() action', () => {
    it('decreases scrollIndex by 3', () => {
      useActivityStore.setState({ scrollIndex: 10, isFollowing: false });
      getState().scrollUp();
      expect(getState().scrollIndex).toBe(7);
    });

    it('sets isFollowing to false', () => {
      useActivityStore.setState({ scrollIndex: 10, isFollowing: true });
      getState().scrollUp();
      expect(getState().isFollowing).toBe(false);
    });

    it('clamps scrollIndex at 0 when scrollIndex < 3', () => {
      useActivityStore.setState({ scrollIndex: 2, isFollowing: false });
      getState().scrollUp();
      expect(getState().scrollIndex).toBe(0);
    });

    it('clamps scrollIndex at 0 when scrollIndex is already 0', () => {
      useActivityStore.setState({ scrollIndex: 0, isFollowing: false });
      getState().scrollUp();
      expect(getState().scrollIndex).toBe(0);
    });

    it('sets isFollowing to false even when at scrollIndex=0', () => {
      useActivityStore.setState({ scrollIndex: 0, isFollowing: true });
      getState().scrollUp();
      expect(getState().isFollowing).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // scrollDown() action
  // -------------------------------------------------------------------------
  describe('scrollDown() action', () => {
    it('increases scrollIndex by 3', () => {
      for (let i = 0; i < ACTIVITY_VISIBLE_ROWS + 10; i++) {
        getState().addEvent(makeActivityEvent());
      }
      useActivityStore.setState({ scrollIndex: 2, isFollowing: false });
      getState().scrollDown();
      expect(getState().scrollIndex).toBe(5);
    });

    it('sets isFollowing to true when scrollIndex reaches maxScroll', () => {
      // Add exactly ACTIVITY_VISIBLE_ROWS + 2 events → maxScroll = 2
      for (let i = 0; i < ACTIVITY_VISIBLE_ROWS + 2; i++) {
        getState().addEvent(makeActivityEvent());
      }
      useActivityStore.setState({ scrollIndex: 0, isFollowing: false });
      // scrollDown: min(0+3, 2) = 2 = maxScroll → isFollowing=true
      getState().scrollDown();
      expect(getState().isFollowing).toBe(true);
    });

    it('scrollIndex stays 0 and isFollowing=true when events.length < ACTIVITY_VISIBLE_ROWS (maxScroll=0)', () => {
      getState().addEvent(makeActivityEvent()); // 1 event << ACTIVITY_VISIBLE_ROWS
      useActivityStore.setState({ scrollIndex: 0, isFollowing: false });
      getState().scrollDown();
      expect(getState().scrollIndex).toBe(0);
      expect(getState().isFollowing).toBe(true);
    });

    it('does not allow scrollIndex to exceed maxScroll', () => {
      for (let i = 0; i < ACTIVITY_VISIBLE_ROWS + 1; i++) {
        getState().addEvent(makeActivityEvent());
      }
      // maxScroll = 1
      useActivityStore.setState({ scrollIndex: 0, isFollowing: false });
      getState().scrollDown(); // min(3, 1) = 1
      expect(getState().scrollIndex).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // clearEvents() action
  // -------------------------------------------------------------------------
  describe('clearEvents() action', () => {
    it('resets events to empty array', () => {
      getState().addEvent(makeActivityEvent());
      getState().clearEvents();
      expect(getState().events).toEqual([]);
    });

    it('resets scrollIndex to 0', () => {
      useActivityStore.setState({ scrollIndex: 7 });
      getState().clearEvents();
      expect(getState().scrollIndex).toBe(0);
    });

    it('resets isFollowing to true', () => {
      useActivityStore.setState({ isFollowing: false });
      getState().clearEvents();
      expect(getState().isFollowing).toBe(true);
    });

    it('does NOT reset _nextId — ids continue incrementing after clearEvents', () => {
      getState().addEvent(makeActivityEvent());
      const idBeforeClear = getState().events[0]!.id;
      getState().clearEvents();
      getState().addEvent(makeActivityEvent());
      const idAfterClear = getState().events[0]!.id;
      // ID after clear must be strictly greater than id before clear
      expect(idAfterClear).toBeGreaterThan(idBeforeClear);
    });
  });

  // -------------------------------------------------------------------------
  // Store persistence (survives component lifecycle)
  // -------------------------------------------------------------------------
  describe('store persistence', () => {
    it('events persist across multiple getState() calls (module-level persistence)', () => {
      getState().addEvent(makeActivityEvent({ message: 'persistent-event' }));
      // Re-access store — state is module-level, not component-scoped
      const freshAccess = useActivityStore.getState();
      expect(freshAccess.events).toHaveLength(1);
      expect(freshAccess.events[0]!.message).toBe('persistent-event');
    });

    it('store state is NOT cleared when scrollIndex/isFollowing is read from new context', () => {
      getState().addEvent(makeActivityEvent({ message: 'stays-alive' }));
      // Simulate "navigating away and back" — state at module level survives
      expect(useActivityStore.getState().events[0]!.message).toBe('stays-alive');
    });
  });

  // -------------------------------------------------------------------------
  // Event bus subscriptions — via init() + fake timers to flush throttle
  // -------------------------------------------------------------------------
  describe('event bus subscriptions', () => {
    describe('stream:text', () => {
      it('adds event with icon 💬 and label text', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:text', makeStreamEvent('text', { data: { text: 'hello world' } }));
        vi.advanceTimersByTime(1000);
        const events = getState().events;
        expect(events).toHaveLength(1);
        expect(events[0]!.icon).toBe('💬');
        expect(events[0]!.label).toBe('text');
        expect(events[0]!.message).toBe('hello world');
        vi.useRealTimers();
      });
    });

    describe('stream:thinking', () => {
      it('adds event with icon 🧠 and label thinking', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:thinking', makeStreamEvent('thinking', { data: { thinking: 'pondering' } }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('🧠');
        expect(getState().events[0]!.label).toBe('thinking');
        vi.useRealTimers();
      });
    });

    describe('stream:tool_use', () => {
      it('produces icon 📖 and label Read for toolName=Read', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', {
          data: { toolName: 'Read', toolInput: { file_path: '/src/foo.ts' } },
        }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('📖');
        expect(getState().events[0]!.label).toBe('Read');
        vi.useRealTimers();
      });

      it('produces icon ✏️ and label Edit for toolName=Edit', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', {
          data: { toolName: 'Edit', toolInput: { file_path: '/src/bar.ts' } },
        }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('✏️');
        expect(getState().events[0]!.label).toBe('Edit');
        vi.useRealTimers();
      });

      it('produces icon ⚡ and label Bash for toolName=Bash', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', {
          data: { toolName: 'Bash', toolInput: { command: 'ls -la' } },
        }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('⚡');
        expect(getState().events[0]!.label).toBe('Bash');
        vi.useRealTimers();
      });

      it('produces icon 🔍 and label Grep for toolName=Grep', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', {
          data: { toolName: 'Grep', toolInput: { pattern: 'foo' } },
        }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('🔍');
        expect(getState().events[0]!.label).toBe('Grep');
        vi.useRealTimers();
      });

      it('produces icon 🔧 for unknown tool names', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', {
          data: { toolName: 'UnknownTool', toolInput: {} },
        }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('🔧');
        vi.useRealTimers();
      });
    });

    describe('stream:tool_result', () => {
      it('adds event with icon ✅ and label result', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:tool_result', makeStreamEvent('tool_result', { data: { toolResult: 'ok' } }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('✅');
        expect(getState().events[0]!.label).toBe('result');
        vi.useRealTimers();
      });
    });

    describe('stream:error', () => {
      it('adds event with icon ✖ and label error', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:error', makeStreamEvent('error', { data: { error: 'something failed' } }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('✖');
        expect(getState().events[0]!.label).toBe('error');
        vi.useRealTimers();
      });
    });

    describe('stream:done', () => {
      it('adds event with icon ✓ and label done', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:done', makeStreamEvent('done', { data: { inputTokens: 100, outputTokens: 50 } }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('✓');
        expect(getState().events[0]!.label).toBe('done');
        vi.useRealTimers();
      });

      it('includes token usage info in message when inputTokens is provided', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('stream:done', makeStreamEvent('done', { data: { inputTokens: 123, outputTokens: 45 } }));
        vi.advanceTimersByTime(1000);
        const msg = getState().events[0]!.message;
        expect(msg).toContain('123');
        vi.useRealTimers();
      });
    });

    describe('story:completed', () => {
      it('adds completion event with completionData populated', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('story:completed', makeCompletionEvent());
        vi.advanceTimersByTime(1000);
        const events = getState().events;
        expect(events).toHaveLength(1);
        expect(events[0]!.completionData).toBeDefined();
        expect(events[0]!.completionData!.storyTitle).toBe('Test Story');
        expect(events[0]!.completionData!.totalAttempts).toBe(2);
        expect(events[0]!.completionData!.totalDurationMs).toBe(60000);
        vi.useRealTimers();
      });

      it('falls back to storyKey for message when storyTitle is undefined', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('story:completed', makeCompletionEvent({ storyTitle: undefined as unknown as string }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.message).toBe('STORY-001');
        vi.useRealTimers();
      });
    });

    describe('app:log', () => {
      it('adds event with icon 🔴 and isAppLog=true for level ERROR', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('app:log', makeLogEvent('ERROR'));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('🔴');
        expect(getState().events[0]!.isAppLog).toBe(true);
        vi.useRealTimers();
      });

      it('adds event with icon ⚠️ and isAppLog=true for level WARN', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('app:log', makeLogEvent('WARN'));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('⚠️');
        expect(getState().events[0]!.isAppLog).toBe(true);
        vi.useRealTimers();
      });

      it('adds event with icon 📋 and isAppLog=true for level INFO', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('app:log', makeLogEvent('INFO'));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.icon).toBe('📋');
        expect(getState().events[0]!.isAppLog).toBe(true);
        vi.useRealTimers();
      });

      it('sets stageName from event.module', () => {
        vi.useFakeTimers();
        getState().init(eventBus);
        eventBus.emit('app:log', makeLogEvent('INFO', { module: 'pipeline-manager' }));
        vi.advanceTimersByTime(1000);
        expect(getState().events[0]!.stageName).toBe('pipeline-manager');
        vi.useRealTimers();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Throttle behaviour
  // -------------------------------------------------------------------------
  describe('throttle behaviour', () => {
    it('multiple events emitted within throttle window are all committed after flush interval', () => {
      vi.useFakeTimers();
      getState().init(eventBus);

      // Use different event types to avoid text merging
      eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', { data: { toolName: 'Read', toolInput: { file_path: 'a.ts' } } }));
      eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', { data: { toolName: 'Edit', toolInput: { file_path: 'b.ts' } } }));
      eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', { data: { toolName: 'Bash', toolInput: { command: 'ls' } } }));

      // Advance past the flush interval — all pending events must be committed
      vi.advanceTimersByTime(1000);
      expect(getState().events).toHaveLength(3);
      vi.useRealTimers();
    });

    it('1s flush interval ensures no pending events are permanently lost', () => {
      vi.useFakeTimers();
      getState().init(eventBus);
      eventBus.emit('stream:text', makeStreamEvent('text', { data: { text: 'must-appear' } }));
      vi.advanceTimersByTime(1000);
      expect(getState().events.some((e) => e.message === 'must-appear')).toBe(true);
      vi.useRealTimers();
    });

    it('flush interval is cleared after cleanup() — no events processed after cleanup', () => {
      vi.useFakeTimers();
      getState().init(eventBus);
      eventBus.emit('stream:text', makeStreamEvent('text', { data: { text: 'buffered' } }));
      getState().cleanup(); // cleanup clears interval and unsubscribes
      vi.advanceTimersByTime(5000); // advance far past any interval
      expect(getState().events).toHaveLength(0);
      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // cleanup()
  // -------------------------------------------------------------------------
  describe('cleanup()', () => {
    it('unsubscribes all 8 event handlers via eventBus.off', () => {
      const offSpy = vi.spyOn(eventBus, 'off');
      getState().init(eventBus);
      getState().cleanup();
      expect(offSpy).toHaveBeenCalledTimes(8);
      const unsubscribed = offSpy.mock.calls.map((c) => c[0]);
      expect(unsubscribed).toContain('stream:tool_use');
      expect(unsubscribed).toContain('stream:tool_result');
      expect(unsubscribed).toContain('stream:text');
      expect(unsubscribed).toContain('stream:thinking');
      expect(unsubscribed).toContain('stream:error');
      expect(unsubscribed).toContain('stream:done');
      expect(unsubscribed).toContain('story:completed');
      expect(unsubscribed).toContain('app:log');
    });

    it('clears the 1s flush interval on cleanup', () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      getState().init(eventBus);
      getState().cleanup();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    });

    it('store does NOT receive events after cleanup', () => {
      vi.useFakeTimers();
      getState().init(eventBus);
      getState().cleanup();
      eventBus.emit('stream:text', makeStreamEvent('text', { data: { text: 'should-not-appear' } }));
      vi.advanceTimersByTime(1000);
      expect(getState().events).toHaveLength(0);
      vi.useRealTimers();
    });

    it('is safe to call cleanup() before init() (no-op, does not throw)', () => {
      // beforeEach already called cleanup(), calling again should not throw
      expect(() => getState().cleanup()).not.toThrow();
    });

    it('calling cleanup() twice without init() does not throw', () => {
      getState().init(eventBus);
      getState().cleanup();
      expect(() => getState().cleanup()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // formatStreamEvent() — pure exported function
  // -------------------------------------------------------------------------
  describe('formatStreamEvent()', () => {
    it('formats stream:text with icon 💬, label text, and message from data.text', () => {
      const result = formatStreamEvent(makeStreamEvent('text', { data: { text: 'hello' } }));
      expect(result.icon).toBe('💬');
      expect(result.label).toBe('text');
      expect(result.message).toBe('hello');
    });

    it('formats stream:thinking with icon 🧠 and label thinking', () => {
      const result = formatStreamEvent(makeStreamEvent('thinking', { data: { thinking: 'deep thoughts' } }));
      expect(result.icon).toBe('🧠');
      expect(result.label).toBe('thinking');
    });

    it('formats stream:tool_use Read with icon 📖 and file_path as message', () => {
      const result = formatStreamEvent(makeStreamEvent('tool_use', {
        data: { toolName: 'Read', toolInput: { file_path: '/src/index.ts' } },
      }));
      expect(result.icon).toBe('📖');
      expect(result.label).toBe('Read');
      expect(result.message).toBe('/src/index.ts');
    });

    it('formats stream:tool_use Edit with icon ✏️', () => {
      const result = formatStreamEvent(makeStreamEvent('tool_use', {
        data: { toolName: 'Edit', toolInput: { file_path: '/src/foo.ts' } },
      }));
      expect(result.icon).toBe('✏️');
    });

    it('formats stream:tool_use Bash with icon ⚡ and command as message', () => {
      const result = formatStreamEvent(makeStreamEvent('tool_use', {
        data: { toolName: 'Bash', toolInput: { command: 'npm test' } },
      }));
      expect(result.icon).toBe('⚡');
      expect(result.message).toBe('npm test');
    });

    it('formats stream:tool_result with icon ✅, label result', () => {
      const result = formatStreamEvent(makeStreamEvent('tool_result', { data: { toolResult: 'success' } }));
      expect(result.icon).toBe('✅');
      expect(result.label).toBe('result');
    });

    it('formats stream:error with icon ✖ and error text as message', () => {
      const result = formatStreamEvent(makeStreamEvent('error', { data: { error: 'bad input' } }));
      expect(result.icon).toBe('✖');
      expect(result.label).toBe('error');
      expect(result.message).toBe('bad input');
    });

    it('formats stream:done with icon ✓, label done, and token info message', () => {
      const result = formatStreamEvent(makeStreamEvent('done', { data: { inputTokens: 100, outputTokens: 50 } }));
      expect(result.icon).toBe('✓');
      expect(result.label).toBe('done');
      expect(result.message).toContain('100');
      expect(result.message).toContain('50');
    });

    it('formats stream:done with empty message when inputTokens not provided', () => {
      const result = formatStreamEvent(makeStreamEvent('done', { data: {} }));
      expect(result.message).toBe('');
    });

    it('includes stageName from the stream event', () => {
      const result = formatStreamEvent(makeStreamEvent('text', { stageName: 'sm-worker', data: { text: 'hi' } }));
      expect(result.stageName).toBe('sm-worker');
    });

    it('truncates long messages at ~60 characters with ellipsis', () => {
      const longText = 'a'.repeat(70);
      const result = formatStreamEvent(makeStreamEvent('text', { data: { text: longText } }));
      expect(result.message.endsWith('…')).toBe(true);
      expect(result.message.length).toBeLessThan(70);
    });

    it('does not have id field (returns Omit<ActivityEvent, id>)', () => {
      const result = formatStreamEvent(makeStreamEvent('text', { data: { text: 'hi' } }));
      expect('id' in result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // formatLogEvent() — pure exported function
  // -------------------------------------------------------------------------
  describe('formatLogEvent()', () => {
    it('formats ERROR level with icon 🔴, lowercase label error, and isAppLog=true', () => {
      const result = formatLogEvent(makeLogEvent('ERROR'));
      expect(result.icon).toBe('🔴');
      expect(result.label).toBe('error');
      expect(result.isAppLog).toBe(true);
    });

    it('formats WARN level with icon ⚠️ and label warn', () => {
      const result = formatLogEvent(makeLogEvent('WARN'));
      expect(result.icon).toBe('⚠️');
      expect(result.label).toBe('warn');
      expect(result.isAppLog).toBe(true);
    });

    it('formats INFO level with icon 📋 and label info', () => {
      const result = formatLogEvent(makeLogEvent('INFO'));
      expect(result.icon).toBe('📋');
      expect(result.label).toBe('info');
    });

    it('formats DEBUG level with icon 📋 (default)', () => {
      const result = formatLogEvent(makeLogEvent('DEBUG'));
      expect(result.icon).toBe('📋');
    });

    it('uses event.module as stageName', () => {
      const result = formatLogEvent(makeLogEvent('INFO', { module: 'my-module' }));
      expect(result.stageName).toBe('my-module');
    });

    it('includes message content from event.message', () => {
      const result = formatLogEvent(makeLogEvent('INFO', { message: 'important log' }));
      expect(result.message).toContain('important log');
    });

    it('sets isAppLog to true for all log levels', () => {
      for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR'] as LogEvent['level'][]) {
        const result = formatLogEvent(makeLogEvent(level));
        expect(result.isAppLog).toBe(true);
      }
    });

    it('does not have id field (returns Omit<ActivityEvent, id>)', () => {
      const result = formatLogEvent(makeLogEvent('INFO'));
      expect('id' in result).toBe(false);
    });
  });
});
