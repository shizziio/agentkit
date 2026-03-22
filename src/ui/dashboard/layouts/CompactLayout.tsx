import React from 'react'
import { Box } from 'ink'

import { DASHBOARD_CHROME_ROWS } from '@config/defaults.js'
import { PanelSlot } from './PanelSlot.js'
import { TLPanel } from '../command-menu/TLPanel.js'
import { LiveActivityPanel } from '../live-activity/LiveActivityPanel.js'

interface CompactLayoutProps {
  terminalRows: number
  terminalColumns: number
}

/**
 * CompactLayout — static shell for narrow terminals (< 80 cols).
 * 2 stacked panels: TL + LiveActivity.
 */
function CompactLayoutInner({
  terminalRows,
  terminalColumns,
}: CompactLayoutProps): React.JSX.Element {
  const availableRows = terminalRows - DASHBOARD_CHROME_ROWS
  const topHeight = Math.floor(availableRows / 2)
  const bottomHeight = availableRows - topHeight

  return (
    <Box flexDirection="column" height={availableRows} overflow="hidden">
      <PanelSlot index={0} width={terminalColumns} height={topHeight}>
        <TLPanel width={terminalColumns} height={topHeight} />
      </PanelSlot>
      <PanelSlot index={1} width={terminalColumns} height={bottomHeight}>
        <LiveActivityPanel
          isFocused={false}
          isFullscreen={false}
          width={terminalColumns}
          height={bottomHeight}
        />
      </PanelSlot>
    </Box>
  )
}

export const CompactLayout = React.memo(
  CompactLayoutInner,
  (prev, next) =>
    prev.terminalRows === next.terminalRows &&
    prev.terminalColumns === next.terminalColumns,
)
