import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'

import type { IDiagnoseService } from '@core/DiagnoseTypes.js'
import type { DiagnoseIssue, DiagnoseResult } from '@core/DiagnoseTypes.js'
import { formatLocalTimeMs } from '@shared/FormatTime.js'
import { useAppStore } from '@ui/stores/appStore.js'
import { useDiagnosePolling } from '../hooks/useDiagnosePolling.js'
import { PipelineCrew } from '../crew/PipelineCrew.js'

const MAX_VISIBLE = 5

interface DiagnosePanelProps {
  stages: string[]
  /** Map of team name → stage names, for multi-team crew switching */
  teamStages?: Map<string, string[]>
  diagnoseService?: IDiagnoseService
  isFocused: boolean
  dimmed?: boolean
  width?: number
  height?: number
}

function truncate(str: string, max: number): string {
  if (str.length > max) {
    return str.slice(0, max - 1) + '\u2026'
  }
  return str
}

function issueColor(type: DiagnoseIssue['type']): string {
  switch (type) {
    case 'stuck':
      return 'red'
    case 'orphaned':
      return 'red'
    case 'queue_gap':
      return 'yellow'
    case 'loop_blocked':
      return 'gray'
    case 'failed':
      return 'red'
    case 'blocked':
      return 'magenta'
  }
}

function DiagnosePanelInner({
  stages,
  teamStages,
  diagnoseService,
  isFocused,
  dimmed = false,
  width: _width,
  height: _height,
}: DiagnosePanelProps): React.JSX.Element {
  const eventBus = useAppStore(s => s.eventBus);
  const { lastResult, lastPollAt } = useDiagnosePolling(eventBus ?? undefined);
  const [manualResult, setManualResult] = useState<DiagnoseResult | null>(null)
  const [manualLastAt, setManualLastAt] = useState<number | null>(null)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [crewTeamIndex, setCrewTeamIndex] = useState(0)

  // Multi-team crew switching
  const teamNames = teamStages ? [...teamStages.keys()] : []
  const isMultiTeam = teamNames.length > 1
  const crewTeamName = isMultiTeam ? teamNames[crewTeamIndex % teamNames.length] : undefined
  const crewStages = crewTeamName && teamStages ? teamStages.get(crewTeamName)! : stages

  useEffect(() => {
    if (!diagnoseService || !eventBus) return

    const run = (): void => {
      try {
        const r = diagnoseService.diagnose()
        setManualResult(r)
        setManualLastAt(Date.now())
      } catch {
        // ignore
      }
    }

    run() // run on mount

    eventBus.on('task:completed', run)
    eventBus.on('task:failed', run)
    eventBus.on('story:completed', run)

    return () => {
      eventBus.off('task:completed', run)
      eventBus.off('task:failed', run)
      eventBus.off('story:completed', run)
    }
  }, [diagnoseService, eventBus])

  const result = lastResult ?? manualResult
  const lastAt = lastPollAt ?? manualLastAt

  const issues = result?.issues ?? []
  const summary = result?.summary ?? {
    stuckCount: 0,
    orphanedCount: 0,
    queueGapCount: 0,
    loopBlockedCount: 0,
  }

  // PipelineCrew takes ~8 lines. Plus header, etc.
  const visibleRows = _height != null ? Math.max(1, _height - 13) : MAX_VISIBLE
  const maxOffset = Math.max(0, issues.length - visibleRows)

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setScrollOffset(prev => Math.max(0, prev - 1))
      } else if (key.downArrow) {
        setScrollOffset(prev => Math.min(maxOffset, prev + 1))
      } else if (input.toLowerCase() === 't' && isMultiTeam) {
        setCrewTeamIndex(prev => (prev + 1) % teamNames.length)
      }
    },
    { isActive: isFocused }
  )

  const clampedOffset = Math.min(scrollOffset, maxOffset)
  const borderColor = dimmed ? 'gray' : isFocused ? 'cyan' : undefined
  const visibleIssues = issues.slice(clampedOffset, clampedOffset + visibleRows)
  const lastStr = lastAt != null ? formatLocalTimeMs(lastAt) : ''

  return (
    <Box flexDirection="column" height={_height} borderStyle="single" borderColor={borderColor} overflow="hidden">
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text bold dimColor={dimmed}>
          Pipeline Health
        </Text>
        {lastStr !== '' && (
          <Text dimColor>{'Last: '}{lastStr}</Text>
        )}
      </Box>

      {/* AC2: Crew on top (fixed height) */}
      <Box height={8} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottomColor="gray" marginBottom={0} flexDirection="column">
        {isMultiTeam && crewTeamName && (
          <Text dimColor={dimmed} color="cyan"> [{crewTeamName}] {isFocused ? '[T] Switch team' : ''}</Text>
        )}
        <PipelineCrew stages={crewStages} dimmed={dimmed} width={(_width || 40) - 2} />
      </Box>

      <Box flexDirection="row" paddingX={1} marginTop={0}>
        <Text dimColor={dimmed}>{'Stuck: '}</Text>
        <Text
          color={summary.stuckCount > 0 ? 'red' : undefined}
          bold={summary.stuckCount > 0}
          dimColor={dimmed && summary.stuckCount === 0}
        >
          {String(summary.stuckCount)}
        </Text>
        <Text dimColor={dimmed}>{'  Orphaned: '}</Text>
        <Text
          color={summary.orphanedCount > 0 ? 'red' : undefined}
          bold={summary.orphanedCount > 0}
          dimColor={dimmed && summary.orphanedCount === 0}
        >
          {String(summary.orphanedCount)}
        </Text>
        <Text dimColor={dimmed}>{'  Gap: '}</Text>
        <Text
          color={summary.queueGapCount > 0 ? 'yellow' : undefined}
          bold={summary.queueGapCount > 0}
          dimColor={dimmed && summary.queueGapCount === 0}
        >
          {String(summary.queueGapCount)}
        </Text>
        <Text dimColor={dimmed}>{'  Loop: '}</Text>
        <Text color="gray" dimColor={dimmed}>
          {String(summary.loopBlockedCount)}
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
        {result === null && <Text dimColor>Waiting\u2026</Text>}

        {result !== null && issues.length === 0 && (
          <Text color="green" dimColor={dimmed}>
            All clear \u2713
          </Text>
        )}

        {result !== null &&
          issues.length > 0 &&
          visibleIssues.map((issue, i) => (
            <Box key={`${issue.taskId}-${i}`} flexDirection="row">
              <Text dimColor={dimmed} wrap="truncate">{`${truncate(issue.storyTitle, 15)} `}</Text>
              <Text dimColor={dimmed}>{`${truncate(issue.stageName, 10)} `}</Text>
              <Text color={issueColor(issue.type)} dimColor={dimmed}>{`${issue.type} `}</Text>
              <Text dimColor={dimmed}>{truncate(issue.suggestedAction, 12)}</Text>
            </Box>
          ))}
      </Box>

      {issues.length > visibleRows && (
        <Box paddingX={1}>
          <Text color="gray" dimColor={dimmed}>
            {`\u2191\u2193 scroll (${clampedOffset + 1}-${Math.min(clampedOffset + visibleRows, issues.length)} of ${issues.length})`}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export const DiagnosePanel = React.memo(
  DiagnosePanelInner,
  (prev, next) =>
    prev.isFocused === next.isFocused &&
    prev.dimmed === next.dimmed &&
    prev.width === next.width &&
    prev.height === next.height &&
    prev.stages === next.stages &&
    prev.diagnoseService === next.diagnoseService
)
