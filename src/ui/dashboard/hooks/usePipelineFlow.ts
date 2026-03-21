import { useEffect, useReducer, useRef } from 'react';

import type { StageConfig } from '@core/ConfigTypes.js';
import type { EventBus } from '@core/EventBus.js';
import type { WorkerEvent, QueueEvent } from '@core/EventTypes.js';
import type { DrizzleDB } from '@core/db/Connection.js';
import { StateManager } from '@core/StateManager.js';
import type { StageFlowState } from '../pipeline-flow/PipelineFlowTypes.js';

interface FlowState {
  stages: StageFlowState[];
  busyWorkers: Map<string, Set<string>>;
}

type FlowAction =
  | { type: 'WORKER_BUSY'; stageName: string; workerId: string }
  | { type: 'WORKER_IDLE'; stageName: string; workerId: string }
  | { type: 'QUEUE_UPDATED'; stageName: string; queuedCount: number };

function reducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'WORKER_BUSY': {
      const newBusy = new Map(state.busyWorkers);
      const set = new Set(newBusy.get(action.stageName) ?? []);
      set.add(action.workerId);
      newBusy.set(action.stageName, set);
      return {
        ...state,
        busyWorkers: newBusy,
        stages: state.stages.map((s) =>
          s.stageName === action.stageName ? { ...s, status: 'busy' as const } : s,
        ),
      };
    }
    case 'WORKER_IDLE': {
      const newBusy = new Map(state.busyWorkers);
      const set = new Set(newBusy.get(action.stageName) ?? []);
      set.delete(action.workerId);
      newBusy.set(action.stageName, set);
      const isIdle = set.size === 0;
      return {
        ...state,
        busyWorkers: newBusy,
        stages: state.stages.map((s) =>
          s.stageName === action.stageName
            ? { ...s, status: isIdle ? ('idle' as const) : ('busy' as const) }
            : s,
        ),
      };
    }
    case 'QUEUE_UPDATED': {
      return {
        ...state,
        stages: state.stages.map((s) =>
          s.stageName === action.stageName ? { ...s, queuedCount: action.queuedCount } : s,
        ),
      };
    }
  }
}

function buildInitialState(
  stages: StageConfig[],
  depths: Record<string, number>,
  durations: Record<string, number | null>,
): FlowState {
  return {
    stages: stages.map((s) => ({
      stageName: s.name,
      displayName: s.displayName,
      icon: s.icon,
      status: 'idle' as const,
      queuedCount: depths[s.name] ?? 0,
      estimatedTimeMs: durations[s.name] ?? null,
    })),
    busyWorkers: new Map(),
  };
}

function computeEstimates(
  stages: StageFlowState[],
  avgDurations: Record<string, number | null>,
): StageFlowState[] {
  return stages.map((s) => {
    const avg = avgDurations[s.stageName] ?? null;
    if (avg === null || s.queuedCount === 0) {
      return { ...s, estimatedTimeMs: null };
    }
    return { ...s, estimatedTimeMs: s.queuedCount * avg };
  });
}

function loadDurations(db: DrizzleDB, activeTeam: string): Record<string, number | null> {
  const stateManager = new StateManager(db, activeTeam);
  const stats = stateManager.getStatistics();
  const durations: Record<string, number | null> = {};
  for (const s of stats.averageDurationPerStage) {
    durations[s.stageName] = s.averageDurationMs;
  }
  return durations;
}

function loadQueueDepths(db: DrizzleDB, activeTeam: string): Record<string, number> {
  const stateManager = new StateManager(db, activeTeam);
  return stateManager.getQueueDepthByStage();
}

export function usePipelineFlow(
  stages: StageConfig[],
  eventBus: EventBus | undefined,
  db: DrizzleDB | undefined,
  activeTeam: string,
): StageFlowState[] {
  const initializedRef = useRef(false);
  const avgDurationsRef = useRef<Record<string, number | null>>({});

  if (!initializedRef.current && db) {
    avgDurationsRef.current = loadDurations(db, activeTeam);
    initializedRef.current = true;
  }

  const [state, dispatch] = useReducer(
    reducer,
    { stages, depths: db ? loadQueueDepths(db, activeTeam) : {}, durations: avgDurationsRef.current },
    (init) => buildInitialState(init.stages, init.depths, init.durations),
  );

  useEffect(() => {
    if (!eventBus) return;

    const onBusy = (event: WorkerEvent): void => {
      dispatch({ type: 'WORKER_BUSY', stageName: event.stageName, workerId: event.workerId });
    };
    const onIdle = (event: WorkerEvent): void => {
      dispatch({ type: 'WORKER_IDLE', stageName: event.stageName, workerId: event.workerId });
    };
    const onQueueUpdated = (event: QueueEvent): void => {
      if (event.stageName === undefined) return;
      dispatch({
        type: 'QUEUE_UPDATED',
        stageName: event.stageName,
        queuedCount: event.queuedCount ?? 0,
      });
    };

    eventBus.on('worker:busy', onBusy);
    eventBus.on('worker:idle', onIdle);
    eventBus.on('queue:updated', onQueueUpdated);

    return () => {
      eventBus.off('worker:busy', onBusy);
      eventBus.off('worker:idle', onIdle);
      eventBus.off('queue:updated', onQueueUpdated);
    };
  }, [eventBus, db]);

  return computeEstimates(state.stages, avgDurationsRef.current);
}
