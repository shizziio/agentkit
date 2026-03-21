import { useEffect, useReducer, useRef } from 'react'
import type { Dispatch } from 'react'

import type { EventBus } from '@core/EventBus.js'
import type { StreamEvent, StoryCompleteEvent, LogEvent } from '@core/EventTypes.js'
import { MAX_ACTIVITY_EVENTS, ACTIVITY_VISIBLE_ROWS } from '@config/defaults.js'
import { formatLocalTime, formatLocalTimeMs } from '@shared/FormatTime.js'

// Module-level ring buffer — survives component remounts (e.g. navigating to trace and back)
const PRELOAD_COUNT = 10
const RING_BUFFER_SIZE = MAX_ACTIVITY_EVENTS
let activityRingBuffer: Array<Omit<ActivityEvent, 'id'>> = []

export function clearRingBuffer(): void {
  activityRingBuffer = []
}

function pushToRingBuffer(event: Omit<ActivityEvent, 'id'>): void {
  activityRingBuffer.push(event)
  if (activityRingBuffer.length > RING_BUFFER_SIZE) {
    activityRingBuffer.shift()
  }
}

export interface ActivityEvent {
  id: number
  timestamp: string
  stageName: string
  icon: string
  label: string
  message: string
  isAppLog?: boolean
  completionData?: {
    storyTitle: string
    stageDurations: Array<{ stageName: string; durationMs: number }>
    totalDurationMs: number
    totalAttempts: number
  }
}

interface ActivityState {
  events: ActivityEvent[]
  scrollIndex: number
  isFollowing: boolean
  nextId: number
}

export type ActivityAction =
  | { type: 'ADD_EVENT'; event: Omit<ActivityEvent, 'id'> }
  | { type: 'ADD_COMPLETION'; event: StoryCompleteEvent }
  | { type: 'SCROLL_UP' }
  | { type: 'SCROLL_DOWN' }

export interface UseLiveActivityResult {
  events: ActivityEvent[]
  scrollIndex: number
  isFollowing: boolean
  dispatch: Dispatch<ActivityAction>
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

function formatData(data?: Record<string, unknown>): string {
  if (!data) return ''
  const entries = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : String(v)
      return `${k}=${s.length > 50 ? s.slice(0, 47) + '…' : s}`
    })
  return entries.length > 0 ? `  [${entries.join(' ')}]` : ''
}

function formatLogEvent(event: LogEvent): Omit<ActivityEvent, 'id'> {
  let icon: string
  switch (event.level) {
    case 'WARN':  icon = '⚠️'; break
    case 'ERROR': icon = '🔴'; break
    default:      icon = '📋'
  }
  return {
    timestamp: formatLocalTime(event.timestamp),
    stageName: event.module,
    icon,
    label: event.level.toLowerCase(),
    message: truncate(event.message + formatData(event.data), 140),
    isAppLog: true,
  }
}

function formatStreamEvent(event: StreamEvent): Omit<ActivityEvent, 'id'> {
  const timestamp = formatLocalTimeMs(event.timestamp)
  const stageName = event.stageName

  let icon: string
  let label: string
  let message: string

  switch (event.type) {
    case 'thinking': {
      icon = '🧠'
      label = 'thinking'
      const thinkingText = event.data.thinking ?? event.data.text ?? ''
      message = truncate(thinkingText)
      break
    }
    case 'tool_use': {
      const toolName = event.data.toolName ?? ''
      const toolInput = event.data.toolInput

      const toolIcons: Record<string, string> = {
        Read: '📖',
        Edit: '✏️',
        Bash: '⚡',
        Grep: '🔍',
      }
      icon = toolIcons[toolName] ?? '🔧'
      label = toolName

      if (!toolInput) {
        message = toolName
      } else if (toolName === 'Read' || toolName === 'Edit') {
        const path = (toolInput['file_path'] ?? toolInput['path'] ?? '') as string
        message = truncate(String(path))
      } else if (toolName === 'Bash') {
        message = truncate(String(toolInput['command'] ?? ''))
      } else if (toolName === 'Grep') {
        message = truncate(String(toolInput['pattern'] ?? ''))
      } else {
        message = truncate(JSON.stringify(toolInput))
      }
      break
    }
    case 'tool_result': {
      icon = '✅'
      label = 'result'
      const resultText = event.data.toolResult ?? event.data.text ?? ''
      const firstLine = resultText.split('\n')[0] ?? ''
      message = truncate(firstLine)
      break
    }
    case 'text': {
      icon = '💬'
      label = 'text'
      message = truncate(event.data.text ?? '')
      break
    }
    case 'error': {
      icon = '✖'
      label = 'error'
      message = truncate(event.data.error ?? '')
      break
    }
    case 'done': {
      icon = '✓'
      label = 'done'
      message = typeof event.data.inputTokens === 'number'
        ? `in=${event.data.inputTokens} out=${event.data.outputTokens ?? 0} tokens`
        : ''
      break
    }
    default: {
      icon = '•'
      label = event.type
      message = ''
    }
  }

  return { timestamp, stageName, icon, label, message }
}

function reducer(state: ActivityState, action: ActivityAction): ActivityState {
  switch (action.type) {
    case 'ADD_EVENT': {
      const newEvent: ActivityEvent = { id: state.nextId, ...action.event }
      const newEvents = [...state.events, newEvent].slice(-MAX_ACTIVITY_EVENTS)
      const newScrollIndex = state.isFollowing
        ? Math.max(0, newEvents.length - ACTIVITY_VISIBLE_ROWS)
        : state.scrollIndex
      return {
        ...state,
        events: newEvents,
        scrollIndex: newScrollIndex,
        nextId: state.nextId + 1,
      }
    }
    case 'ADD_COMPLETION': {
      const now = formatLocalTime(new Date().toISOString())
      const { storyTitle, stageDurations, totalAttempts, durationMs } = action.event
      const completionEvent: ActivityEvent = {
        id: state.nextId,
        timestamp: now,
        stageName: '—',
        icon: '✓',
        label: 'complete',
        message: storyTitle ?? action.event.storyKey,
        completionData: {
          storyTitle: storyTitle ?? action.event.storyKey,
          stageDurations: stageDurations ?? [],
          totalDurationMs: durationMs ?? 0,
          totalAttempts: totalAttempts ?? 0,
        },
      }
      const newEvents = [...state.events, completionEvent].slice(-MAX_ACTIVITY_EVENTS)
      const newScrollIndex = state.isFollowing
        ? Math.max(0, newEvents.length - ACTIVITY_VISIBLE_ROWS)
        : state.scrollIndex
      return {
        ...state,
        events: newEvents,
        scrollIndex: newScrollIndex,
        nextId: state.nextId + 1,
      }
    }
    case 'SCROLL_UP': {
      return {
        ...state,
        scrollIndex: Math.max(0, state.scrollIndex - 3),
        isFollowing: false,
      }
    }
    case 'SCROLL_DOWN': {
      const maxScroll = Math.max(0, state.events.length - ACTIVITY_VISIBLE_ROWS)
      const newScrollIndex = Math.min(state.scrollIndex + 3, maxScroll)
      const isFollowing = newScrollIndex >= maxScroll
      return {
        ...state,
        scrollIndex: newScrollIndex,
        isFollowing,
      }
    }
  }
}

function makeInitialState(): ActivityState {
  const preloaded = activityRingBuffer.slice(-PRELOAD_COUNT)
  const events = preloaded.map((event, i) => ({ id: i, ...event }))
  return {
    events,
    scrollIndex: Math.max(0, events.length - ACTIVITY_VISIBLE_ROWS),
    isFollowing: true,
    nextId: events.length,
  }
}

export function useLiveActivity(eventBus: EventBus): UseLiveActivityResult {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitialState)
  const pendingActionsRef = useRef<ActivityAction[]>([])
  const lastUpdateRef = useRef(0)
  const THROTTLE_MS = 500 // Batch updates every 500ms — reduces terminal repaints

  useEffect(() => {
    const flushUpdates = () => {
      const actions = pendingActionsRef.current
      if (actions.length === 0) return

      const now = Date.now()
      if (now - lastUpdateRef.current >= THROTTLE_MS) {
        // In theory we should apply all actions to get final state,
        // but since we're using a reducer, we'll just dispatch them one by one.
        // Or better: we could optimize the reducer to handle BATCH_ADD.
        // For now, dispatching sequentially is simpler but might trigger multiple renders
        // unless they are batched by React (which they are in useEffect/Event handlers).
        for (const action of actions) {
          dispatch(action)
        }
        pendingActionsRef.current = []
        lastUpdateRef.current = now
      }
    }

    const onStreamEvent = (event: StreamEvent): void => {
      const formatted = formatStreamEvent(event)
      pushToRingBuffer(formatted)
      pendingActionsRef.current.push({ type: 'ADD_EVENT', event: formatted })
      flushUpdates()
    }
    const onCompleted = (event: StoryCompleteEvent): void => {
      pendingActionsRef.current.push({ type: 'ADD_COMPLETION', event })
      flushUpdates()
    }
    const onAppLog = (event: LogEvent): void => {
      const formatted = formatLogEvent(event)
      pushToRingBuffer(formatted)
      pendingActionsRef.current.push({ type: 'ADD_EVENT', event: formatted })
      flushUpdates()
    }

    // Interval to ensure we don't leave pending actions forever
    const interval = setInterval(flushUpdates, 1000)

    eventBus.on('stream:tool_use', onStreamEvent)
    eventBus.on('stream:tool_result', onStreamEvent)
    eventBus.on('stream:text', onStreamEvent)
    eventBus.on('stream:thinking', onStreamEvent)
    eventBus.on('stream:error', onStreamEvent)
    eventBus.on('stream:done', onStreamEvent)
    eventBus.on('story:completed', onCompleted)
    eventBus.on('app:log', onAppLog)

    return () => {
      clearInterval(interval)
      eventBus.off('stream:tool_use', onStreamEvent)
      eventBus.off('stream:tool_result', onStreamEvent)
      eventBus.off('stream:text', onStreamEvent)
      eventBus.off('stream:thinking', onStreamEvent)
      eventBus.off('stream:error', onStreamEvent)
      eventBus.off('stream:done', onStreamEvent)
      eventBus.off('story:completed', onCompleted)
      eventBus.off('app:log', onAppLog)
    }
  }, [eventBus])

  return {
    events: state.events,
    scrollIndex: state.scrollIndex,
    isFollowing: state.isFollowing,
    dispatch,
  }
}
