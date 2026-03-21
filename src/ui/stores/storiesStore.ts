import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { eq, or, and } from 'drizzle-orm';

import type { EventBus } from '@core/EventBus.js';
import type { DrizzleDB } from '@core/db/Connection.js';
import type { TaskEvent } from '@core/EventTypes.js';
import { tasks, stories } from '@core/db/schema.js';
import { StateManager } from '@core/StateManager.js';
import type {
  ActiveStoryEntry,
  ActiveStoriesSummary,
} from '../dashboard/active-stories/ActiveStoriesTypes.js';

export interface StoriesStore {
  entries: ActiveStoryEntry[];
  summary: ActiveStoriesSummary;
  init: (eventBus: EventBus, db: DrizzleDB, activeTeam?: string) => void;
  cleanup: () => void;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Module-level closure variables (NOT store state) — survive setState resets
// ---------------------------------------------------------------------------
let _eventBus: EventBus | null = null;
let _db: DrizzleDB | null = null;
let _activeTeam: string | undefined = undefined;
let _storiesMap: Map<number, ActiveStoryEntry> = new Map();
let _removalTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
let _tickInterval: ReturnType<typeof setInterval> | null = null;
let _onQueued: ((e: TaskEvent) => void) | null = null;
let _onStarted: ((e: TaskEvent) => void) | null = null;
let _onRouted: ((e: TaskEvent) => void) | null = null;
let _onCompleted: ((e: TaskEvent) => void) | null = null;
let _onFailed: ((e: TaskEvent) => void) | null = null;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------
function sortedEntries(): ActiveStoryEntry[] {
  const arr = Array.from(_storiesMap.values());
  return arr.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.storyId - b.storyId;
  });
}

function flushEntries(set: (partial: Partial<StoriesStore>) => void): void {
  set({ entries: sortedEntries() });
}

function loadSummary(
  set: (partial: Partial<StoriesStore>) => void,
  db: DrizzleDB,
  activeTeam: string,
): void {
  try {
    const stateManager = new StateManager(db, activeTeam);
    const stats = stateManager.getStatistics();
    const allAvgs = stats.averageDurationPerStage
      .map((s) => s.averageDurationMs)
      .filter((ms): ms is number => ms !== null);
    const avgMs =
      allAvgs.length > 0 ? allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length : null;
    set({
      summary: {
        doneTodayCount: stats.doneTodayCount,
        failedCount: stats.failedCount,
        averageDurationMs: avgMs,
      },
    });
  } catch {
    // ignore stats errors
  }
}

function cancelRemoval(storyId: number): void {
  const timer = _removalTimers.get(storyId);
  if (timer !== undefined) {
    clearTimeout(timer);
    _removalTimers.delete(storyId);
  }
}

function scheduleRemoval(
  storyId: number,
  set: (partial: Partial<StoriesStore>) => void,
): void {
  cancelRemoval(storyId);
  const timer = setTimeout(() => {
    _storiesMap.delete(storyId);
    _removalTimers.delete(storyId);
    flushEntries(set);
  }, 30000);
  _removalTimers.set(storyId, timer);
}

function getTaskTeam(db: DrizzleDB, taskId: number): string | null {
  try {
    const task = db
      .select({ team: tasks.team })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    return task?.team ?? null;
  } catch {
    return null; // DB error → allow through (conservative)
  }
}

function getStoryInfo(
  db: DrizzleDB,
  storyId: number,
): { title: string; storyKey: string } {
  try {
    const story = db
      .select({ title: stories.title, storyKey: stories.storyKey })
      .from(stories)
      .where(eq(stories.id, storyId))
      .get();
    return { title: story?.title ?? `Story #${storyId}`, storyKey: story?.storyKey ?? '' };
  } catch {
    return { title: `Story #${storyId}`, storyKey: '' };
  }
}

function getStoryPriority(db: DrizzleDB, storyId: number): number {
  try {
    const story = db
      .select({ priority: stories.priority })
      .from(stories)
      .where(eq(stories.id, storyId))
      .get();
    return story?.priority ?? 0;
  } catch {
    return 0;
  }
}

function shouldFilter(db: DrizzleDB, taskId: number, activeTeam: string | undefined): boolean {
  if (activeTeam === undefined) return false;
  const team = getTaskTeam(db, taskId);
  return team !== null && team !== activeTeam;
}

function loadInitialData(
  set: (partial: Partial<StoriesStore>) => void,
  db: DrizzleDB,
  activeTeam: string | undefined,
): void {
  try {
    // Load active tasks (queued + running) with story info via JOIN
    const statusClause = or(eq(tasks.status, 'queued'), eq(tasks.status, 'running'));
    const whereClause = activeTeam
      ? and(statusClause, eq(tasks.team, activeTeam))
      : statusClause;

    const activeTasks = db
      .select({
        taskId: tasks.id,
        storyId: tasks.storyId,
        stageName: tasks.stageName,
        status: tasks.status,
        startedAt: tasks.startedAt,
        storyTitle: stories.title,
        storyKey: stories.storyKey,
        priority: stories.priority,
        team: tasks.team,
      })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .where(whereClause)
      .all();

    // Deduplicate by storyId, prefer running over queued
    const byStory = new Map<number, (typeof activeTasks)[0]>();
    for (const task of activeTasks) {
      const existing = byStory.get(task.storyId);
      if (!existing || task.status === 'running') {
        byStory.set(task.storyId, task);
      }
    }

    for (const [storyId, task] of byStory) {
      _storiesMap.set(storyId, {
        storyId,
        storyKey: task.storyKey,
        storyTitle: task.storyTitle,
        stageName: task.stageName,
        displayStatus: task.status === 'running' ? 'RUN' : 'QUEUE',
        firstStartedAt: task.startedAt ? new Date(task.startedAt).getTime() : null,
        completedAt: null,
        priority: task.priority ?? 0,
        dependsOn: [],
        depStatuses: {},
        team: task.team,
      });
    }

    // Load waiting stories (no active tasks, so the JOIN above misses them)
    const waitingStories = db
      .select({
        id: stories.id,
        storyKey: stories.storyKey,
        title: stories.title,
        priority: stories.priority,
        dependsOn: stories.dependsOn,
        epicId: stories.epicId,
      })
      .from(stories)
      .where(eq(stories.status, 'waiting'))
      .all();

    for (const ws of waitingStories) {
      if (_storiesMap.has(ws.id)) continue;

      let deps: string[] = [];
      try {
        const parsed = JSON.parse(ws.dependsOn ?? '[]') as unknown;
        if (Array.isArray(parsed)) deps = parsed as string[];
      } catch { /* ignore malformed JSON */ }

      const depStatuses: Record<string, string> = {};
      if (deps.length > 0) {
        const epicStories = db
          .select({ storyKey: stories.storyKey, status: stories.status })
          .from(stories)
          .where(eq(stories.epicId, ws.epicId))
          .all();
        for (const es of epicStories) {
          if (deps.includes(es.storyKey)) {
            depStatuses[es.storyKey] = es.status;
          }
        }
      }

      _storiesMap.set(ws.id, {
        storyId: ws.id,
        storyKey: ws.storyKey,
        storyTitle: ws.title,
        stageName: '-',
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        priority: ws.priority ?? 0,
        dependsOn: deps,
        depStatuses,
      });
    }

    flushEntries(set);
  } catch {
    // ignore DB init errors
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
const _store = create<StoriesStore>()(
  subscribeWithSelector((set, get) => ({
    entries: [],
    summary: { doneTodayCount: 0, failedCount: 0, averageDurationMs: null },

    init(eventBus: EventBus, db: DrizzleDB, activeTeam?: string): void {
      // Call cleanup first to prevent double-subscribing
      get().cleanup();

      _eventBus = eventBus;
      _db = db;
      _activeTeam = activeTeam;

      // Load initial data from DB
      loadInitialData(set, db, activeTeam);

      // Load summary only when activeTeam is provided (matches hook behavior)
      if (activeTeam !== undefined) {
        loadSummary(set, db, activeTeam);
      }

      // Define and register event handlers
      _onQueued = (event: TaskEvent): void => {
        if (!_db) return;
        if (shouldFilter(_db, event.taskId, _activeTeam)) return;
        const { storyId, stageName } = event;
        cancelRemoval(storyId);
        const existing = _storiesMap.get(storyId);
        // If story is already running, preserve RUN status (don't downgrade to QUEUE)
        if (existing?.displayStatus === 'RUN') return;
        if (!existing) {
          const info = getStoryInfo(_db, storyId);
          _storiesMap.set(storyId, {
            storyId,
            storyKey: info.storyKey,
            storyTitle: info.title,
            stageName,
            displayStatus: 'QUEUE',
            firstStartedAt: null,
            completedAt: null,
            priority: getStoryPriority(_db, storyId),
            dependsOn: [],
            depStatuses: {},
          });
        } else {
          _storiesMap.set(storyId, {
            ...existing,
            stageName,
            displayStatus: 'QUEUE',
            completedAt: null,
          });
        }
        flushEntries(set);
      };

      _onStarted = (event: TaskEvent): void => {
        if (!_db) return;
        if (shouldFilter(_db, event.taskId, _activeTeam)) return;
        const { storyId, stageName } = event;
        cancelRemoval(storyId);
        const existing = _storiesMap.get(storyId);
        const info = existing ? null : getStoryInfo(_db, storyId);
        _storiesMap.set(storyId, {
          storyId,
          storyKey: existing?.storyKey ?? info?.storyKey ?? '',
          storyTitle: existing?.storyTitle ?? info?.title ?? `Story #${storyId}`,
          stageName,
          displayStatus: 'RUN',
          firstStartedAt: existing?.firstStartedAt ?? Date.now(),
          completedAt: null,
          priority: existing?.priority ?? 0,
          dependsOn: existing?.dependsOn ?? [],
          depStatuses: existing?.depStatuses ?? {},
        });
        flushEntries(set);
      };

      _onRouted = (event: TaskEvent): void => {
        if (!_db) return;
        if (shouldFilter(_db, event.taskId, _activeTeam)) return;
        const { storyId, stageName } = event;
        cancelRemoval(storyId);
        const existing = _storiesMap.get(storyId);
        if (existing) {
          _storiesMap.set(storyId, { ...existing, stageName, displayStatus: 'QUEUE' });
          flushEntries(set);
        }
      };

      _onCompleted = (event: TaskEvent): void => {
        if (!_db) return;
        if (shouldFilter(_db, event.taskId, _activeTeam)) return;
        const { storyId } = event;
        const existing = _storiesMap.get(storyId);
        if (existing) {
          _storiesMap.set(storyId, {
            ...existing,
            displayStatus: 'DONE',
            completedAt: Date.now(),
          });
          flushEntries(set);
          scheduleRemoval(storyId, set);
        }
        loadSummary(set, _db, _activeTeam ?? '');
      };

      _onFailed = (event: TaskEvent): void => {
        if (!_db) return;
        if (shouldFilter(_db, event.taskId, _activeTeam)) return;
        const { storyId } = event;
        const existing = _storiesMap.get(storyId);
        if (existing) {
          _storiesMap.set(storyId, {
            ...existing,
            displayStatus: 'FAIL',
            completedAt: Date.now(),
          });
          flushEntries(set);
          scheduleRemoval(storyId, set);
        }
        loadSummary(set, _db, _activeTeam ?? '');
      };

      eventBus.on('task:queued', _onQueued);
      eventBus.on('task:started', _onStarted);
      eventBus.on('task:routed', _onRouted);
      eventBus.on('task:completed', _onCompleted);
      eventBus.on('task:failed', _onFailed);

      // 3s tick interval: force entries reference update so consumers re-render
      // running durations without needing separate state
      _tickInterval = setInterval(() => {
        set({ entries: sortedEntries() });
      }, 3000);
    },

    cleanup(): void {
      if (_eventBus) {
        if (_onQueued) _eventBus.off('task:queued', _onQueued);
        if (_onStarted) _eventBus.off('task:started', _onStarted);
        if (_onRouted) _eventBus.off('task:routed', _onRouted);
        if (_onCompleted) _eventBus.off('task:completed', _onCompleted);
        if (_onFailed) _eventBus.off('task:failed', _onFailed);
        _eventBus = null;
      }
      _onQueued = null;
      _onStarted = null;
      _onRouted = null;
      _onCompleted = null;
      _onFailed = null;
      _db = null;
      _activeTeam = undefined;
      if (_tickInterval !== null) {
        clearInterval(_tickInterval);
        _tickInterval = null;
      }
      for (const timer of _removalTimers.values()) {
        clearTimeout(timer);
      }
      _removalTimers.clear();
      // Clear internal stories map so next init() starts fresh
      _storiesMap.clear();
    },

    refresh(): void {
      if (!_db) return;
      // Cancel all removal timers before rebuilding
      for (const timer of _removalTimers.values()) {
        clearTimeout(timer);
      }
      _removalTimers.clear();
      _storiesMap.clear();
      loadInitialData(set, _db, _activeTeam);
    },
  })),
);

// Patch external setState to always merge (never replace), preserving action functions.
const _origSetState = _store.setState;
_store.setState = (partial, _replace) => {
  const resolved =
    typeof partial === 'function' ? partial(_store.getState()) : partial;
  _origSetState(resolved);
};

export const useStoriesStore = _store;
