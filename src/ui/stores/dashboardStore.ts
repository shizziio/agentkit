import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { DashboardMode, ActionMode } from '@ui/dashboard/shared/DashboardTypes.js';

export interface DashboardState {
  dashboardMode: DashboardMode;
  actionMode: ActionMode;
  isFullscreen: boolean;
  focusedPanel: number;
  panelCount: number;
}

export interface DashboardActions {
  isActionActive: () => boolean;
  openAction: (m: Exclude<ActionMode, 'none'>) => void;
  closeAction: () => void;
  toggleTrace: () => void;
  toggleFullscreen: () => void;
  focusNext: () => void;
  focusPrev: () => void;
  setFocusedPanel: (id: number) => void;
  setPanelCount: (n: number) => void;
}

export type DashboardStore = DashboardState & DashboardActions;

const _store = create<DashboardStore>()(
  subscribeWithSelector((set, get) => ({
    dashboardMode: 'overview',
    actionMode: 'none',
    isFullscreen: false,
    focusedPanel: 0,
    panelCount: 4,

    isActionActive: () => get().actionMode !== 'none',

    openAction: (m) => set({ actionMode: m }),

    closeAction: () => set({ actionMode: 'none' }),

    toggleTrace: () => {
      if (get().actionMode !== 'none') return;
      const next: DashboardMode = get().dashboardMode === 'overview' ? 'trace' : 'overview';
      set({ dashboardMode: next, isFullscreen: false });
    },

    toggleFullscreen: () => {
      if (get().actionMode !== 'none') return;
      if (get().dashboardMode !== 'overview') return;
      set((s) => ({ isFullscreen: !s.isFullscreen }));
    },

    focusNext: () => set((s) => ({ focusedPanel: (s.focusedPanel + 1) % s.panelCount })),

    focusPrev: () =>
      set((s) => ({ focusedPanel: (s.focusedPanel - 1 + s.panelCount) % s.panelCount })),

    setFocusedPanel: (id) => {
      if (id < 0 || id >= get().panelCount) return;
      set({ focusedPanel: id });
    },

    setPanelCount: (n) =>
      set((s) => ({ panelCount: n, focusedPanel: s.focusedPanel >= n ? 0 : s.focusedPanel })),
  })),
);

// Patch external setState to always merge (never replace).
// When tests reset state via setState(INITIAL_STATE, true), replace mode would
// erase action methods from the store. By always merging, state fields are
// reset while action methods are preserved.
const _origSetState = _store.setState;
_store.setState = (partial, _replace) => _origSetState(partial);

export const useDashboardStore = _store;
