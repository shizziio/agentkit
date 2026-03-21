import React from 'react';
import { Box, useStdout } from 'ink';

import { DASHBOARD_CHROME_ROWS } from '@config/defaults.js';
import { useDashboardStore } from '@ui/stores/index.js';
import { useAppStore } from '@ui/stores/appStore.js';
import { PipelineFlowPanel } from '../pipeline-flow/PipelineFlowPanel.js';
import { ActiveStoriesPanel } from '../active-stories/ActiveStoriesPanel.js';
import { LiveActivityPanel } from '../live-activity/LiveActivityPanel.js';
import { LiveActivityFullscreen } from '../live-activity/LiveActivityFullscreen.js';
import { DiagnosePanel } from '../diagnose/DiagnosePanel.js';
import { ChatPanel } from '@ui/chat/ChatPanel.js';

interface GridLayoutProps {
  focusModePanel: number | null;
  dimmed?: boolean;
  tlPanelNode?: React.ReactNode;
  chatMode?: boolean;
  onExitChat?: () => void;
}


function GridLayoutInner({
  focusModePanel,
  dimmed = false,
  tlPanelNode,
  chatMode = false,
  onExitChat,
}: GridLayoutProps): React.JSX.Element {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 80;
  const focusedPanel = useDashboardStore(s => s.focusedPanel);
  const pipelineConfig = useAppStore(s => s.pipelineConfig);
  const diagnoseService = useAppStore(s => s.diagnoseService);
  const stages = pipelineConfig?.stages ?? [];

  const leftWidth = Math.floor(columns / 2);
  const rightWidth = columns - leftWidth;
  const availableRows = rows - DASHBOARD_CHROME_ROWS;
  const topHeight = Math.floor(availableRows / 2);
  const bottomHeight = availableRows - topHeight;

  return (
    <Box flexDirection="column" height={availableRows} overflow="hidden">
      {/* Top row */}
      <Box flexDirection="row" height={topHeight} overflow="hidden">
        {/* TL: PipelineFlowPanel or action panel (panel 0) */}
        <Box
          display={focusModePanel !== null && focusModePanel !== 0 ? 'none' : 'flex'}
          width={leftWidth}
          height={topHeight}
          flexDirection="column"
          overflow="hidden"
        >
          {tlPanelNode ?? <PipelineFlowPanel stages={stages} width={leftWidth} height={topHeight} />}
        </Box>
        {/* TR: ActiveStoriesPanel (panel 1) */}
        <Box
          display={focusModePanel !== null && focusModePanel !== 1 ? 'none' : 'flex'}
          width={rightWidth}
          height={topHeight}
          flexDirection="column"
          overflow="hidden"
        >
          <ActiveStoriesPanel
            isFocused={focusedPanel === 1}
            dimmed={dimmed}
            width={rightWidth}
            height={topHeight}
          />
        </Box>
      </Box>
      {/* Bottom row */}
      <Box flexDirection="row" height={bottomHeight} overflow="hidden">
        {/* BL: LiveActivityPanel / LiveActivityFullscreen (panel 2) */}
        <Box
          display={focusModePanel !== null && focusModePanel !== 2 ? 'none' : 'flex'}
          width={leftWidth}
          height={bottomHeight}
          flexDirection="column"
          overflow="hidden"
        >
          {chatMode ? (
            <ChatPanel
              onExit={onExitChat ?? (() => undefined)}
              isFocused={focusedPanel === 2}
              width={leftWidth}
              height={bottomHeight}
            />
          ) : focusModePanel === 2 ? (
            <LiveActivityFullscreen />
          ) : (
            <LiveActivityPanel
              isFocused={focusedPanel === 2}
              isFullscreen={false}
              dimmed={dimmed}
              width={leftWidth}
              height={bottomHeight}
            />
          )
          }
        </Box>
        {/* BR: Diagnose placeholder (panel 3) */}
        <Box
          display={focusModePanel !== null && focusModePanel !== 3 ? 'none' : 'flex'}
          width={rightWidth}
          height={bottomHeight}
          flexDirection="column"
          overflow="hidden"
        >
          <DiagnosePanel
            stages={stages.map(s => s.name)}
            diagnoseService={diagnoseService ?? undefined}
            isFocused={focusedPanel === 3}
            dimmed={dimmed}
            width={rightWidth}
            height={bottomHeight}
          />
        </Box>
      </Box>
    </Box>
  );
}

export const GridLayout = React.memo(
  GridLayoutInner,
  (prev, next) =>
    prev.focusModePanel === next.focusModePanel &&
    prev.dimmed === next.dimmed &&
    prev.tlPanelNode === next.tlPanelNode &&
    prev.chatMode === next.chatMode
);
