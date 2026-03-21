import React from 'react';
import { Box, useStdout } from 'ink';

import { DASHBOARD_CHROME_ROWS } from '@config/defaults.js';
import { useDashboardStore } from '@ui/stores/index.js';
import { ActiveStoriesPanel } from '../active-stories/ActiveStoriesPanel.js';
import { LiveActivityPanel } from '../live-activity/LiveActivityPanel.js';
import { LiveActivityFullscreen } from '../live-activity/LiveActivityFullscreen.js';

interface CompactLayoutProps {
  focusModePanel: number | null;
  dimmed?: boolean;
  tlPanelNode?: React.ReactNode;
}

function CompactLayoutInner({
  focusModePanel,
  dimmed = false,
  tlPanelNode,
}: CompactLayoutProps): React.JSX.Element {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 80;
  const focusedPanel = useDashboardStore(s => s.focusedPanel);
  const availableRows = rows - DASHBOARD_CHROME_ROWS;
  const topHeight = Math.floor(availableRows / 2);
  const bottomHeight = availableRows - topHeight;

  return (
    <Box flexDirection="column" height={availableRows} overflow="hidden">
      <Box display={focusModePanel !== null && focusModePanel !== 0 ? 'none' : 'flex'} height={topHeight} overflow="hidden">
        {tlPanelNode ?? (
          <ActiveStoriesPanel
            isFocused={focusedPanel === 0}
            dimmed={dimmed}
            width={columns}
            height={topHeight}
          />
        )}
      </Box>
      <Box display={focusModePanel !== null && focusModePanel !== 1 ? 'none' : 'flex'} height={bottomHeight} overflow="hidden">
        {focusModePanel === 1 ? (
          <LiveActivityFullscreen />
        ) : (
          <LiveActivityPanel
            isFocused={focusedPanel === 1}
            isFullscreen={false}
            dimmed={dimmed}
            width={columns}
            height={bottomHeight}
          />
        )}
      </Box>
    </Box>
  );
}

export const CompactLayout = React.memo(
  CompactLayoutInner,
  (prev, next) =>
    prev.focusModePanel === next.focusModePanel &&
    prev.dimmed === next.dimmed &&
    prev.tlPanelNode === next.tlPanelNode,
);
