import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import type { EventBus } from '@core/EventBus.js';
import type { TaskEvent } from '@core/EventTypes.js';
import { Logger } from '@core/Logger.js';
import type { CrewState, RobotEntry, RobotState } from '../crew/CrewTypes.js';

const logger = Logger.getOrNoop('useCrewState');

/**
 * Derives a short display name for a stage.
 * Reuses the logic from useWorkerStatus for consistency.
 */
function deriveDisplayName(stageName: string): string {
  const base = stageName.replace(/-worker$/, '');
  if (base.length <= 2) return base.toUpperCase();
  const first3 = base.slice(0, 3);
  return first3.charAt(0).toUpperCase() + first3.slice(1).toLowerCase();
}

/**
 * Module-level cache of worker states so remounting (e.g. after menu navigation)
 * restores the last known state instead of resetting to all-idle.
 */
const cachedWorkerStates = new Map<string, RobotState>();

/**
 * Hook to manage the state and animations of the ASCII robot crew based on EventBus events.
 * 
 * AC1: Initial state all idle
 * AC2: task:started → running
 * AC3: task:completed → done → idle (3s delay)
 * AC4: task:failed → error → idle (5s delay)
 * AC5: Blink animation (800ms toggle for running robots)
 * AC6: Orchestrator mirrors worker activity (running if any worker running or queued)
 * AC7: Cleanup all event listeners and timers on unmount
 */
export function useCrewState(eventBus: EventBus, stages: string[]): CrewState {
  const [workers, setWorkers] = useState<RobotEntry[]>(() =>
    stages.map((name) => ({
      name,
      displayName: deriveDisplayName(name),
      state: cachedWorkerStates.get(name) ?? 'idle' as RobotState,
      blinkPhase: false,
    }))
  );

  const [globalBlinkPhase, setGlobalBlinkPhase] = useState(false);

  // Timeouts for transitioning from done/error to idle
  const idleTimeouts = useRef<Record<string, NodeJS.Timeout>>({});
  
  // Track which stage a story is currently running on to handle routing source
  const storySourceStages = useRef<Record<number, string>>({});

  const clearIdleTimeout = (stageName: string) => {
    if (idleTimeouts.current[stageName]) {
      clearTimeout(idleTimeouts.current[stageName]);
      delete idleTimeouts.current[stageName];
    }
  };

  const updateWorkerState = (stageName: string, newState: RobotState) => {
    cachedWorkerStates.set(stageName, newState);
    setWorkers((prev) =>
      prev.map((w) => (w.name === stageName ? { ...w, state: newState } : w))
    );
  };

  // Sync workers if stages change (e.g. dynamic pipeline)
  useEffect(() => {
    setWorkers((prev) => {
      const newWorkers = stages.map((name) => {
        const existing = prev.find((w) => w.name === name);
        if (existing) return existing;
        return {
          name,
          displayName: deriveDisplayName(name),
          state: 'idle' as RobotState,
          blinkPhase: false,
        };
      });
      return newWorkers;
    });
  }, [stages]);

  useLayoutEffect(() => {
    const onTaskQueued = (event: TaskEvent) => {
      logger.debug('crew: task queued', { stageName: event.stageName, taskId: event.taskId });
      clearIdleTimeout(event.stageName);
      updateWorkerState(event.stageName, 'queued');
    };

    const onTaskStarted = (event: TaskEvent) => {
      logger.debug('crew: task started', { stageName: event.stageName, taskId: event.taskId });
      storySourceStages.current[event.storyId] = event.stageName;
      clearIdleTimeout(event.stageName);
      updateWorkerState(event.stageName, 'running');
    };

    const onTaskCompleted = (event: TaskEvent) => {
      const { stageName } = event;
      logger.debug('crew: task completed', { stageName, taskId: event.taskId });
      updateWorkerState(stageName, 'done');
      clearIdleTimeout(stageName);
      idleTimeouts.current[stageName] = setTimeout(() => {
        updateWorkerState(stageName, 'idle');
        delete idleTimeouts.current[stageName];
      }, 3000);
    };

    const onTaskFailed = (event: TaskEvent) => {
      const { stageName } = event;
      logger.debug('crew: task failed', { stageName, taskId: event.taskId });
      updateWorkerState(stageName, 'error');
      clearIdleTimeout(stageName);
      idleTimeouts.current[stageName] = setTimeout(() => {
        updateWorkerState(stageName, 'idle');
        delete idleTimeouts.current[stageName];
      }, 5000);
    };

    const onTaskRouted = (event: TaskEvent) => {
      const { storyId, stageName: targetStage } = event;
      let sourceStage = storySourceStages.current[storyId];

      // Fallback: if we don't have the source tracked, assume it's the previous stage in the list
      if (!sourceStage) {
        const targetIdx = stages.indexOf(targetStage);
        if (targetIdx > 0) {
          sourceStage = stages[targetIdx - 1];
        }
      }

      logger.debug('crew: task routed', { sourceStage, targetStage, storyId });

      if (sourceStage) {
        updateWorkerState(sourceStage, 'done');
        clearIdleTimeout(sourceStage);
        idleTimeouts.current[sourceStage] = setTimeout(() => {
          updateWorkerState(sourceStage, 'idle');
          delete idleTimeouts.current[sourceStage];
        }, 3000);
      }

      clearIdleTimeout(targetStage);
      updateWorkerState(targetStage, 'queued');
      
      // Update the tracked stage for this story
      storySourceStages.current[storyId] = targetStage;
    };

    eventBus.on('task:queued', onTaskQueued);
    eventBus.on('task:started', onTaskStarted);
    eventBus.on('task:completed', onTaskCompleted);
    eventBus.on('task:failed', onTaskFailed);
    eventBus.on('task:routed', onTaskRouted);

    return () => {
      eventBus.off('task:queued', onTaskQueued);
      eventBus.off('task:started', onTaskStarted);
      eventBus.off('task:completed', onTaskCompleted);
      eventBus.off('task:failed', onTaskFailed);
      eventBus.off('task:routed', onTaskRouted);
      
      // Exhaustive cleanup of all timers
      Object.values(idleTimeouts.current).forEach(clearTimeout);
      idleTimeouts.current = {};
    };
  }, [eventBus, stages]);

  // Animation engine: toggle blinkPhase every 800ms while any robot is running
  const hasRunning = workers.some((w) => w.state === 'running');
  useEffect(() => {
    if (!hasRunning) {
      setGlobalBlinkPhase(false);
      return;
    }

    const interval = setInterval(() => {
      setGlobalBlinkPhase((prev) => !prev);
    }, 800);

    return () => clearInterval(interval);
  }, [hasRunning]);

  const orchestratorState = useMemo((): RobotState => {
    const active = workers.some((w) => w.state === 'running' || w.state === 'queued');
    return active ? 'running' : 'idle';
  }, [workers]);

  const crewState: CrewState = useMemo(
    () => ({
      orchestrator: {
        name: 'orchestrator',
        displayName: 'CREW',
        state: orchestratorState,
        blinkPhase: orchestratorState === 'running' ? globalBlinkPhase : false,
      },
      workers: workers.map((w) => ({
        ...w,
        blinkPhase: w.state === 'running' ? globalBlinkPhase : false,
      })),
      healthStatus: 'healthy',
    }),
    [workers, orchestratorState, globalBlinkPhase]
  );

  return crewState;
}
