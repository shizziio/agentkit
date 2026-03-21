import { useState, useCallback } from 'react'

import type { EpicNode, StoryNode, TaskNode } from '@core/TraceTypes.js'
import type { VisibleLine } from './TraceTypes.js'

export interface TraceTreeState {
  expandedEpics: Set<number>
  expandedStories: Set<number>
  focusedLine: number
  selectedTaskId: number | null
  detailScrollIndex: number
  showDetail: boolean
}

export interface TraceTreeActions {
  toggleEpic: (epicId: number) => void
  toggleStory: (storyId: number) => void
  moveFocusUp: () => void
  moveFocusDown: (totalLines: number) => void
  selectTask: (taskId: number) => void
  clearSelection: () => void
  openDetail: () => void
  closeDetail: () => void
  scrollDetailPageUp: (pageSize: number) => void
  scrollDetailPageDown: (pageSize: number, maxLines: number) => void
}

export function buildVisibleLines(
  epics: EpicNode[],
  storiesByEpic: Map<number, StoryNode[]>,
  tasksByStory: Map<number, TaskNode[]>,
  expandedEpics: Set<number>,
  expandedStories: Set<number>,
): VisibleLine[] {
  const lines: VisibleLine[] = []

  for (const epic of epics) {
    const isEpicExpanded = expandedEpics.has(epic.id)
    lines.push({ kind: 'epic', depth: 0, node: epic, isExpanded: isEpicExpanded })

    if (!isEpicExpanded) continue

    const stories = storiesByEpic.get(epic.id) ?? []
    for (const story of stories) {
      const isStoryExpanded = expandedStories.has(story.id)
      lines.push({ kind: 'story', depth: 1, node: story, isExpanded: isStoryExpanded })

      if (!isStoryExpanded) continue

      const storyTasks = tasksByStory.get(story.id) ?? []
      for (const task of storyTasks) {
        lines.push({ kind: 'task', depth: 2, node: task })
      }
    }
  }

  return lines
}

export function useTraceTree(): TraceTreeState & TraceTreeActions {
  const [expandedEpics, setExpandedEpics] = useState<Set<number>>(new Set())
  const [expandedStories, setExpandedStories] = useState<Set<number>>(new Set())
  const [focusedLine, setFocusedLine] = useState(0)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [detailScrollIndex, setDetailScrollIndex] = useState(0)
  const [showDetail, setShowDetail] = useState(false)

  const toggleEpic = useCallback((epicId: number) => {
    setExpandedEpics(prev => {
      const next = new Set(prev)
      if (next.has(epicId)) {
        next.delete(epicId)
      } else {
        next.add(epicId)
      }
      return next
    })
  }, [])

  const toggleStory = useCallback((storyId: number) => {
    setExpandedStories(prev => {
      const next = new Set(prev)
      if (next.has(storyId)) {
        next.delete(storyId)
      } else {
        next.add(storyId)
      }
      return next
    })
  }, [])

  const moveFocusUp = useCallback(() => {
    setFocusedLine(prev => Math.max(0, prev - 1))
  }, [])

  const moveFocusDown = useCallback((totalLines: number) => {
    setFocusedLine(prev => Math.min(totalLines - 1, prev + 1))
  }, [])

  const selectTask = useCallback((taskId: number) => {
    setSelectedTaskId(taskId)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedTaskId(null)
    setShowDetail(false)
  }, [])

  const openDetail = useCallback(() => {
    setShowDetail(true)
    setDetailScrollIndex(0)
  }, [])

  const closeDetail = useCallback(() => {
    setShowDetail(false)
  }, [])

  const scrollDetailPageUp = useCallback((pageSize: number) => {
    setDetailScrollIndex(prev => Math.max(0, prev - pageSize))
  }, [])

  const scrollDetailPageDown = useCallback((pageSize: number, maxLines: number) => {
    setDetailScrollIndex(prev => Math.min(Math.max(0, maxLines - pageSize), prev + pageSize))
  }, [])

  return {
    expandedEpics,
    expandedStories,
    focusedLine,
    selectedTaskId,
    detailScrollIndex,
    showDetail,
    toggleEpic,
    toggleStory,
    moveFocusUp,
    moveFocusDown,
    selectTask,
    clearSelection,
    openDetail,
    closeDetail,
    scrollDetailPageUp,
    scrollDetailPageDown,
  }
}
