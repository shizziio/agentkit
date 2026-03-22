import React from 'react'
import { Box } from 'ink'

import { useDashboardStore } from '@ui/stores/dashboardStore.js'

interface PanelSlotProps {
  index: number
  width: number
  height: number
  children: React.ReactNode
}

/**
 * PanelSlot — a container that subscribes to dashboardStore.focusModePanel
 * to toggle visibility. Children are static (set once at mount).
 */
function PanelSlotInner({ index, width, height, children }: PanelSlotProps): React.JSX.Element {
  const visible = useDashboardStore(s =>
    s.focusModePanel === null || s.focusModePanel === index
  )

  return (
    <Box
      display={visible ? 'flex' : 'none'}
      width={width}
      height={height}
      flexDirection="column"
      overflow="hidden"
    >
      {children}
    </Box>
  )
}

export const PanelSlot = React.memo(PanelSlotInner)
