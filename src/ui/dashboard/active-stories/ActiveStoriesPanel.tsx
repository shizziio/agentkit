import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

import { useStoriesStore } from '@ui/stores/storiesStore.js'
import { useAppStore } from '@ui/stores/appStore.js'
import {
  truncate,
  getStatusColor as getStatusColorShared,
  getPriorityColor as getPriorityColorShared,
  getPriorityDim as getPriorityDimShared,
} from '@ui/shared/format.js'
import type { ActiveStoryEntry, ActiveStoryDisplayStatus } from './ActiveStoriesTypes.js'
import { formatDuration } from '../shared/utils.js'

// Re-export for backwards compatibility
export { formatDuration }
export const COL_PRIORITY_WIDTH = 6

export function getPriorityColor(priority: number): string | undefined {
  return getPriorityColorShared(priority)
}

export function getPriorityDim(priority: number): boolean {
  return getPriorityDimShared(priority)
}

export function getStatusColor(status: ActiveStoryDisplayStatus): string {
  return getStatusColorShared(status)
}

const COL_NUM_WIDTH = 4
const COL_TEAM_WIDTH = 5
const COL_STAGE_WIDTH = 10
const COL_STATUS_WIDTH = 10
const COL_DURATION_WIDTH = 10
const COL_DEPS_WIDTH = 14

const TEAM_COLORS: string[] = ['green', 'cyan', 'yellow', 'magenta', 'blue', 'red']

function teamBadge(team?: string): { text: string; color: string } {
  if (!team) return { text: '---', color: 'gray' }
  const abbr = team.slice(0, 3).toUpperCase()
  // Simple hash to pick a consistent color per team name
  let hash = 0
  for (let i = 0; i < team.length; i++) hash = ((hash << 5) - hash + team.charCodeAt(i)) | 0
  const color = TEAM_COLORS[Math.abs(hash) % TEAM_COLORS.length]!
  return { text: abbr, color }
}

function getDuration(entry: ActiveStoryEntry, now: number): string {
  if (entry.displayStatus === 'QUEUE') return '-'
  if (entry.firstStartedAt === null) return '-'
  if (entry.displayStatus === 'RUN') {
    return formatDuration(now - entry.firstStartedAt)
  }
  if (entry.completedAt !== null) {
    return formatDuration(entry.completedAt - entry.firstStartedAt)
  }
  return '-'
}

interface ActiveStoriesPanelProps {
  isFocused: boolean
  dimmed?: boolean
  width?: number
  height?: number
}

function formatDeps(dependsOn: string[], depStatuses: Record<string, string>): string {
  if (dependsOn.length === 0) return '-'
  const badges = dependsOn.map(key => `${key}${depStatuses[key] === 'done' ? '✓' : '⏳'}`)
  if (badges.length <= 2) return badges.join(' ')
  return badges.slice(0, 2).join(' ') + ' +' + (badges.length - 2)
}

function ActiveStoriesPanelInner({
  isFocused,
  dimmed = false,
  width,
  height: _height,
}: ActiveStoriesPanelProps): React.JSX.Element {
  const safeWidth = (width !== undefined && width > 0) ? width : 50
  const entries = useStoriesStore(s => s.entries)
  const summary = useStoriesStore(s => s.summary)
  const projectConfig = useAppStore(s => s.projectConfig)
  const isMultiTeam = (projectConfig?.activeTeams?.length ?? 0) > 1
  const now = Date.now()
  const [scrollIndex, setScrollIndex] = useState(0)

  // Hard cap: show max 5 rows at a time with pagination scroll
  const PAGE_SIZE = 5
  const visibleRows = PAGE_SIZE
  const maxScroll = Math.max(0, entries.length - visibleRows)
  const clampedScroll = Math.min(scrollIndex, maxScroll)
  const visibleEntries = entries.slice(clampedScroll, clampedScroll + visibleRows)

  useInput(
    (_, key) => {
      if (key.upArrow) {
        setScrollIndex(prev => Math.max(0, prev - 1))
      } else if (key.downArrow) {
        setScrollIndex(prev => Math.min(Math.max(0, entries.length - visibleRows), prev + 1))
      }
    },
    { isActive: isFocused && !dimmed },
  )

  const avgText =
    summary.averageDurationMs !== null ? formatDuration(summary.averageDurationMs) : '-'

  const showScrollHint = entries.length > visibleRows

  return (
    <Box
      borderStyle="round"
      borderColor={dimmed ? 'gray' : isFocused ? 'cyan' : 'gray'}
      height={_height}
      flexDirection="column"
      overflow="hidden"
    >
      {/* Header row */}
      <Box flexDirection="row" width="100%" overflow="hidden">
        <Text bold color="white" dimColor={dimmed} wrap="truncate">
          {'#'.padEnd(COL_NUM_WIDTH)}
        </Text>
        {isMultiTeam && (
          <Text bold color="white" dimColor={dimmed} wrap="truncate">
            {'Team'.padEnd(COL_TEAM_WIDTH)}
          </Text>
        )}
        <Box flexGrow={1} overflow="hidden">
          <Text bold color="white" dimColor={dimmed} wrap="truncate">
            {'Story'}
          </Text>
        </Box>
        <Text bold color="white" dimColor={dimmed} wrap="truncate">
          {'Stage'.padEnd(COL_STAGE_WIDTH)}
        </Text>
        <Text bold color="white" dimColor={dimmed} wrap="truncate">
          {'Status'.padEnd(COL_STATUS_WIDTH)}
        </Text>
        <Text bold color="white" dimColor={dimmed} wrap="truncate">
          {'Deps'.padEnd(COL_DEPS_WIDTH)}
        </Text>
        <Text bold color="white" dimColor={dimmed} wrap="truncate">
          {'Pri'.padEnd(COL_PRIORITY_WIDTH)}
        </Text>
        <Text bold color="white" dimColor={dimmed} wrap="truncate">
          {'Duration'.padEnd(COL_DURATION_WIDTH)}
        </Text>
      </Box>

      {/* Separator */}
      <Text color="gray" dimColor={dimmed} wrap="truncate">{'─'.repeat(Math.max(0, safeWidth - 2))}</Text>

      {/* Data rows */}
      <Box flexDirection="column" overflow="hidden">
        {visibleEntries.length === 0 ? (
          <Text color="gray" dimColor={dimmed} wrap="truncate">No active stories</Text>
        ) : (
          visibleEntries.map((entry, idx) => (
            <Box key={entry.storyId} flexDirection="row" width="100%" overflow="hidden">
              <Text dimColor={dimmed} wrap="truncate">{String(clampedScroll + idx + 1).padEnd(COL_NUM_WIDTH)}</Text>
              {isMultiTeam && (() => {
                const badge = teamBadge(entry.team)
                return <Text color={badge.color} dimColor={dimmed} wrap="truncate">{badge.text.padEnd(COL_TEAM_WIDTH)}</Text>
              })()}
              <Box flexGrow={1} overflow="hidden">
                <Text dimColor={dimmed} wrap="truncate">
                  <Text color="cyan" dimColor={dimmed}>{entry.storyKey}</Text>
                  {' '}{truncate(entry.storyTitle, 30)}
                </Text>
              </Box>
              <Text dimColor={dimmed} wrap="truncate">{truncate(entry.stageName, COL_STAGE_WIDTH)}</Text>
              <Text bold={entry.displayStatus === 'RUN'} color={getStatusColor(entry.displayStatus)} dimColor={dimmed} wrap="truncate">
                {entry.displayStatus.padEnd(COL_STATUS_WIDTH)}
              </Text>
              <Text dimColor={dimmed} wrap="truncate">{truncate(formatDeps(entry.dependsOn, entry.depStatuses), COL_DEPS_WIDTH)}</Text>
              <Text color={getPriorityColor(entry.priority)} dimColor={dimmed || getPriorityDim(entry.priority)} wrap="truncate">{`p=${entry.priority}`.padEnd(COL_PRIORITY_WIDTH)}</Text>
              <Text dimColor={dimmed} wrap="truncate">{getDuration(entry, now).padEnd(COL_DURATION_WIDTH)}</Text>
            </Box>
          ))
        )}
      </Box>

      {/* Scroll hint / footer */}
      <Text color="gray" dimColor={dimmed} wrap="truncate">
        {showScrollHint
          ? `[${clampedScroll + 1}-${Math.min(clampedScroll + visibleRows, entries.length)}/${entries.length}] ↑↓ scroll`
          : '─'.repeat(Math.max(0, safeWidth - 2))}
      </Text>

      {/* Summary row */}
      <Text color="gray" dimColor={dimmed} wrap="truncate">
        {`Done today: ${summary.doneTodayCount}  Failed: ${summary.failedCount}  Avg: ${avgText}`}
      </Text>
    </Box>
  )
}

const ActiveStoriesPanelMemo = React.memo(ActiveStoriesPanelInner, (prev, next) =>
  prev.isFocused === next.isFocused &&
  prev.dimmed === next.dimmed &&
  prev.width === next.width &&
  prev.height === next.height,
)

export function ActiveStoriesPanel(props: ActiveStoriesPanelProps): React.JSX.Element {
  return React.createElement(ActiveStoriesPanelMemo, props)
}
