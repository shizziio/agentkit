import { useState, useEffect, useRef, useCallback } from 'react'
import { useInput } from 'ink'

import type { ReplayService } from '@core/ReplayService.js'
import type { ReplayEvent, ReplayPlayerState, PlaybackSpeed } from './ReplayTypes.js'

interface UseReplayPlayerProps {
  replayService: ReplayService
  taskId: number
  onQuit: () => void
}

interface UseReplayPlayerResult {
  state: ReplayPlayerState
  currentEvent: ReplayEvent | null
}

const PAGE_SIZE = 100
const PREFETCH_THRESHOLD = 20

function parseLogToEvent(log: {
  id: number
  sequence: number
  eventType: string
  eventData: string
  createdAt: string
}): ReplayEvent {
  let eventData: Record<string, unknown> = {}
  try {
    eventData = JSON.parse(log.eventData) as Record<string, unknown>
  } catch {
    eventData = { raw: log.eventData }
  }
  return {
    id: log.id,
    sequence: log.sequence,
    eventType: log.eventType,
    eventData,
    createdAt: new Date(log.createdAt).getTime(),
  }
}

export function useReplayPlayer({
  replayService,
  taskId,
  onQuit,
}: UseReplayPlayerProps): UseReplayPlayerResult {
  const onQuitRef = useRef(onQuit)
  useEffect(() => {
    onQuitRef.current = onQuit
  })

  const [state, setState] = useState<ReplayPlayerState>(() => {
    const task = replayService.getTask(taskId)
    const totalEvents = replayService.getTotalLogCount(taskId)
    const firstPage =
      totalEvents > 0 ? replayService.getLogsPage(taskId, 0, PAGE_SIZE).map(parseLogToEvent) : []
    const firstTs = firstPage[0]?.createdAt ?? Date.now()
    const lastTs = firstPage[firstPage.length - 1]?.createdAt ?? firstTs
    return {
      taskMeta: {
        taskId,
        stageName: task?.stageName ?? '',
        workerModel: task?.workerModel ?? null,
        durationMs: task?.durationMs ?? null,
        inputTokens: task?.inputTokens ?? null,
        outputTokens: task?.outputTokens ?? null,
      },
      totalEvents,
      loadedEvents: firstPage,
      currentIndex: -1,
      playbackState: 'playing',
      speed: 1,
      firstTimestampMs: firstTs,
      lastTimestampMs: lastTs,
      playbackOffsetMs: 0,
      playbackResumedAt: Date.now(),
    }
  })

  const loadingRef = useRef(false)
  const playbackStateRef = useRef<ReplayPlayerState['playbackState']>(state.playbackState)

  useEffect(() => {
    playbackStateRef.current = state.playbackState
  }, [state.playbackState])

  useEffect(() => {
    if (state.totalEvents === 0) {
      onQuitRef.current()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const interval = setInterval(() => {
      if (playbackStateRef.current !== 'playing') return

      setState(prev => {
        if (prev.playbackState !== 'playing') return prev

        const virtualElapsedMs =
          prev.playbackOffsetMs + (Date.now() - prev.playbackResumedAt) * prev.speed
        const targetTs = prev.firstTimestampMs + virtualElapsedMs

        let newIndex = prev.currentIndex
        for (let i = prev.loadedEvents.length - 1; i >= 0; i--) {
          const ev = prev.loadedEvents[i]
          if (ev !== undefined && ev.createdAt <= targetTs) {
            newIndex = i
            break
          }
        }

        if (newIndex <= prev.currentIndex && prev.currentIndex >= 0) {
          newIndex = prev.currentIndex
        }

        if (newIndex === prev.currentIndex && prev.currentIndex >= 0) {
          return prev
        }

        let updated: ReplayPlayerState = { ...prev, currentIndex: newIndex }

        if (newIndex >= prev.totalEvents - 1 && prev.totalEvents > 0) {
          updated = { ...updated, playbackState: 'paused' }
        }

        return updated
      })
    }, 50)

    return () => clearInterval(interval)
  }, [replayService, taskId])

  useEffect(() => {
    const shouldPrefetch =
      !loadingRef.current &&
      state.currentIndex >= state.loadedEvents.length - PREFETCH_THRESHOLD &&
      state.loadedEvents.length < state.totalEvents

    if (!shouldPrefetch) return

    loadingRef.current = true
    const offset = state.loadedEvents.length
    const newLogs = replayService.getLogsPage(taskId, offset, PAGE_SIZE)
    const newEvents = newLogs.map(parseLogToEvent)
    loadingRef.current = false

    setState(prev => {
      if (prev.loadedEvents.length !== offset) return prev
      const allEvents = [...prev.loadedEvents, ...newEvents]
      const lastCreatedAt =
        allEvents[allEvents.length - 1]?.createdAt ?? prev.lastTimestampMs
      return { ...prev, loadedEvents: allEvents, lastTimestampMs: lastCreatedAt }
    })
  }, [state.currentIndex, state.loadedEvents.length, state.totalEvents, replayService, taskId])

  const getVirtualElapsed = useCallback(
    (prev: ReplayPlayerState) =>
      prev.playbackOffsetMs + (Date.now() - prev.playbackResumedAt) * prev.speed,
    []
  )

  useInput((input, key) => {
    if (input === 'q' || input === 'Q') {
      onQuitRef.current()
      return
    }

    setState(prev => {
      const virtualElapsed = getVirtualElapsed(prev)

      if (input === ' ') {
        if (prev.playbackState === 'playing') {
          return { ...prev, playbackState: 'paused', playbackOffsetMs: virtualElapsed }
        }
        return {
          ...prev,
          playbackState: 'playing',
          playbackOffsetMs: virtualElapsed,
          playbackResumedAt: Date.now(),
        }
      }

      if (key.leftArrow) {
        const newIndex = Math.max(0, prev.currentIndex)
        const ev = prev.loadedEvents[newIndex]
        const offset = ev !== undefined ? ev.createdAt - prev.firstTimestampMs : 0
        return {
          ...prev,
          currentIndex: newIndex,
          playbackState: 'paused',
          playbackOffsetMs: offset,
        }
      }

      if (key.rightArrow) {
        const newIndex = Math.min(prev.loadedEvents.length - 1, prev.currentIndex + 1)
        const ev = prev.loadedEvents[newIndex]
        const offset = ev !== undefined ? ev.createdAt - prev.firstTimestampMs : virtualElapsed
        return {
          ...prev,
          currentIndex: newIndex,
          playbackState: 'paused',
          playbackOffsetMs: offset,
        }
      }

      if (input === '1' || input === '2' || input === '4' || input === '8') {
        const speed = parseInt(input, 10) as PlaybackSpeed
        return {
          ...prev,
          speed,
          playbackOffsetMs: virtualElapsed,
          playbackResumedAt: Date.now(),
        }
      }

      return prev
    })
  }, { isActive: true })

  const currentEvent =
    state.currentIndex >= 0 && state.currentIndex < state.loadedEvents.length
      ? (state.loadedEvents[state.currentIndex] ?? null)
      : null

  return { state, currentEvent }
}
