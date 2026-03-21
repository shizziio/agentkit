import React from 'react';
import { Box, useStdout } from 'ink';

import { DASHBOARD_CHROME_ROWS } from '@config/defaults.js';
import type { ActionMode } from '../shared/DashboardTypes.js';

export interface ActionPanelProps {
  actionMode: ActionMode;
  idleContent: React.ReactNode;
  activeContent: React.ReactNode | null;
}

export function ActionPanel({ actionMode, idleContent, activeContent }: ActionPanelProps): React.JSX.Element {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const panelHeight = Math.floor((rows - DASHBOARD_CHROME_ROWS) / 2);

  return (
    <Box flexDirection="column" height={panelHeight} overflow="hidden">
      {actionMode === 'none'
        ? (
          <Box flexDirection="column" height={panelHeight} overflow="hidden">
            {idleContent}
          </Box>
        )
        : (
          <Box flexDirection="column" borderStyle="single" borderColor="gray" height={panelHeight} overflow="hidden">
            {activeContent}
          </Box>
        )}
    </Box>
  );
}
