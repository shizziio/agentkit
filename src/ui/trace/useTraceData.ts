import { useState, useEffect, useCallback } from 'react';

import type { ITraceService, EpicNode, StoryNode, TaskNode, TraceTaskLog, TraceSummary } from '@core/TraceTypes.js';
import type { IResetService } from '@core/ResetTypes.js';

export interface TraceDataState {
  epics: EpicNode[];
  storiesByEpic: Map<number, StoryNode[]>;
  tasksByStory: Map<number, TaskNode[]>;
  summary: TraceSummary | null;
  error: string | null;
  isLoading: boolean;
  showSuperseded: boolean;
  teamFilter: string | null;
}

export interface TraceDataActions {
  loadStoriesForEpic: (epicId: number) => void;
  loadTasksForStory: (storyId: number) => void;
  getTaskLogs: (taskId: number) => TraceTaskLog[];
  refresh: () => void;
  markTaskDone: (storyId: number, taskId: number) => void;
  markStoryDone: (epicId: number, storyId: number) => void;
  deleteTask: (storyId: number, taskId: number) => void;
  retryTask: (storyId: number, taskId: number) => void;
  pushNextStage: (storyId: number, taskId: number) => void;
  toggleShowSuperseded: () => void;
  setTeamFilter: (v: string | null) => void;
}

const emptySummary: TraceSummary = {
  totalEpics: 0,
  totalStories: 0,
  totalTasks: 0,
  completionRate: 0,
  averageDurationPerStage: [],
};

export function useTraceData(
  traceService: ITraceService,
  resetService: IResetService,
  projectId: number,
  initialTeamFilter: string | null = null,
): TraceDataState & TraceDataActions {
  const [epics, setEpics] = useState<EpicNode[]>([]);
  const [storiesByEpic, setStoriesByEpic] = useState<Map<number, StoryNode[]>>(new Map());
  const [tasksByStory, setTasksByStory] = useState<Map<number, TaskNode[]>>(new Map());
  const [summary, setSummary] = useState<TraceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [teamFilter, setTeamFilterState] = useState<string | null>(initialTeamFilter ?? null);

  const loadEpics = useCallback(() => {
    try {
      setIsLoading(true);
      const epicList = traceService.getEpics(projectId);
      setEpics(epicList);
      const sum = traceService.getSummary(projectId);
      setSummary(sum);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSummary(emptySummary);
    } finally {
      setIsLoading(false);
    }
  }, [traceService, projectId]);

  useEffect(() => {
    loadEpics();
  }, [loadEpics]);

  const loadStoriesForEpic = useCallback(
    (epicId: number) => {
      try {
        const storyList = traceService.getStoriesForEpic(epicId);
        setStoriesByEpic((prev) => {
          const next = new Map(prev);
          next.set(epicId, storyList);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [traceService],
  );

  const loadTasksForStory = useCallback(
    (storyId: number) => {
      try {
        const taskList = traceService.getTasksForStory(storyId, showSuperseded, teamFilter ?? undefined);
        setTasksByStory((prev) => {
          const next = new Map(prev);
          next.set(storyId, taskList);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [traceService, showSuperseded, teamFilter],
  );

  const getTaskLogs = useCallback(
    (taskId: number): TraceTaskLog[] => {
      try {
        return traceService.getTaskLogs(taskId);
      } catch {
        return [];
      }
    },
    [traceService],
  );

  const refresh = useCallback(() => {
    // Clear cached children so they are reloaded when expanded
    setStoriesByEpic(new Map());
    setTasksByStory(new Map());
    loadEpics();
  }, [loadEpics]);

  const markTaskDone = useCallback(
    (storyId: number, taskId: number) => {
      try {
        traceService.markTaskDone(taskId);
        loadTasksForStory(storyId);
        loadEpics();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [traceService, loadTasksForStory, loadEpics]
  );

  const markStoryDone = useCallback(
    (epicId: number, storyId: number) => {
      try {
        traceService.markStoryDone(storyId);
        loadStoriesForEpic(epicId);
        if (tasksByStory.has(storyId)) {
          loadTasksForStory(storyId);
        }
        loadEpics();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [traceService, loadStoriesForEpic, tasksByStory, loadTasksForStory, loadEpics]
  );

  const deleteTask = useCallback(
    (storyId: number, taskId: number) => {
      try {
        resetService.deleteTask(taskId);
        loadTasksForStory(storyId);
        loadEpics();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [resetService, loadTasksForStory, loadEpics]
  );

  const retryTask = useCallback(
    (storyId: number, taskId: number) => {
      try {
        resetService.retryTask(taskId);
        loadTasksForStory(storyId);
        loadEpics();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [resetService, loadTasksForStory, loadEpics]
  );

  const pushNextStage = useCallback(
    (storyId: number, taskId: number) => {
      try {
        resetService.pushNextStage(taskId);
        loadTasksForStory(storyId);
        loadEpics();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [resetService, loadTasksForStory, loadEpics]
  );

  const toggleShowSuperseded = useCallback(() => {
    const newVal = !showSuperseded;
    setShowSuperseded(newVal);
    for (const storyId of tasksByStory.keys()) {
      try {
        const taskList = traceService.getTasksForStory(storyId, newVal, teamFilter ?? undefined);
        setTasksByStory((prev) => {
          const next = new Map(prev);
          next.set(storyId, taskList);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [showSuperseded, traceService, tasksByStory, teamFilter]);

  const setTeamFilter = useCallback((v: string | null) => {
    if (v === teamFilter) return;
    setTeamFilterState(v);
    for (const storyId of tasksByStory.keys()) {
      try {
        const taskList = traceService.getTasksForStory(storyId, showSuperseded, v ?? undefined);
        setTasksByStory((prev) => {
          const next = new Map(prev);
          next.set(storyId, taskList);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [teamFilter, tasksByStory, traceService, showSuperseded]);

  return {
    epics,
    storiesByEpic,
    tasksByStory,
    summary,
    error,
    isLoading,
    showSuperseded,
    teamFilter,
    loadStoriesForEpic,
    loadTasksForStory,
    getTaskLogs,
    refresh,
    markTaskDone,
    markStoryDone,
    deleteTask,
    retryTask,
    pushNextStage,
    toggleShowSuperseded,
    setTeamFilter,
  };
}
