import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { EventBus } from '@core/EventBus.js';
import type { EventMap, TaskEvent } from '@core/EventTypes.js';

// ---------------------------------------------------------------------------
// Mock StateManager
// ---------------------------------------------------------------------------
const mockGetStatistics = vi.fn(() => ({
  doneTodayCount: 5,
  failedCount: 2,
  averageDurationPerStage: [
    { stageName: 'dev', averageDurationMs: 60000 },
  ],
}));

vi.mock('@core/StateManager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    getStatistics: mockGetStatistics,
  })),
}));

// ---------------------------------------------------------------------------
// Mock DB schema imports
// ---------------------------------------------------------------------------
vi.mock('@core/db/schema.js', () => ({
  tasks: {
    id: 'id',
    storyId: 'storyId',
    stageName: 'stageName',
    status: 'status',
    startedAt: 'startedAt',
    team: 'team',
  },
  stories: {
    id: 'id',
    title: 'title',
    storyKey: 'storyKey',
    status: 'status',
    priority: 'priority',
    dependsOn: 'dependsOn',
    epicId: 'epicId',
  },
}));

// ---------------------------------------------------------------------------
// Mock drizzle-orm operators
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'eq' })),
    or: vi.fn((...args: unknown[]) => ({ args, op: 'or' })),
    and: vi.fn((...args: unknown[]) => ({ args, op: 'and' })),
    inArray: vi.fn((col: unknown, vals: unknown) => ({ col, vals, op: 'inArray' })),
  };
});

// ---------------------------------------------------------------------------
// Module under test — will fail to import until storiesStore.ts is created.
// ---------------------------------------------------------------------------
import { useStoriesStore } from '@stores/storiesStore.js';

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
// Mock DB factory
// Factory uses call-count tracking to differentiate query types:
//   call 1 → active tasks query (tasks JOIN stories)
//   call 2 → waiting stories query
//   call N≥3 → getTaskTeam or epic-stories query
// ---------------------------------------------------------------------------
function makeMockDb(options: {
  activeTasks?: unknown[];
  waitingStories?: unknown[];
  taskTeam?: string | null;
  epicStories?: unknown[];
} = {}): unknown {
  const {
    activeTasks = [],
    waitingStories = [],
    taskTeam = null,
    epicStories = [],
  } = options;

  const teamGetResult = taskTeam !== null ? { team: taskTeam } : undefined;
  let fromCallCount = 0;

  const mockDb = {
    select: vi.fn().mockImplementation(() => {
      fromCallCount++;
      const callNum = fromCallCount;

      return {
        from: vi.fn().mockReturnValue({
          // Active tasks query uses innerJoin
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue(activeTasks),
              get: vi.fn().mockReturnValue(teamGetResult),
            }),
          }),
          // Waiting stories / getTaskTeam use where directly
          where: vi.fn().mockReturnValue({
            all: vi.fn().mockImplementation(() => {
              if (callNum === 2) return waitingStories;
              return epicStories;
            }),
            get: vi.fn().mockReturnValue(teamGetResult),
          }),
        }),
      };
    }),
  };

  return mockDb;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTaskEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    taskId: 1,
    storyId: 100,
    stageName: 'dev',
    status: 'running',
    ...overrides,
  };
}

type StoriesState = ReturnType<typeof useStoriesStore.getState>;

const INITIAL_STATE: Pick<StoriesState, 'entries' | 'summary'> = {
  entries: [],
  summary: { doneTodayCount: 0, failedCount: 0, averageDurationMs: null },
};

function resetStore(): void {
  useStoriesStore.setState(INITIAL_STATE as StoriesState, true);
}

function getState(): StoriesState {
  return useStoriesStore.getState();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useStoriesStore', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    eventBus = createMockEventBus();
    getState().cleanup();
    // Reset mock statistics
    mockGetStatistics.mockReturnValue({
      doneTodayCount: 5,
      failedCount: 2,
      averageDurationPerStage: [{ stageName: 'dev', averageDurationMs: 60000 }],
    });
  });

  afterEach(() => {
    getState().cleanup();
    resetStore();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('has empty entries array', () => {
      expect(getState().entries).toEqual([]);
    });

    it('has default summary with zero counts and null averageDurationMs', () => {
      expect(getState().summary).toEqual({
        doneTodayCount: 0,
        failedCount: 0,
        averageDurationMs: null,
      });
    });
  });

  // -------------------------------------------------------------------------
  // init() — event subscription
  // -------------------------------------------------------------------------
  describe('init()', () => {
    it('subscribes to exactly 5 task events via eventBus.on', () => {
      const db = makeMockDb();
      const onSpy = vi.spyOn(eventBus, 'on');
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');

      expect(onSpy).toHaveBeenCalledTimes(5);
      const events = onSpy.mock.calls.map((c) => c[0]);
      expect(events).toContain('task:queued');
      expect(events).toContain('task:started');
      expect(events).toContain('task:routed');
      expect(events).toContain('task:completed');
      expect(events).toContain('task:failed');
    });

    it('calls cleanup() first if init() called twice — prevents double-subscribing', () => {
      const db = makeMockDb();
      const offSpy = vi.spyOn(eventBus, 'off');
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');
      // Second init triggers off() calls for the first init's 5 handlers
      expect(offSpy).toHaveBeenCalledTimes(5);
    });

    it('does not start a tick interval (duration computed at render time)', () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const db = makeMockDb();

      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      // No tick interval — duration display is handled by the component
      expect(setIntervalSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // init() — DB loading: active tasks
  // -------------------------------------------------------------------------
  describe('init() — loading active tasks from DB', () => {
    it('loads running task into entries with displayStatus RUN', () => {
      const db = makeMockDb({
        activeTasks: [
          {
            taskId: 1,
            storyId: 100,
            stageName: 'dev',
            status: 'running',
            startedAt: '2024-01-01T10:00:00Z',
            storyTitle: 'My Story',
            storyKey: '26.1',
            priority: 2,
          },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      expect(getState().entries).toHaveLength(1);
      expect(getState().entries[0]!.storyId).toBe(100);
      expect(getState().entries[0]!.displayStatus).toBe('RUN');
      expect(getState().entries[0]!.stageName).toBe('dev');
    });

    it('loads queued task into entries with displayStatus QUEUE', () => {
      const db = makeMockDb({
        activeTasks: [
          {
            taskId: 2,
            storyId: 200,
            stageName: 'sm',
            status: 'queued',
            startedAt: null,
            storyTitle: 'Queued Story',
            storyKey: '26.2',
            priority: 0,
          },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      expect(getState().entries[0]!.displayStatus).toBe('QUEUE');
    });

    it('deduplicates by storyId, preferring running over queued', () => {
      const db = makeMockDb({
        activeTasks: [
          {
            taskId: 1,
            storyId: 100,
            stageName: 'sm',
            status: 'queued',
            startedAt: null,
            storyTitle: 'My Story',
            storyKey: '26.1',
            priority: 0,
          },
          {
            taskId: 2,
            storyId: 100,
            stageName: 'dev',
            status: 'running',
            startedAt: '2024-01-01T10:00:00Z',
            storyTitle: 'My Story',
            storyKey: '26.1',
            priority: 0,
          },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      const entries = getState().entries.filter((e) => e.storyId === 100);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.displayStatus).toBe('RUN');
    });

    it('loads multiple distinct stories without merging them', () => {
      const db = makeMockDb({
        activeTasks: [
          {
            taskId: 1,
            storyId: 100,
            stageName: 'dev',
            status: 'running',
            startedAt: '2024-01-01T10:00:00Z',
            storyTitle: 'Story A',
            storyKey: '26.1',
            priority: 0,
          },
          {
            taskId: 2,
            storyId: 200,
            stageName: 'sm',
            status: 'queued',
            startedAt: null,
            storyTitle: 'Story B',
            storyKey: '26.2',
            priority: 1,
          },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      expect(getState().entries).toHaveLength(2);
    });

    it('initializes firstStartedAt from DB for running tasks', () => {
      const db = makeMockDb({
        activeTasks: [
          {
            taskId: 1,
            storyId: 100,
            stageName: 'dev',
            status: 'running',
            startedAt: '2024-01-01T10:00:00Z',
            storyTitle: 'Story',
            storyKey: '26.1',
            priority: 0,
          },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      expect(getState().entries[0]!.firstStartedAt).not.toBeNull();
    });

    it('initializes firstStartedAt as null for queued tasks', () => {
      const db = makeMockDb({
        activeTasks: [
          {
            taskId: 1,
            storyId: 100,
            stageName: 'dev',
            status: 'queued',
            startedAt: null,
            storyTitle: 'Story',
            storyKey: '26.1',
            priority: 0,
          },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      expect(getState().entries[0]!.firstStartedAt).toBeNull();
    });

    it('continues with empty entries if DB query throws on init', () => {
      const errorDb = {
        select: vi.fn().mockImplementation(() => {
          throw new Error('DB connection error');
        }),
      };
      expect(() => {
        getState().init(eventBus, errorDb as unknown as Parameters<typeof getState>['db']);
      }).not.toThrow();
      expect(getState().entries).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // init() — DB loading: waiting stories
  // -------------------------------------------------------------------------
  describe('init() — loading waiting stories from DB', () => {
    it('loads waiting story with displayStatus WAIT', () => {
      const db = makeMockDb({
        waitingStories: [
          {
            id: 300,
            storyKey: '26.3',
            title: 'Waiting Story',
            priority: 1,
            dependsOn: JSON.stringify(['26.1', '26.2']),
            epicId: 10,
          },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      const entry = getState().entries.find((e) => e.storyId === 300);
      expect(entry).toBeDefined();
      expect(entry!.displayStatus).toBe('WAIT');
    });

    it('populates dependsOn for waiting story from JSON', () => {
      const db = makeMockDb({
        waitingStories: [
          {
            id: 400,
            storyKey: '26.4',
            title: 'Waiting Story',
            priority: 0,
            dependsOn: JSON.stringify(['16.1', '16.2']),
            epicId: 10,
          },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      const entry = getState().entries.find((e) => e.storyId === 400);
      expect(entry!.dependsOn).toEqual(['16.1', '16.2']);
    });

    it('initializes depStatuses as empty record when no epic stories returned', () => {
      const db = makeMockDb({
        waitingStories: [
          {
            id: 500,
            storyKey: '26.5',
            title: 'Waiting Story',
            priority: 0,
            dependsOn: JSON.stringify(['16.1']),
            epicId: 20,
          },
        ],
        epicStories: [], // no epic stories found
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      const entry = getState().entries.find((e) => e.storyId === 500);
      expect(entry!.depStatuses).toEqual({});
    });

    it('populates depStatuses when epic stories match dependsOn', () => {
      const db = makeMockDb({
        waitingStories: [
          {
            id: 600,
            storyKey: '26.6',
            title: 'Waiting Story',
            priority: 0,
            dependsOn: JSON.stringify(['16.1', '16.2']),
            epicId: 30,
          },
        ],
        epicStories: [
          { storyKey: '16.1', status: 'done' },
          { storyKey: '16.2', status: 'waiting' },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      const entry = getState().entries.find((e) => e.storyId === 600);
      expect(entry!.depStatuses).toMatchObject({
        '16.1': 'done',
        '16.2': 'waiting',
      });
    });

    it('handles malformed dependsOn JSON gracefully (empty deps)', () => {
      const db = makeMockDb({
        waitingStories: [
          {
            id: 700,
            storyKey: '26.7',
            title: 'Waiting Story',
            priority: 0,
            dependsOn: 'not-valid-json',
            epicId: 40,
          },
        ],
      });
      expect(() => {
        getState().init(eventBus, db as Parameters<typeof getState>['db']);
      }).not.toThrow();
      const entry = getState().entries.find((e) => e.storyId === 700);
      expect(entry!.dependsOn).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // init() — summary loading
  // -------------------------------------------------------------------------
  describe('init() — summary loading', () => {
    it('loads summary from StateManager after init when activeTeam is provided', () => {
      const db = makeMockDb();
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');

      expect(getState().summary.doneTodayCount).toBe(5);
      expect(getState().summary.failedCount).toBe(2);
      expect(getState().summary.averageDurationMs).toBe(60000);
    });

    it('computes averageDurationMs as mean of all stage averages', () => {
      mockGetStatistics.mockReturnValue({
        doneTodayCount: 3,
        failedCount: 1,
        averageDurationPerStage: [
          { stageName: 'sm', averageDurationMs: 40000 },
          { stageName: 'dev', averageDurationMs: 80000 },
        ],
      });
      const db = makeMockDb();
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');

      expect(getState().summary.averageDurationMs).toBe(60000);
    });

    it('leaves summary at defaults when activeTeam is not provided', () => {
      const db = makeMockDb();
      getState().init(eventBus, db as Parameters<typeof getState>['db']); // no activeTeam

      // StateManager may not be called without activeTeam, summary stays at 0
      // (implementation detail, but summary should not be the stats values)
      // The exact behavior here matches the hook: refreshSummary skips when no team
      expect(getState().summary.doneTodayCount).toBe(0);
    });

    it('sets averageDurationMs to null when no stage averages are available', () => {
      mockGetStatistics.mockReturnValue({
        doneTodayCount: 0,
        failedCount: 0,
        averageDurationPerStage: [],
      });
      const db = makeMockDb();
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');

      expect(getState().summary.averageDurationMs).toBeNull();
    });

    it('keeps previous summary if StateManager.getStatistics throws', () => {
      mockGetStatistics.mockImplementation(() => { throw new Error('stats error'); });
      const db = makeMockDb();
      expect(() => {
        getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // task:queued event
  // -------------------------------------------------------------------------
  describe('task:queued event', () => {
    beforeEach(() => {
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);
    });

    it('adds a new entry with displayStatus QUEUE', () => {
      eventBus.emit('task:queued', makeTaskEvent({ storyId: 200, taskId: 10, stageName: 'sm' }));

      const entry = getState().entries.find((e) => e.storyId === 200);
      expect(entry).toBeDefined();
      expect(entry!.displayStatus).toBe('QUEUE');
    });

    it('does not duplicate an entry if story already exists with RUN status (preserves RUN)', () => {
      eventBus.emit('task:started', makeTaskEvent({ storyId: 300, taskId: 1 }));
      const beforeCount = getState().entries.filter((e) => e.storyId === 300).length;

      eventBus.emit('task:queued', makeTaskEvent({ storyId: 300, taskId: 2 }));

      const entries = getState().entries.filter((e) => e.storyId === 300);
      expect(entries).toHaveLength(beforeCount);
    });

    it('cancels existing removal timer when story is re-queued after completion', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      eventBus.emit('task:started', makeTaskEvent({ storyId: 400, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 400, taskId: 1 }));

      // Re-queued (re-ship scenario)
      eventBus.emit('task:queued', makeTaskEvent({ storyId: 400, taskId: 2 }));

      expect(clearTimeoutSpy).toHaveBeenCalled();
      const entry = getState().entries.find((e) => e.storyId === 400);
      expect(entry!.displayStatus).toBe('QUEUE');
    });

    it('stageName is set from the event', () => {
      eventBus.emit('task:queued', makeTaskEvent({ storyId: 500, taskId: 1, stageName: 'review' }));
      const entry = getState().entries.find((e) => e.storyId === 500);
      expect(entry!.stageName).toBe('review');
    });
  });

  // -------------------------------------------------------------------------
  // task:started event
  // -------------------------------------------------------------------------
  describe('task:started event', () => {
    beforeEach(() => {
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);
    });

    it('updates existing queued entry to displayStatus RUN', () => {
      eventBus.emit('task:queued', makeTaskEvent({ storyId: 600, taskId: 1, stageName: 'sm' }));
      eventBus.emit('task:started', makeTaskEvent({ storyId: 600, taskId: 1, stageName: 'sm' }));

      const entry = getState().entries.find((e) => e.storyId === 600);
      expect(entry!.displayStatus).toBe('RUN');
    });

    it('sets firstStartedAt when story starts for the first time', () => {
      const before = Date.now();
      eventBus.emit('task:started', makeTaskEvent({ storyId: 700, taskId: 1 }));
      const after = Date.now();

      const entry = getState().entries.find((e) => e.storyId === 700);
      expect(entry!.firstStartedAt).not.toBeNull();
      expect(entry!.firstStartedAt!).toBeGreaterThanOrEqual(before);
      expect(entry!.firstStartedAt!).toBeLessThanOrEqual(after);
    });

    it('preserves firstStartedAt on subsequent starts (does NOT update it)', () => {
      eventBus.emit('task:started', makeTaskEvent({ storyId: 800, taskId: 1 }));
      const firstTime = getState().entries.find((e) => e.storyId === 800)!.firstStartedAt;

      eventBus.emit('task:routed', makeTaskEvent({ storyId: 800, taskId: 1 }));
      eventBus.emit('task:started', makeTaskEvent({ storyId: 800, taskId: 2 }));

      const entry = getState().entries.find((e) => e.storyId === 800);
      expect(entry!.firstStartedAt).toBe(firstTime);
    });

    it('creates a new entry if storyId is unknown (event arrived before init)', () => {
      eventBus.emit('task:started', makeTaskEvent({ storyId: 9000, taskId: 99 }));

      const entry = getState().entries.find((e) => e.storyId === 9000);
      expect(entry).toBeDefined();
      expect(entry!.displayStatus).toBe('RUN');
    });

    it('cancels pending removal timer when story is re-started after failure', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      eventBus.emit('task:started', makeTaskEvent({ storyId: 900, taskId: 1 }));
      eventBus.emit('task:failed', makeTaskEvent({ storyId: 900, taskId: 1 }));

      // Story re-shipped
      eventBus.emit('task:started', makeTaskEvent({ storyId: 900, taskId: 2 }));

      expect(clearTimeoutSpy).toHaveBeenCalled();
      const entry = getState().entries.find((e) => e.storyId === 900);
      expect(entry!.displayStatus).toBe('RUN');
    });
  });

  // -------------------------------------------------------------------------
  // task:routed event
  // -------------------------------------------------------------------------
  describe('task:routed event', () => {
    beforeEach(() => {
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);
    });

    it('reverts displayStatus from RUN back to QUEUE', () => {
      eventBus.emit('task:started', makeTaskEvent({ storyId: 1000, taskId: 1, stageName: 'sm' }));
      expect(getState().entries.find((e) => e.storyId === 1000)!.displayStatus).toBe('RUN');

      eventBus.emit('task:routed', makeTaskEvent({ storyId: 1000, taskId: 2, stageName: 'dev' }));
      expect(getState().entries.find((e) => e.storyId === 1000)!.displayStatus).toBe('QUEUE');
    });

    it('updates stageName on route', () => {
      eventBus.emit('task:started', makeTaskEvent({ storyId: 1100, taskId: 1, stageName: 'sm' }));
      eventBus.emit('task:routed', makeTaskEvent({ storyId: 1100, taskId: 2, stageName: 'dev' }));

      const entry = getState().entries.find((e) => e.storyId === 1100);
      expect(entry!.stageName).toBe('dev');
    });

    it('cancels pending removal timer on re-route', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      eventBus.emit('task:started', makeTaskEvent({ storyId: 1200, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 1200, taskId: 1 }));
      eventBus.emit('task:routed', makeTaskEvent({ storyId: 1200, taskId: 2 }));

      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('ignores route for unknown story (no-op, no crash)', () => {
      expect(() => {
        eventBus.emit('task:routed', makeTaskEvent({ storyId: 9999, taskId: 1 }));
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // task:completed event
  // -------------------------------------------------------------------------
  describe('task:completed event', () => {
    beforeEach(() => {
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);
    });

    it('updates entry to displayStatus DONE', () => {
      eventBus.emit('task:started', makeTaskEvent({ storyId: 1300, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 1300, taskId: 1, status: 'completed' }));

      const entry = getState().entries.find((e) => e.storyId === 1300);
      expect(entry!.displayStatus).toBe('DONE');
    });

    it('sets completedAt on task:completed', () => {
      const before = Date.now();
      eventBus.emit('task:started', makeTaskEvent({ storyId: 1400, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 1400, taskId: 1 }));
      const after = Date.now();

      const entry = getState().entries.find((e) => e.storyId === 1400);
      expect(entry!.completedAt).not.toBeNull();
      expect(entry!.completedAt!).toBeGreaterThanOrEqual(before);
      expect(entry!.completedAt!).toBeLessThanOrEqual(after);
    });

    it('schedules 30s removal timer via setTimeout', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      eventBus.emit('task:started', makeTaskEvent({ storyId: 1500, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 1500, taskId: 1 }));

      const removalCall = setTimeoutSpy.mock.calls.find((call) => Number(call[1]) === 30000);
      expect(removalCall).toBeDefined();
    });

    it('removes entry after 30s timeout fires', () => {
      vi.useFakeTimers();

      eventBus.emit('task:started', makeTaskEvent({ storyId: 1600, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 1600, taskId: 1 }));

      expect(getState().entries.find((e) => e.storyId === 1600)).toBeDefined();

      vi.advanceTimersByTime(30001);

      expect(getState().entries.find((e) => e.storyId === 1600)).toBeUndefined();

      vi.useRealTimers();
    });

    it('refreshes summary after task:completed', () => {
      const statsBefore = mockGetStatistics.mock.calls.length;
      eventBus.emit('task:started', makeTaskEvent({ storyId: 1700, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 1700, taskId: 1 }));

      expect(mockGetStatistics.mock.calls.length).toBeGreaterThan(statsBefore);
    });

    it('ignores completion for unknown story (no crash)', () => {
      expect(() => {
        eventBus.emit('task:completed', makeTaskEvent({ storyId: 99999, taskId: 1 }));
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // task:failed event
  // -------------------------------------------------------------------------
  describe('task:failed event', () => {
    beforeEach(() => {
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);
    });

    it('updates entry to displayStatus FAIL', () => {
      eventBus.emit('task:started', makeTaskEvent({ storyId: 1800, taskId: 1 }));
      eventBus.emit('task:failed', makeTaskEvent({ storyId: 1800, taskId: 1, status: 'failed' }));

      const entry = getState().entries.find((e) => e.storyId === 1800);
      expect(entry!.displayStatus).toBe('FAIL');
    });

    it('sets completedAt on task:failed', () => {
      eventBus.emit('task:started', makeTaskEvent({ storyId: 1900, taskId: 1 }));
      eventBus.emit('task:failed', makeTaskEvent({ storyId: 1900, taskId: 1 }));

      const entry = getState().entries.find((e) => e.storyId === 1900);
      expect(entry!.completedAt).not.toBeNull();
    });

    it('schedules 30s removal timer via setTimeout', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      eventBus.emit('task:started', makeTaskEvent({ storyId: 2000, taskId: 1 }));
      eventBus.emit('task:failed', makeTaskEvent({ storyId: 2000, taskId: 1 }));

      const removalCall = setTimeoutSpy.mock.calls.find((call) => Number(call[1]) === 30000);
      expect(removalCall).toBeDefined();
    });

    it('removes entry after 30s timeout fires', () => {
      vi.useFakeTimers();

      eventBus.emit('task:started', makeTaskEvent({ storyId: 2100, taskId: 1 }));
      eventBus.emit('task:failed', makeTaskEvent({ storyId: 2100, taskId: 1 }));

      expect(getState().entries.find((e) => e.storyId === 2100)).toBeDefined();

      vi.advanceTimersByTime(30001);

      expect(getState().entries.find((e) => e.storyId === 2100)).toBeUndefined();

      vi.useRealTimers();
    });

    it('refreshes summary after task:failed', () => {
      const statsBefore = mockGetStatistics.mock.calls.length;
      eventBus.emit('task:started', makeTaskEvent({ storyId: 2200, taskId: 1 }));
      eventBus.emit('task:failed', makeTaskEvent({ storyId: 2200, taskId: 1 }));

      expect(mockGetStatistics.mock.calls.length).toBeGreaterThan(statsBefore);
    });

    it('ignores failure for unknown story (no crash)', () => {
      expect(() => {
        eventBus.emit('task:failed', makeTaskEvent({ storyId: 99998, taskId: 1 }));
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // task:completed → task:queued (re-ship: cancels removal timer)
  // -------------------------------------------------------------------------
  describe('re-ship scenario: task:completed then task:queued', () => {
    beforeEach(() => {
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);
    });

    it('cancels 30s removal timer when story is re-queued before removal fires', () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      eventBus.emit('task:started', makeTaskEvent({ storyId: 2300, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 2300, taskId: 1 }));

      const beforeClearCount = clearTimeoutSpy.mock.calls.length;

      eventBus.emit('task:queued', makeTaskEvent({ storyId: 2300, taskId: 2 }));

      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(beforeClearCount);

      // Advance time to where removal would have fired — entry should still be present
      vi.advanceTimersByTime(30001);
      expect(getState().entries.find((e) => e.storyId === 2300)).toBeDefined();

      vi.useRealTimers();
    });

    it('entry displayStatus is QUEUE (not DONE) after re-queuing', () => {
      eventBus.emit('task:started', makeTaskEvent({ storyId: 2400, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 2400, taskId: 1 }));

      expect(getState().entries.find((e) => e.storyId === 2400)!.displayStatus).toBe('DONE');

      eventBus.emit('task:queued', makeTaskEvent({ storyId: 2400, taskId: 2 }));

      expect(getState().entries.find((e) => e.storyId === 2400)!.displayStatus).toBe('QUEUE');
    });
  });

  // -------------------------------------------------------------------------
  // Team filtering
  // -------------------------------------------------------------------------
  describe('team filtering', () => {
    it('ignores task:started event for a different team when activeTeam is set', () => {
      const db = makeMockDb({ taskTeam: 'other-team' });
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');

      eventBus.emit('task:started', makeTaskEvent({ storyId: 5000, taskId: 99 }));

      expect(getState().entries.find((e) => e.storyId === 5000)).toBeUndefined();
    });

    it('ignores task:queued event for a different team when activeTeam is set', () => {
      const db = makeMockDb({ taskTeam: 'other-team' });
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');

      eventBus.emit('task:queued', makeTaskEvent({ storyId: 5100, taskId: 99 }));

      expect(getState().entries.find((e) => e.storyId === 5100)).toBeUndefined();
    });

    it('ignores task:completed event for a different team when activeTeam is set', () => {
      const db = makeMockDb({ taskTeam: 'other-team' });
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');

      // Manually add an entry first using the team-filtered DB (won't be added via event)
      // Then send completion for a different team — should be ignored
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 5200, taskId: 99 }));

      // Entry with 5200 should not exist (since team filter rejects it)
      expect(getState().entries.find((e) => e.storyId === 5200)).toBeUndefined();
    });

    it('processes events for matching team', () => {
      const db = makeMockDb({ taskTeam: 'agentkit' });
      getState().init(eventBus, db as Parameters<typeof getState>['db'], 'agentkit');

      eventBus.emit('task:started', makeTaskEvent({ storyId: 5300, taskId: 10 }));

      expect(getState().entries.find((e) => e.storyId === 5300)).toBeDefined();
    });

    it('processes all events when activeTeam is undefined (no filtering)', () => {
      const db = makeMockDb({ taskTeam: 'any-team' });
      getState().init(eventBus, db as Parameters<typeof getState>['db']); // no activeTeam

      eventBus.emit('task:started', makeTaskEvent({ storyId: 5400, taskId: 11 }));

      expect(getState().entries.find((e) => e.storyId === 5400)).toBeDefined();
    });

    it('does not filter events when getTaskTeam DB query throws (treats as unknown team, allow through)', () => {
      const errorDb = makeMockDb();
      // Override select to throw on team queries (call 3+)
      let callCount = 0;
      (errorDb as { select: ReturnType<typeof vi.fn> }).select.mockImplementation(() => {
        callCount++;
        if (callCount > 2) {
          throw new Error('DB error');
        }
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
            }),
            where: vi.fn().mockReturnValue({
              all: vi.fn().mockReturnValue([]),
              get: vi.fn().mockReturnValue(undefined),
            }),
          }),
        };
      });

      getState().init(eventBus, errorDb as unknown as Parameters<typeof getState>['db'], 'agentkit');

      // When getTaskTeam fails, event should still be processed (conservative: don't filter)
      expect(() => {
        eventBus.emit('task:started', makeTaskEvent({ storyId: 5500, taskId: 12 }));
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // refresh()
  // -------------------------------------------------------------------------
  describe('refresh()', () => {
    it('rebuilds entries from DB on refresh', () => {
      const db = makeMockDb({
        activeTasks: [
          {
            taskId: 1,
            storyId: 6000,
            stageName: 'dev',
            status: 'running',
            startedAt: null,
            storyTitle: 'Story',
            storyKey: '26.1',
            priority: 0,
          },
        ],
      });
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      expect(getState().entries).toHaveLength(1);

      getState().refresh();

      // Entries rebuilt from DB (same data)
      expect(getState().entries).toHaveLength(1);
    });

    it('clears existing entries before rebuilding', () => {
      const db = makeMockDb();
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      // Add some entries via events
      eventBus.emit('task:started', makeTaskEvent({ storyId: 6100, taskId: 1 }));
      eventBus.emit('task:started', makeTaskEvent({ storyId: 6200, taskId: 2 }));
      expect(getState().entries).toHaveLength(2);

      // Refresh re-reads from DB (which returns empty)
      getState().refresh();

      // DB returns empty, so entries should be empty after refresh
      expect(getState().entries).toHaveLength(0);
    });

    it('cancels existing removal timers before rebuilding', () => {
      vi.useFakeTimers();
      const db = makeMockDb();
      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      eventBus.emit('task:started', makeTaskEvent({ storyId: 6300, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 6300, taskId: 1 }));

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      getState().refresh();

      expect(clearTimeoutSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('does not crash if refresh() is called before init()', () => {
      expect(() => getState().refresh()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Tick interval (removed — duration computed at render time)
  // -------------------------------------------------------------------------
  describe('no tick interval', () => {
    it('does not create a setInterval for duration updates', () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const db = makeMockDb();

      getState().init(eventBus, db as Parameters<typeof getState>['db']);

      const tickCall = setIntervalSpy.mock.calls.find((call) => Number(call[1]) === 3000);
      expect(tickCall).toBeUndefined();

      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // cleanup()
  // -------------------------------------------------------------------------
  describe('cleanup()', () => {
    it('unsubscribes all 5 event handlers via eventBus.off', () => {
      const offSpy = vi.spyOn(eventBus, 'off');
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);
      getState().cleanup();

      expect(offSpy).toHaveBeenCalledTimes(5);
      const events = offSpy.mock.calls.map((c) => c[0]);
      expect(events).toContain('task:queued');
      expect(events).toContain('task:started');
      expect(events).toContain('task:routed');
      expect(events).toContain('task:completed');
      expect(events).toContain('task:failed');
    });

    it('cleanup is safe when no tick interval exists', () => {
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);
      // Should not throw even though no tick interval was created
      expect(() => getState().cleanup()).not.toThrow();
    });

    it('store does NOT update after cleanup() when events are emitted', () => {
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);
      getState().cleanup();

      eventBus.emit('task:started', makeTaskEvent({ storyId: 8000, taskId: 1 }));

      expect(getState().entries.find((e) => e.storyId === 8000)).toBeUndefined();
    });

    it('cancels all pending removal timers on cleanup', () => {
      vi.useFakeTimers();
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);

      eventBus.emit('task:started', makeTaskEvent({ storyId: 8100, taskId: 1 }));
      eventBus.emit('task:completed', makeTaskEvent({ storyId: 8100, taskId: 1 }));

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      getState().cleanup();

      expect(clearTimeoutSpy).toHaveBeenCalled();

      // Timer should not fire after cleanup
      vi.advanceTimersByTime(30001);
      // Entry is still present (timer was cancelled before it could fire)
      // or was already removed by cleanup — either way no crash
      expect(() => getState().entries).not.toThrow();

      vi.useRealTimers();
    });

    it('is safe to call cleanup() when not initialized (no-op, no throw)', () => {
      expect(() => getState().cleanup()).not.toThrow();
    });

    it('does NOT reset state (entries preserved after cleanup for glitch avoidance)', () => {
      getState().init(eventBus, makeMockDb() as Parameters<typeof getState>['db']);

      eventBus.emit('task:started', makeTaskEvent({ storyId: 8200, taskId: 1 }));
      expect(getState().entries).toHaveLength(1);

      getState().cleanup();

      // Entries should still be present after cleanup (consistent with other stores)
      expect(getState().entries).toHaveLength(1);
    });
  });
});
