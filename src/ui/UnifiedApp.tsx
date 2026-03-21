import React, { useState, useEffect } from 'react'

import type { TaskNode, TraceTaskLog } from '@core/TraceTypes.js'

import { DashboardApp } from '@ui/dashboard/DashboardApp.js'
import type { DashboardProps } from '@ui/dashboard/shared/DashboardTypes.js'
import { useTraceData } from '@ui/trace/useTraceData.js'
import { useTraceTree, buildVisibleLines } from '@ui/trace/useTraceTree.js'

import { TraceModeLayout } from './dashboard/layouts/TraceModeLayout.js'

export interface UnifiedAppProps extends DashboardProps {}

export function UnifiedApp(props: UnifiedAppProps): React.JSX.Element {
  const { projectId, traceService, resetService, eventBus } = props

  const [pipelineConfig, setPipelineConfig] = useState(props.pipelineConfig)
  const [mode, setMode] = useState<'overview' | 'trace'>('overview')
  const [currentLogs, setCurrentLogs] = useState<TraceTaskLog[]>([])

  useEffect(() => {
    const onReconfigured = (newCfg: any) => {
      setPipelineConfig(newCfg)
    }
    eventBus.on('pipeline:reconfigured', onReconfigured)
    return () => {
      eventBus.off('pipeline:reconfigured', onReconfigured)
    }
  }, [eventBus])

  const traceData = useTraceData(traceService, resetService, projectId, pipelineConfig.team || null)
  const traceTree = useTraceTree()

  const { storiesByEpic, tasksByStory, loadStoriesForEpic, loadTasksForStory, getTaskLogs } =
    traceData

  const visibleLines = buildVisibleLines(
    traceData.epics,
    storiesByEpic,
    tasksByStory,
    traceTree.expandedEpics,
    traceTree.expandedStories,
  )

  // Load stories when an epic is expanded
  useEffect(() => {
    for (const epicId of traceTree.expandedEpics) {
      if (!storiesByEpic.has(epicId)) {
        loadStoriesForEpic(epicId)
      }
    }
  }, [traceTree.expandedEpics, storiesByEpic, loadStoriesForEpic])

  // Load tasks when a story is expanded
  useEffect(() => {
    for (const storyId of traceTree.expandedStories) {
      if (!tasksByStory.has(storyId)) {
        loadTasksForStory(storyId)
      }
    }
  }, [traceTree.expandedStories, tasksByStory, loadTasksForStory])

  // Load logs when detail view is open and a task is selected
  useEffect(() => {
    if (traceTree.showDetail && traceTree.selectedTaskId !== null) {
      setCurrentLogs(getTaskLogs(traceTree.selectedTaskId))
    }
  }, [traceTree.showDetail, traceTree.selectedTaskId, getTaskLogs])

  const selectedTask: TaskNode | null =
    traceTree.selectedTaskId !== null
      ? (() => {
          for (const tasks of tasksByStory.values()) {
            const found = tasks.find(t => t.id === traceTree.selectedTaskId)
            if (found) return found
          }
          return null
        })()
      : null

  if (mode === 'trace') {
    return (
      <TraceModeLayout
        data={traceData}
        tree={traceTree}
        visibleLines={visibleLines}
        selectedTask={selectedTask}
        currentLogs={currentLogs}
        resetService={resetService}
        activeTeam={pipelineConfig.team || undefined}
        onExit={() => {
          traceData.refresh()
          setMode('overview')
        }}
      />
    )
  }

  return (
      <DashboardApp
        {...props}
        pipelineConfig={pipelineConfig}
        onEnterTrace={() => {
          traceData.refresh()
          setMode('trace')
        }}
      />
  )
}
