import React from 'react'
import { Box } from 'ink'

import { DASHBOARD_CHROME_ROWS } from '@config/defaults.js'
import { PanelSlot } from './PanelSlot.js'
import { TLPanel } from '../command-menu/TLPanel.js'
import { ActiveStoriesPanel } from '../active-stories/ActiveStoriesPanel.js'
import { LiveActivityPanel } from '../live-activity/LiveActivityPanel.js'
import { DiagnosePanel } from '../diagnose/DiagnosePanel.js'

interface GridLayoutProps {
  terminalRows: number
  terminalColumns: number
  stages: string[]
}

/**
 * GridLayout — static shell rendering 2x2 panel grid.
 * ZERO store subscriptions. Dimensions from props. PanelSlot handles visibility.
 * Each panel reads its own focus state from dashboardStore.
 */
function GridLayoutInner({
  terminalRows,
  terminalColumns,
  stages,
}: GridLayoutProps): React.JSX.Element {
  const leftWidth = Math.floor(terminalColumns / 2)
  const rightWidth = terminalColumns - leftWidth
  const availableRows = terminalRows - DASHBOARD_CHROME_ROWS
  const topHeight = Math.floor(availableRows / 2)
  const bottomHeight = availableRows - topHeight

  return (
    <Box flexDirection="column" height={availableRows} overflow="hidden">
      {/* Top row */}
      <Box flexDirection="row" height={topHeight} overflow="hidden">
        <PanelSlot index={0} width={leftWidth} height={topHeight}>
          <TLPanel width={leftWidth} height={topHeight} />
        </PanelSlot>
        <PanelSlot index={1} width={rightWidth} height={topHeight}>
          <ActiveStoriesPanel
            isFocused={false}
            width={rightWidth}
            height={topHeight}
          />
        </PanelSlot>
      </Box>
      {/* Bottom row */}
      <Box flexDirection="row" height={bottomHeight} overflow="hidden">
        <PanelSlot index={2} width={leftWidth} height={bottomHeight}>
          <LiveActivityPanel
            isFocused={false}
            isFullscreen={false}
            width={leftWidth}
            height={bottomHeight}
          />
        </PanelSlot>
        <PanelSlot index={3} width={rightWidth} height={bottomHeight}>
          <DiagnosePanel
            stages={stages}
            isFocused={false}
            width={rightWidth}
            height={bottomHeight}
          />
        </PanelSlot>
      </Box>
    </Box>
  )
}

export const GridLayout = React.memo(
  GridLayoutInner,
  (prev, next) =>
    prev.terminalRows === next.terminalRows &&
    prev.terminalColumns === next.terminalColumns &&
    prev.stages === next.stages
)
