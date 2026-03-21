import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import chalk from 'chalk'

import { HistoryService } from '@core/HistoryService.js'
import { ShipService } from '@core/ShipService.js'
import type {
  HistoryStory,
  HistoryTaskChainItem,
  HistoryStatistics,
  HistoryFilter,
} from '@core/HistoryTypes.js'
import { formatLocalDateTime } from '@shared/FormatTime.js'
import { ScrollablePanel } from '../shared/ScrollablePanel.js'
import { useProjectId, useDb, useAppStore } from '@ui/stores/appStore.js'

interface Props {
  filter: HistoryFilter
  onExit: () => void
  compact?: boolean
}

type Step = 'list' | 'chain' | 'status_picker'

const VISIBLE_LIST_FULL = 10
const VISIBLE_LIST_COMPACT = 6

const STATUS_OPTIONS = ['draft', 'queued', 'in_progress', 'done', 'cancelled', 'failed'] as const

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 1) + '…' : s
}

function statusColor(status: string): string {
  if (status === 'done') return 'green'
  if (status === 'failed' || status === 'blocked') return 'red'
  if (status === 'queued') return 'yellow'
  if (status === 'cancelled') return 'gray'
  if (status === 'in_progress') return 'cyan'
  return 'white'
}

export function HistoryWizard({
  filter,
  onExit,
  compact = false,
}: Props): React.JSX.Element {
  const projectId = useProjectId()
  const db = useDb()
  // pipelineConfig and eventBus are optional — used only for the ship (P) hotkey
  const pipelineConfig = useAppStore.getState().pipelineConfig
  const eventBus = useAppStore.getState().eventBus
  const { stdout } = useStdout()
  const VISIBLE_LIST = compact ? VISIBLE_LIST_COMPACT : VISIBLE_LIST_FULL
  const serviceRef = useRef(new HistoryService(db))
  const shipServiceRef = useRef(new ShipService(db, eventBus ?? undefined))
  const [step, setStep] = useState<Step>('list')
  const [stories, setStories] = useState<HistoryStory[]>([])
  const [stats, setStats] = useState<HistoryStatistics | null>(null)
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [selectedStoryId, setSelectedStoryId] = useState<number | null>(null)
  const [chain, setChain] = useState<HistoryTaskChainItem[]>([])
  const [statusPickerCursor, setStatusPickerCursor] = useState(0)
  const [actionMessage, setActionMessage] = useState('')

  const loadStories = (): void => {
    const service = serviceRef.current
    const loadedStats = service.getStatistics(projectId)
    const loadedStories = service.getStories(projectId, filter)
    setStats(loadedStats)
    setStories(loadedStories)
  }

  useEffect(() => {
    loadStories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filter.epicId, filter.status, filter.last])

  useEffect(() => {
    if (step === 'chain' && selectedStoryId !== null) {
      const loadedChain = serviceRef.current.getTaskChain(selectedStoryId)
      setChain(loadedChain)
    }
  }, [step, selectedStoryId])

  // List input
  useInput(
    (input, key) => {
      if (key.upArrow) {
        setCursor(c => {
          const next = Math.max(0, c - 1)
          setScrollOffset(o => (next < o ? next : o))
          return next
        })
      } else if (key.downArrow) {
        setCursor(c => {
          const next = Math.min(stories.length - 1, c + 1)
          setScrollOffset(o => (next >= o + VISIBLE_LIST ? next - VISIBLE_LIST + 1 : o))
          return next
        })
      } else if (key.return) {
        const story = stories[cursor]
        if (story) {
          setSelectedStoryId(story.id)
          setStep('chain')
        }
      } else if (input === 's' || input === 'S') {
        const story = stories[cursor]
        if (story) {
          setSelectedStoryId(story.id)
          const currentIdx = STATUS_OPTIONS.indexOf(story.status as (typeof STATUS_OPTIONS)[number])
          setStatusPickerCursor(currentIdx >= 0 ? currentIdx : 0)
          setStep('status_picker')
        }
      } else if (input === 'p' || input === 'P') {
        // Ship (push) a draft/cancelled story into the queue
        const story = stories[cursor]
        if (story && pipelineConfig) {
          const firstStage = pipelineConfig.stages[0]?.name
          if (firstStage) {
            try {
              shipServiceRef.current.shipStories([story.id], firstStage, pipelineConfig.team)
              setActionMessage(`Queued: ${story.storyKey}`)
              loadStories()
            } catch (e) {
              setActionMessage(e instanceof Error ? e.message : String(e))
            }
            setTimeout(() => setActionMessage(''), 3000)
          }
        }
      } else if (input === 'd' || input === 'D') {
        // Delete story
        const story = stories[cursor]
        if (story) {
          try {
            serviceRef.current.deleteStory(story.id)
            setActionMessage(`Deleted story: ${story.storyKey}`)
            // Adjust cursor if we are deleting the last item in the list
            if (cursor > 0 && cursor === stories.length - 1) {
              setCursor(c => c - 1)
            }
            loadStories()
          } catch (e) {
            setActionMessage(e instanceof Error ? e.message : String(e))
          }
          setTimeout(() => setActionMessage(''), 3000)
        }
      } else if (input === 'q' || input === 'Q' || key.escape) {
        onExit()
      }
    },
    { isActive: step === 'list' }
  )

  // Status picker input
  useInput(
    (input, key) => {
      if (key.upArrow) {
        setStatusPickerCursor(c => Math.max(0, c - 1))
      } else if (key.downArrow) {
        setStatusPickerCursor(c => Math.min(STATUS_OPTIONS.length - 1, c + 1))
      } else if (key.return) {
        const newStatus = STATUS_OPTIONS[statusPickerCursor]
        if (selectedStoryId !== null && newStatus !== undefined) {
          serviceRef.current.changeStoryStatus(selectedStoryId, newStatus)
          loadStories()
        }
        setStep('list')
      } else if (key.escape || input === 'q' || input === 'Q') {
        setStep('list')
      }
    },
    { isActive: step === 'status_picker' }
  )

  // Chain view escape handler
  useInput(
    (_input, key) => {
      if (key.escape) {
        setStep('list')
      }
    },
    { isActive: step === 'chain' }
  )

  if (step === 'list') {
    const visibleStories = stories.slice(scrollOffset, scrollOffset + VISIBLE_LIST)
    const avgDur =
      stats && stats.averageDurationPerStage.length > 0
        ? formatDuration(
            stats.averageDurationPerStage.reduce((a, s) => a + s.averageDurationMs, 0) /
              stats.averageDurationPerStage.length
          )
        : '00:00'

    return (
      <Box flexDirection="column" padding={compact ? 0 : 1}>
        <Text bold color="cyan">
          History
        </Text>
        {stats && (
          <Text>
            Total completed: {stats.totalCompleted} | Avg stage duration: {avgDur}
          </Text>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text bold>{'Key'.padEnd(10)}</Text>
            <Text bold>{'Title'.padEnd(42)}</Text>
            <Text bold>{'Status'.padEnd(12)}</Text>
            <Text bold>{'Stages'.padEnd(8)}</Text>
            <Text bold>{'Attempts'.padEnd(10)}</Text>
            <Text bold>{'Duration'.padEnd(10)}</Text>
            <Text bold>{'Completed'}</Text>
          </Box>
          {visibleStories.map((story, i) => {
            const actualIdx = scrollOffset + i
            const isCursor = actualIdx === cursor
            return (
              <Box key={story.id}>
                <Text color={isCursor ? 'cyan' : undefined}>
                  {isCursor ? '>' : ' '}
                  {story.storyKey.padEnd(9)}
                  {truncate(story.title, 40).padEnd(42)}
                </Text>
                <Text color={statusColor(story.status)}>{story.status.padEnd(12)}</Text>
                <Text color={isCursor ? 'cyan' : undefined}>
                  {String(story.stagesPassed.length).padEnd(8)}
                  {String(story.totalAttempts).padEnd(10)}
                  {formatDuration(story.totalDurationMs).padEnd(10)}
                  {story.completedAt ? formatLocalDateTime(story.completedAt).slice(0, 10) : 'N/A'}
                </Text>
              </Box>
            )
          })}
        </Box>
        {actionMessage ? (
          <Text color="green">{actionMessage}</Text>
        ) : (
          <Text color="gray">
            [Enter] View chain  [S] Change status{pipelineConfig ? '  [P] Push to queue' : ''}  [D] Delete  [Q] Quit
          </Text>
        )}
      </Box>
    )
  }

  if (step === 'status_picker') {
    const story = stories.find(s => s.id === selectedStoryId)
    return (
      <Box flexDirection="column" padding={compact ? 0 : 1}>
        <Text bold color="cyan">
          Change Status
        </Text>
        {story && (
          <Text color="gray">
            {story.storyKey}: {truncate(story.title, 50)}
          </Text>
        )}
        <Box flexDirection="column" marginTop={1}>
          {STATUS_OPTIONS.map((status, i) => (
            <Box key={status}>
              <Text color={i === statusPickerCursor ? 'cyan' : statusColor(status)}>
                {i === statusPickerCursor ? '> ' : '  '}
                {status}
                {story?.status === status ? ' (current)' : ''}
              </Text>
            </Box>
          ))}
        </Box>
        <Text color="gray">[↑↓] Navigate [Enter] Confirm [Esc] Cancel</Text>
      </Box>
    )
  }

  const selectedStory = stories.find(s => s.id === selectedStoryId)
  
  // Format chain items for ScrollablePanel
  const chainLines: string[] = []
  chain.forEach(item => {
    const color = statusColor(item.status)
    const chalkFn = 
      color === 'green' ? chalk.green :
      color === 'red' ? chalk.red :
      color === 'yellow' ? chalk.yellow :
      color === 'gray' ? chalk.gray :
      color === 'cyan' ? chalk.cyan : chalk.white;

    const line = [
      String(item.id).padEnd(6),
      item.stageName.padEnd(12),
      item.status.padEnd(10),
      `attempt ${item.attempt}`.padEnd(12),
      item.durationMs !== null ? formatDuration(item.durationMs).padEnd(10) : 'N/A'.padEnd(10),
      item.parentId !== null ? `→ ${item.parentId}` : 'ROOT'
    ].join('')
    
    chainLines.push(chalkFn(line))
    if (item.input !== null) chainLines.push(chalk.gray(` in: ${truncate(item.input, 100)}`))
    if (item.output !== null) chainLines.push(chalk.gray(` out: ${truncate(item.output, 100)}`))
    chainLines.push('') // spacer
  })

  const availableHeight = stdout?.rows ? stdout.rows - 10 : 15

  return (
    <Box flexDirection="column" padding={compact ? 0 : 1}>
      <ScrollablePanel
        lines={chainLines}
        height={availableHeight}
        title={selectedStory?.title ?? 'Task Chain'}
        onExit={() => setStep('list')}
        isActive={step === 'chain'}
        autoScrollToBottom={false}
      />
      <Box marginTop={1}>
        <Text color="gray">[Esc] Back to list</Text>
      </Box>
    </Box>
  )
}
