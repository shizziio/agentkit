import { create } from 'zustand';
import type { MenuLevel } from '@ui/dashboard/command-menu/MenuTypes.js';

export interface MenuStore {
  stack: MenuLevel[];
  currentLevel: MenuLevel;
  push: (level: MenuLevel) => void;
  pop: () => void;
  handleQ: () => void;
  reset: () => void;
}

const _store = create<MenuStore>()((set, get) => ({
  stack: ['main'],
  currentLevel: 'main',

  push: (level: MenuLevel): void => {
    set(s => {
      const newStack = [...s.stack, level];
      return { stack: newStack, currentLevel: level };
    });
  },

  pop: (): void => {
    set(s => {
      if (s.stack.length <= 1) return s;
      const newStack = s.stack.slice(0, -1);
      return { stack: newStack, currentLevel: newStack[newStack.length - 1]! };
    });
  },

  handleQ: (): void => {
    // Import lazily to avoid circular deps
    const { useDashboardStore } = require('./dashboardStore.js') as typeof import('./dashboardStore.js');
    const { useStoriesStore } = require('./storiesStore.js') as typeof import('./storiesStore.js');

    const { actionMode } = useDashboardStore.getState();
    if (actionMode !== 'none') {
      useDashboardStore.getState().closeAction();
      useStoriesStore.getState().refresh();
      return;
    }
    const { stack } = get();
    if (stack.length > 1) {
      get().pop();
    } else {
      useDashboardStore.getState().openAction('quit-confirm');
    }
  },

  reset: (): void => set({ stack: ['main'], currentLevel: 'main' }),
}));

// Patch setState to always merge
const _origSetState = _store.setState;
_store.setState = (partial, _replace) => {
  const resolved = typeof partial === 'function' ? partial(_store.getState()) : partial;
  _origSetState(resolved);
};

export const useMenuStore = _store;
