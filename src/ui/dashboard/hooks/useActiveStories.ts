import { useState, useEffect, useRef } from 'react';
import { eq, or, and } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import type { EventBus } from '@core/EventBus.js';
import type { TaskEvent } from '@core/EventTypes.js';
import { tasks, stories } from '@core/db/schema.js';
import { StateManager } from '@core/StateManager.js';

import type {
  ActiveStoryEntry,
  ActiveStoriesSummary,
  UseActiveStoriesResult,
} from '../active-stories/ActiveStoriesTypes.js';

export function useActiveStories(db: DrizzleDB, eventBus: EventBus, refreshKey?: number, activeTeam?: string): UseActiveStoriesResult {
  const storiesMap = useRef<Map<number, ActiveStoryEntry>>(new Map());
  const removalTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const hasRunningRef = useRef(false);

  const [entries, setEntries] = useState<ActiveStoryEntry[]>([]);
  const [summary, setSummary] = useState<ActiveStoriesSummary>({
    doneTodayCount: 0,
    failedCount: 0,
    averageDurationMs: null,
  });
  const [, setTick] = useState(0);

  useEffect(() => {
    const map = storiesMap.current;
    const timers = removalTimers.current;

    const refreshSummary = (): void => {
      if (!activeTeam) return;
      const stateManager = new StateManager(db, activeTeam);
      const stats = stateManager.getStatistics();
      const allAvgs = stats.averageDurationPerStage
        .map((s) => s.averageDurationMs)
        .filter((ms): ms is number => ms !== null);
      const avgMs =
        allAvgs.length > 0 ? allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length : null;
      setSummary({
        doneTodayCount: stats.doneTodayCount,
        failedCount: stats.failedCount,
        averageDurationMs: avgMs,
      });
    };

    const getStoryInfo2 = (storyId: number): { title: string; storyKey: string } => {
      try {
        const story = db.select({ title: stories.title, storyKey: stories.storyKey }).from(stories).where(eq(stories.id, storyId)).get();
        return { title: story?.title ?? `Story #${storyId}`, storyKey: story?.storyKey ?? '' };
      } catch {
        return { title: `Story #${storyId}`, storyKey: '' };
      }
    };

    const getStoryPriority = (storyId: number): number => {
      try {
        const story = db.select({ priority: stories.priority }).from(stories).where(eq(stories.id, storyId)).get();
        return story?.priority ?? 0;
      } catch {
        return 0;
      }
    };

    const getTaskTeam = (taskId: number): string => {
      try {
        const task = db.select({ team: tasks.team }).from(tasks).where(eq(tasks.id, taskId)).get();
        return task?.team ?? '';
      } catch {
        return '';
      }
    };

    const updateEntries = (): void => {
      const arr = Array.from(map.values());
      hasRunningRef.current = arr.some(e => e.displayStatus === 'RUN');
      setEntries(arr);
    };

    const scheduleRemoval = (storyId: number): void => {
      const existingTimer = timers.get(storyId);
      if (existingTimer !== undefined) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        map.delete(storyId);
        timers.delete(storyId);
        updateEntries();
      }, 30000);
      timers.set(storyId, timer);
    };

    const cancelRemoval = (storyId: number): void => {
      const existingTimer = timers.get(storyId);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
        timers.delete(storyId);
      }
    };

    // Clear stale entries on refresh (when refreshKey changes after modal close)
    map.clear();

    // Initialize from DB — filter by activeTeam when provided
    try {
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
        map.set(storyId, {
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
        });
      }

      // Load waiting stories (they have no tasks, so the JOIN above misses them)
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
        if (map.has(ws.id)) continue;
        let deps: string[] = [];
        try {
          const parsed = JSON.parse(ws.dependsOn ?? '[]') as unknown;
          if (Array.isArray(parsed)) deps = parsed as string[];
        } catch { /* ignore */ }

        // Lookup dep statuses within same epic
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

        map.set(ws.id, {
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

      const initArr = Array.from(map.values());
      hasRunningRef.current = initArr.some(e => e.displayStatus === 'RUN');
      setEntries(initArr);
    } catch {
      // ignore DB init errors
    }

    refreshSummary();

    const onTaskQueued = (event: TaskEvent): void => {
      if (activeTeam !== undefined && getTaskTeam(event.taskId) !== activeTeam) return;
      const { storyId, stageName } = event;
      cancelRemoval(storyId);
      if (!map.has(storyId)) {
        const info = getStoryInfo2(storyId);
        map.set(storyId, {
          storyId,
          storyKey: info.storyKey,
          storyTitle: info.title,
          stageName,
          displayStatus: 'QUEUE',
          firstStartedAt: null,
          completedAt: null,
          priority: getStoryPriority(storyId),
          dependsOn: [],
          depStatuses: {},
        });
        updateEntries();
      }
    };

    const onTaskStarted = (event: TaskEvent): void => {
      if (activeTeam !== undefined && getTaskTeam(event.taskId) !== activeTeam) return;
      const { storyId, stageName } = event;
      cancelRemoval(storyId);
      const existing = map.get(storyId);
      const info = existing ? null : getStoryInfo2(storyId);
      map.set(storyId, {
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
      updateEntries();
    };

    const onTaskRouted = (event: TaskEvent): void => {
      if (activeTeam !== undefined && getTaskTeam(event.taskId) !== activeTeam) return;
      const { storyId, stageName } = event;
      cancelRemoval(storyId);
      const existing = map.get(storyId);
      if (existing) {
        map.set(storyId, { ...existing, stageName, displayStatus: 'QUEUE' });
        updateEntries();
      }
    };

    const onTaskCompleted = (event: TaskEvent): void => {
      if (activeTeam !== undefined && getTaskTeam(event.taskId) !== activeTeam) return;
      const { storyId } = event;
      const existing = map.get(storyId);
      if (existing) {
        map.set(storyId, { ...existing, displayStatus: 'DONE', completedAt: Date.now() });
        updateEntries();
        scheduleRemoval(storyId);
      }
      refreshSummary();
    };

    const onTaskFailed = (event: TaskEvent): void => {
      if (activeTeam !== undefined && getTaskTeam(event.taskId) !== activeTeam) return;
      const { storyId } = event;
      const existing = map.get(storyId);
      if (existing) {
        map.set(storyId, { ...existing, displayStatus: 'FAIL', completedAt: Date.now() });
        updateEntries();
        scheduleRemoval(storyId);
      }
      refreshSummary();
    };

    eventBus.on('task:queued', onTaskQueued);
    eventBus.on('task:started', onTaskStarted);
    eventBus.on('task:routed', onTaskRouted);
    eventBus.on('task:completed', onTaskCompleted);
    eventBus.on('task:failed', onTaskFailed);

    const tickInterval = setInterval(() => {
      if (hasRunningRef.current) {
        setTick((t) => t + 1);
      }
    }, 3000);

    return () => {
      eventBus.off('task:queued', onTaskQueued);
      eventBus.off('task:started', onTaskStarted);
      eventBus.off('task:routed', onTaskRouted);
      eventBus.off('task:completed', onTaskCompleted);
      eventBus.off('task:failed', onTaskFailed);
      clearInterval(tickInterval);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [db, eventBus, refreshKey, activeTeam]);

  return { entries, summary };
}
