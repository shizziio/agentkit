import React, { useEffect } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'

import type { TaskNode, TraceTaskLog } from '@core/TraceTypes.js'
import type { TraceDataState, TraceDataActions } from '@ui/trace/useTraceData.js'
import type { TraceTreeState, TraceTreeActions } from '@ui/trace/useTraceTree.js'
import type { VisibleLine } from '@ui/trace/TraceTypes.js'
import { TraceTreePanel } from '@ui/trace/TraceTreePanel.js'
import { TraceDetailFullscreen } from '@ui/trace/TraceDetailFullscreen.js'
import { TraceService } from '@core/TraceService.js'
import type { IResetService } from '@core/ResetTypes.js'

interface TraceModeLayoutProps {
  data: TraceDataState & TraceDataActions
  tree: TraceTreeState & TraceTreeActions
  visibleLines: VisibleLine[]
  selectedTask: TaskNode | null
  currentLogs: TraceTaskLog[]
  onExit: () => void
  resetService: IResetService
  activeTeam?: string
}

function formatJson(val: string | null | undefined): string {
  if (val === null || val === undefined) return '(none)';
  try {
    return JSON.stringify(JSON.parse(val), null, 2);
  } catch {
    return val;
  }
}

/** Quick preview panel shown on the right when a task is focused */
function TaskPreview({ task, height }: { task: TaskNode; height: number }): React.JSX.Element {
  const color = TraceService.statusColor(task.status);
  const outputLines = formatJson(task.output).split('\n');
  // Show as many output lines as fit, minus metadata rows
  const metaRows = 6;
  const maxOutputLines = Math.max(0, height - metaRows);
  const visibleOutput = outputLines.slice(0, maxOutputLines);
  const truncated = outputLines.length > maxOutputLines;

  return (
    <Box flexDirection="column" paddingLeft={1} overflow="hidden">
      <Text bold color="cyan">Task #{task.id}</Text>
      <Text wrap="truncate"><Text dimColor>stage:  </Text><Text bold>{task.stageName}</Text></Text>
      <Text wrap="truncate"><Text dimColor>status: </Text><Text bold color={color}>{task.status}</Text></Text>
      <Text wrap="truncate"><Text dimColor>model:  </Text><Text>{task.workerModel ?? '—'}</Text></Text>
      <Text wrap="truncate"><Text dimColor>time:   </Text><Text>{TraceService.formatDuration(task.durationMs)}</Text></Text>
      <Text bold color="cyan" dimColor>── Output ──</Text>
      {visibleOutput.map((line, i) => (
        <Text key={i} wrap="truncate">{line}</Text>
      ))}
      {truncated && <Text dimColor>... ({outputLines.length - maxOutputLines} more lines, press [d] for full)</Text>}
    </Box>
  );
}

export function TraceModeLayout({
  data,
  tree,
  visibleLines,
  selectedTask,
  currentLogs,
  onExit,
}: TraceModeLayoutProps): React.JSX.Element {
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24

  const focusedLineData = visibleLines[tree.focusedLine]

  // Auto-select task when navigating to a task line
  useEffect(() => {
    if (focusedLineData?.kind === 'task') {
      tree.selectTask(focusedLineData.node.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.focusedLine, focusedLineData?.kind === 'task' ? focusedLineData.node.id : null])

  const pageSize = Math.max(1, Math.floor((rows - 6) / 2))

  // Input handler for detail fullscreen view
  useInput(
    (input, key) => {
      if (input === 'q' || input === 'Q') {
        tree.closeDetail()
        return
      }
      if (key.upArrow) {
        tree.scrollDetailPageUp(pageSize)
        return
      }
      if (key.downArrow) {
        tree.scrollDetailPageDown(pageSize, 9999)
        return
      }
    },
    { isActive: tree.showDetail },
  )

  // Input handler for tree view
  useInput(
    (input, key) => {
      if (input === 'q' || input === 'Q') {
        onExit()
        return
      }


      if (key.upArrow) {
        tree.moveFocusUp()
        return
      }

      if (key.downArrow) {
        tree.moveFocusDown(visibleLines.length)
        return
      }

      if (key.return) {
        if (!focusedLineData) return
        if (focusedLineData.kind === 'epic') {
          tree.toggleEpic(focusedLineData.node.id)
        } else if (focusedLineData.kind === 'story') {
          tree.toggleStory(focusedLineData.node.id)
        }
        return
      }

      if (input === 'd' || input === 'D') {
        if (tree.selectedTaskId !== null) {
          tree.openDetail()
        }
        return
      }

      if (input === 'm' || input === 'M') {
        if (focusedLineData?.kind === 'task') {
          data.markTaskDone(focusedLineData.node.storyId, focusedLineData.node.id)
        } else if (focusedLineData?.kind === 'story') {
          data.markStoryDone(focusedLineData.node.epicId, focusedLineData.node.id)
        }
        return
      }

      // Task-level actions
      if (focusedLineData?.kind === 'task') {
        if (input === 'x' || input === 'X') {
          data.deleteTask(focusedLineData.node.storyId, focusedLineData.node.id)
          return
        }
        if (input === 'e' || input === 'E') {
          data.retryTask(focusedLineData.node.storyId, focusedLineData.node.id)
          return
        }
        if (input === 'p' || input === 'P') {
          data.pushNextStage(focusedLineData.node.storyId, focusedLineData.node.id)
          return
        }
      }

      // R (uppercase) = refresh (only if not on a task, to avoid conflict with lowercase r=retry)
      if (input === 'R') {
        data.refresh()
        return
      }
    },
    { isActive: !tree.showDetail },
  )

  // ---------- Fullscreen Detail View ----------
  if (tree.showDetail && selectedTask !== null) {
    return (
      <TraceDetailFullscreen
        task={selectedTask}
        logs={currentLogs}
        scrollIndex={tree.detailScrollIndex}
        height={rows - 2}
      />
    )
  }

  // ---------- Split Panel: Tree + Preview ----------
  const totalEpics = data.summary?.totalEpics ?? data.epics.length
  const totalStories = data.summary?.totalStories ?? 0
  const totalTasks = data.summary?.totalTasks ?? 0
  const panelHeight = rows - 5

  return (
    <Box flexDirection="column" width="100%" height={rows - 2}>
      <Box height={panelHeight} overflow="hidden">
        {/* Left: Tree */}
        <Box
          width="55%"
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          overflow="hidden"
        >
          <Text bold color="cyan">
            {' '}Task Navigator
          </Text>
          <TraceTreePanel
            lines={visibleLines}
            focusedLine={tree.focusedLine}
            showTeamOnTask={false}
            height={panelHeight - 3}
          />
        </Box>
        {/* Right: Quick Preview */}
        <Box
          width="45%"
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          overflow="hidden"
        >
          {selectedTask !== null ? (
            <TaskPreview task={selectedTask} height={panelHeight - 2} />
          ) : (
            <Box justifyContent="center" alignItems="center" flexGrow={1}>
              <Text dimColor>Navigate to a task to preview</Text>
            </Box>
          )}
        </Box>
      </Box>
      <Box flexShrink={0} borderStyle="single" borderColor="gray" width="100%">
        <Text bold color="cyan">trace  </Text>
        <Text color="gray">{totalEpics}E {totalStories}S {totalTasks}T  </Text>
        <Text dimColor>[↑↓] Navigate  [Enter] Expand  [d] Detail  [m] Done  [e] Retry  [p] Push  [x] Delete  [R] Refresh  [Q] Exit</Text>
      </Box>
    </Box>
  )
}
