import React from 'react'
import { Box, useStdout } from 'ink'

import { DASHBOARD_CHROME_ROWS } from '@config/defaults.js'
import type { DashboardProps } from './shared/DashboardTypes.js'
import { useDashboardStore } from '@ui/stores/index.js'
import { useLayout } from './hooks/useLayout.js'
import { KeyBindings } from './command-menu/KeyBindings.js'
import { CompactLayout } from './layouts/CompactLayout.js'
import { GridLayout } from './layouts/GridLayout.js'
import { BrandHeader } from './brand/BrandHeader.js'
import { TraceWizard } from '@ui/trace/TraceWizard.js'

// ---------------------------------------------------------------------------
// OverviewMode / TraceMode — display toggle
// ---------------------------------------------------------------------------

function OverviewMode({ rows, columns, stages }: {
  rows: number; columns: number; stages: string[]
}): React.JSX.Element {
  const visible = useDashboardStore(s => s.dashboardMode === 'overview')
  const { layoutMode } = useLayout()
  const contentRows = rows - DASHBOARD_CHROME_ROWS

  if (!visible) return <Box display="none" height={contentRows} />

  if (layoutMode === 'compact') {
    return (
      <CompactLayout
        terminalRows={rows}
        terminalColumns={columns}
      />
    )
  }

  return (
    <GridLayout
      terminalRows={rows}
      terminalColumns={columns}
      stages={stages}
    />
  )
}

function TraceMode({ rows }: {
  rows: number
}): React.JSX.Element {
  const visible = useDashboardStore(s => s.dashboardMode === 'trace')
  const contentRows = rows - DASHBOARD_CHROME_ROWS

  if (!visible) return <Box display="none" height={contentRows} />

  return (
    <Box flexDirection="column" height={contentRows} overflow="hidden">
      <TraceWizard
        onComplete={useDashboardStore.getState().toggleTrace}
      />
    </Box>
  )
}

// ---------------------------------------------------------------------------
// DashboardApp — static shell, ZERO store subscriptions
// Stores are pre-initialized in Start.ts before render().
// This component renders the full dashboard on the FIRST frame.
// ---------------------------------------------------------------------------

export function DashboardApp(props: DashboardProps): React.JSX.Element {
  const { pipelineConfig } = props
  const { stdout } = useStdout()

  const terminalRows = stdout?.rows ?? 24
  const rows = terminalRows - 1
  const columns = stdout?.columns ?? 80
  const stages = (pipelineConfig?.stages ?? []).map(s => s.name)

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      <BrandHeader />
      <OverviewMode rows={rows} columns={columns} stages={stages} />
      <TraceMode rows={rows} />
      <KeyBindings />
    </Box>
  )
}
