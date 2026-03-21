import React, { useState, useCallback } from 'react';
import type { MenuLevel } from '../command-menu/MenuTypes.js';

export interface UseMenuStackProps {
  onQuit: () => void;
  activeAction: string | null;
  clearActiveAction: () => void;
}

export interface UseMenuStack {
  stack: MenuLevel[];
  currentLevel: MenuLevel;
  push: (level: MenuLevel) => void;
  pop: () => void;
  handleQ: () => void;
}

export function useMenuStack({
  onQuit,
  activeAction,
  clearActiveAction,
}: UseMenuStackProps): UseMenuStack {
  const [stack, setStack] = useState<MenuLevel[]>(['main']);

  const push = useCallback((level: MenuLevel) => {
    setStack((prev) => [...prev, level]);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => {
      if (prev.length > 1) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  const handleQ = useCallback(() => {
    // If an action is active, Q clears the action but stays at current menu level
    if (activeAction && activeAction !== 'none') {
      clearActiveAction();
      return;
    }

    // If we're in a submenu, pop to the parent
    if (stack.length > 1) {
      pop();
    } else {
      // If we're at main menu, trigger exit/quit confirm
      onQuit();
    }
  }, [activeAction, clearActiveAction, stack.length, pop, onQuit]);

  const currentLevel = stack[stack.length - 1] ?? 'main';

  return React.useMemo(() => ({
    stack,
    currentLevel,
    push,
    pop,
    handleQ,
  }), [stack, currentLevel, push, pop, handleQ]);
}
