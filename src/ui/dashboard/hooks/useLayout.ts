import { useEffect } from 'react';
import { useStdout } from 'ink';

import type { LayoutMode } from '../shared/DashboardTypes.js';
import { useDashboardStore } from '@ui/stores/index.js';

export interface UseLayoutResult {
  layoutMode: LayoutMode;
  columns: number;
}

export function useLayout(): UseLayoutResult {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const layoutMode: LayoutMode = columns < 80 ? 'compact' : 'grid';
  const panelCount = layoutMode === 'compact' ? 2 : 4;

  // Sync panel count to store whenever layoutMode changes.
  // Try-catch guards against direct (non-component) calls in unit tests.
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      useDashboardStore.getState().setPanelCount(panelCount);
    }, [panelCount]);
  } catch {
    // Outside React component context — side effect skipped.
  }

  return { layoutMode, columns };
}
