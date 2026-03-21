import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { EventBus } from '@core/EventBus.js';
import type { TaskEvent } from '@core/EventTypes.js';
import type { RobotEntry, RobotState } from '@ui/dashboard/crew/CrewTypes.js';

export interface CrewStore {
  workers: RobotEntry[];
  globalBlinkPhase: boolean;
  init: (eventBus: EventBus, stages: string[]) => void;
  cleanup: () => void;
  orchestratorState: () => RobotState;
}

function deriveDisplayName(stageName: string): string {
  const base = stageName.replace(/-worker$/, '');
  if (base.length <= 2) return base.toUpperCase();
  const first3 = base.slice(0, 3);
  return first3.charAt(0).toUpperCase() + first3.slice(1).toLowerCase();
}

// Module-level closure variables — NOT React refs
let _cleanupEvents: (() => void) | null = null;
let _idleTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};
let _blinkInterval: ReturnType<typeof setInterval> | null = null;
let _storySourceStages: Record<number, string> = {};
let _stages: string[] = [];
let _cleanupBlink: (() => void) | null = null;

const _store = create<CrewStore>()(
  subscribeWithSelector((set, get) => ({
    workers: [],
    globalBlinkPhase: false,

    orchestratorState: (): RobotState => {
      const { workers } = get();
      const active = workers.some((w) => w.state === 'running' || w.state === 'queued');
      return active ? 'running' : 'idle';
    },

    init: (eventBus: EventBus, stages: string[]): void => {
      get().cleanup();

      _stages = stages;
      _idleTimeouts = {};
      _storySourceStages = {};

      set({
        workers: stages.map((name) => ({
          name,
          displayName: deriveDisplayName(name),
          state: 'idle' as RobotState,
          blinkPhase: false,
        })),
        globalBlinkPhase: false,
      });

      const clearIdleTimeout = (stageName: string): void => {
        if (_idleTimeouts[stageName] !== undefined) {
          clearTimeout(_idleTimeouts[stageName]);
          delete _idleTimeouts[stageName];
        }
      };

      const updateWorkerState = (stageName: string, newState: RobotState): void => {
        set((s) => ({
          workers: s.workers.map((w) =>
            w.name === stageName ? { ...w, state: newState } : w,
          ),
        }));
      };

      const onTaskQueued = (event: TaskEvent): void => {
        clearIdleTimeout(event.stageName);
        updateWorkerState(event.stageName, 'queued');
      };

      const onTaskStarted = (event: TaskEvent): void => {
        _storySourceStages[event.storyId] = event.stageName;
        clearIdleTimeout(event.stageName);
        updateWorkerState(event.stageName, 'running');
      };

      const onTaskCompleted = (event: TaskEvent): void => {
        const { stageName } = event;
        updateWorkerState(stageName, 'done');
        clearIdleTimeout(stageName);
        _idleTimeouts[stageName] = setTimeout(() => {
          updateWorkerState(stageName, 'idle');
          delete _idleTimeouts[stageName];
        }, 3000);
      };

      const onTaskFailed = (event: TaskEvent): void => {
        const { stageName } = event;
        updateWorkerState(stageName, 'error');
        clearIdleTimeout(stageName);
        _idleTimeouts[stageName] = setTimeout(() => {
          updateWorkerState(stageName, 'idle');
          delete _idleTimeouts[stageName];
        }, 5000);
      };

      const onTaskRouted = (event: TaskEvent): void => {
        const { storyId, stageName: targetStage } = event;
        let sourceStage: string | undefined = _storySourceStages[storyId];

        if (!sourceStage) {
          const targetIdx = _stages.indexOf(targetStage);
          if (targetIdx > 0) {
            sourceStage = _stages[targetIdx - 1];
          }
        }

        if (sourceStage !== undefined) {
          const src = sourceStage;
          updateWorkerState(src, 'done');
          clearIdleTimeout(src);
          _idleTimeouts[src] = setTimeout(() => {
            updateWorkerState(src, 'idle');
            delete _idleTimeouts[src];
          }, 3000);
        }

        clearIdleTimeout(targetStage);
        updateWorkerState(targetStage, 'queued');
        _storySourceStages[storyId] = targetStage;
      };

      eventBus.on('task:queued', onTaskQueued);
      eventBus.on('task:started', onTaskStarted);
      eventBus.on('task:completed', onTaskCompleted);
      eventBus.on('task:failed', onTaskFailed);
      eventBus.on('task:routed', onTaskRouted);

      _cleanupEvents = (): void => {
        eventBus.off('task:queued', onTaskQueued);
        eventBus.off('task:started', onTaskStarted);
        eventBus.off('task:completed', onTaskCompleted);
        eventBus.off('task:failed', onTaskFailed);
        eventBus.off('task:routed', onTaskRouted);
      };

      // Reactive blink interval: start when any worker is running, stop otherwise
      _cleanupBlink = _store.subscribe(
        (state) => state.workers.some((w) => w.state === 'running'),
        (hasRunning) => {
          if (hasRunning) {
            if (_blinkInterval === null) {
              _blinkInterval = setInterval(() => {
                set((s) => ({ globalBlinkPhase: !s.globalBlinkPhase }));
              }, 800);
            }
          } else {
            if (_blinkInterval !== null) {
              clearInterval(_blinkInterval);
              _blinkInterval = null;
            }
            set({ globalBlinkPhase: false });
          }
        },
        { equalityFn: (a: boolean, b: boolean) => a === b, fireImmediately: true },
      );
    },

    cleanup: (): void => {
      _cleanupEvents?.();
      _cleanupBlink?.();
      Object.values(_idleTimeouts).forEach(clearTimeout);
      if (_blinkInterval !== null) {
        clearInterval(_blinkInterval);
        _blinkInterval = null;
      }
      set({ globalBlinkPhase: false });
      _storySourceStages = {};
      _idleTimeouts = {};
      _cleanupEvents = null;
      _cleanupBlink = null;
      // Do NOT reset workers — intentional: store persists across remounts
    },
  })),
);

// Patch setState to always merge (never replace) so test resets preserve action methods.
const _origSetState = _store.setState;
_store.setState = (partial, _replace) => {
  const resolved = typeof partial === 'function' ? partial(_store.getState()) : partial;
  _origSetState(resolved);
};

export const useCrewStore = _store;
