import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { EventBus } from '@core/EventBus.js';
import type { AlertEvent } from '@core/EventTypes.js';
import type { AlertOverlayEntry } from '@ui/dashboard/modals/AlertOverlayTypes.js';

export interface AlertState {
  queue: AlertOverlayEntry[];
  currentAlert: AlertOverlayEntry | null;
  queueLength: number;
}

export interface AlertActions {
  init: (eventBus: EventBus) => void;
  cleanup: () => void;
  dismiss: () => void;
}

export type AlertStore = AlertState & AlertActions;

// Module-level refs live outside store state so they survive setState resets.
const _sub = {
  eventBus: null as EventBus | null,
  handler: null as ((event: AlertEvent) => void) | null,
};

function _unsubscribe(): void {
  if (_sub.eventBus && _sub.handler) {
    _sub.eventBus.off('task:alert', _sub.handler);
    _sub.eventBus = null;
    _sub.handler = null;
  }
}

const _store = create<AlertStore>()(
  subscribeWithSelector((set) => ({
    queue: [],
    currentAlert: null,
    queueLength: 0,

    init: (eventBus: EventBus): void => {
      _unsubscribe();

      const handler = (event: AlertEvent): void => {
        const entry: AlertOverlayEntry = {
          id: Math.random().toString(36).slice(2),
          taskId: event.taskId,
          storyId: event.storyId,
          storyTitle: event.storyTitle,
          stageName: event.stageName,
          issues: event.issues,
          routedTo: event.routedTo,
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          isBlocked: event.isBlocked,
          timestamp: Date.now(),
        };
        set((s) => {
          const queue = [...s.queue, entry];
          return { queue, currentAlert: queue[0] ?? null, queueLength: queue.length };
        });
      };

      eventBus.on('task:alert', handler);
      _sub.eventBus = eventBus;
      _sub.handler = handler;
    },

    cleanup: (): void => {
      _unsubscribe();
    },

    dismiss: (): void => {
      set((s) => {
        const queue = s.queue.slice(1);
        return { queue, currentAlert: queue[0] ?? null, queueLength: queue.length };
      });
    },
  })),
);

// Patch external setState to always merge (never replace) AND keep derived fields
// (currentAlert, queueLength) in sync with queue whenever queue is included in the update.
// This ensures that test resets via setState({ queue: [] }, true) also clear derived state.
const _origSetState = _store.setState;
_store.setState = (partial, _replace) => {
  const resolved =
    typeof partial === 'function' ? partial(_store.getState()) : partial;
  if (resolved && typeof resolved === 'object' && 'queue' in resolved) {
    const q = (resolved as Partial<AlertState>).queue;
    if (Array.isArray(q)) {
      _origSetState({
        ...(resolved as Partial<AlertStore>),
        currentAlert: q[0] ?? null,
        queueLength: q.length,
      });
      return;
    }
  }
  _origSetState(resolved);
};

export const useAlertStore = _store;
