import type { PipelineConfig } from './ConfigTypes.js'

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'routed' | 'rejected' | 'cancelled'

export interface TaskEvent {
  taskId: number
  storyId: number
  stageName: string
  status: TaskStatus
  workerModel?: string
  attempt?: number
  durationMs?: number
  error?: string
}

/**
 * StreamEvent: Provider → Worker → EventBus → Dashboard.
 *
 * Hien tai ClaudeCliProvider (plain text mode) chi emit: text, error, done, raw_trace.
 * Types 'thinking' | 'tool_use' | 'tool_result' duoc giu lai trong union vi:
 *  - UI layer (useLiveActivity, useFullscreenLiveActivity, formatLogEntry) da co full handler
 *  - San sang cho future providers (API mode) co the emit cac types nay
 *  - Xoa se break 12+ test files va 5 source files — rui ro cao, loi ich thap
 *
 * Xem: Story 8.8 (plain text decision), Story 4.3 (original stream-json spec)
 */
export interface StreamEvent {
  taskId: number
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'error' | 'done' | 'raw_trace'
  stageName: string
  timestamp: number
  data: {
    text?: string
    toolName?: string
    toolInput?: Record<string, unknown>
    toolResult?: string
    thinking?: string
    error?: string
    inputTokens?: number
    outputTokens?: number
    stdout?: string
    stderr?: string
  }
}

export interface WorkerEvent {
  workerId: string
  stageName: string
  model: string
  taskId?: number
}

export interface StoryCompleteEvent {
  storyId: number
  storyKey: string
  epicKey: string
  durationMs: number
  storyTitle: string
  stageDurations: Array<{ stageName: string; durationMs: number }>
  totalAttempts: number
}

export interface AlertEvent {
  taskId: number
  storyId: number
  storyTitle: string
  stageName: string
  issues: string[]
  routedTo?: string
  attempt: number
  maxAttempts: number
  isBlocked: boolean
}

export interface LogEvent {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  module: string
  message: string
  timestamp: string
  data?: Record<string, unknown>
}

export interface PipelineEvent {
  projectId: number
  timestamp: string
}

export interface PipelineReadyEvent {
  projectId: number
  recoveryResult: import('./PipelineTypes.js').RecoveryResult
}

export interface QueueEvent {
  pending: number
  running: number
  completed: number
  failed: number
  stageName?: string
  queuedCount?: number
}

export interface StoryBlockedEvent {
  storyId: number
  storyKey: string
  epicKey: string
  taskId: number
  reason: string
}

export interface TaskRecoveredEvent {
  taskId: number
  storyId: number
  stageName: string
  attempt: number
}

export interface DiagnoseResultEvent {
  result: import('./DiagnoseTypes.js').DiagnoseResult
  timestamp: string
  error?: string
}

export interface StoryResetEvent {
  storyId: number
  storyKey: string
  targetStage: string
  supersededTaskIds: number[]
  newTaskId: number
}

export interface StoryCancelEvent {
  storyId: number
  storyKey: string
  cancelledTaskIds: number[]
}

export interface StoryDoneEvent {
  storyId: number
  storyKey: string
}

export interface EpicDoneEvent {
  epicId: number
  epicKey: string
}

export interface TeamSwitchedEvent {
  from: string
  to: string
}

export interface TeamRequestSwitchEvent {
  toTeam: string
}

export interface PipelineDrainingEvent {
  timestamp: string
  projectId: number
}

export interface TaskDrainedEvent {
  taskId: number
  storyId: number
  stageName: string
}

export interface EventMap {
  'pipeline:start': PipelineEvent
  'pipeline:stop': PipelineEvent
  'pipeline:stopping': PipelineEvent
  'pipeline:terminated': PipelineEvent
  'pipeline:ready': PipelineReadyEvent
  'pipeline:starting': { stages: string[] }
  'pipeline:reconfigured': PipelineConfig
  'worker:idle': WorkerEvent
  'worker:busy': WorkerEvent
  'task:queued': TaskEvent
  'task:started': TaskEvent
  'task:completed': TaskEvent
  'task:failed': TaskEvent
  'task:routed': TaskEvent
  'task:rejected': TaskEvent
  'stream:thinking': StreamEvent // reserved — not emitted by ClaudeCliProvider (plain text mode)
  'stream:tool_use': StreamEvent // reserved — not emitted by ClaudeCliProvider (plain text mode)
  'stream:tool_result': StreamEvent // reserved — not emitted by ClaudeCliProvider (plain text mode)
  'stream:text': StreamEvent
  'stream:error': StreamEvent
  'stream:done': StreamEvent
  'stream:raw_trace': StreamEvent // internal provider→worker boundary; not re-emitted via EventBus — reserved for future dashboard use
  'queue:enqueued': { stage: string; storyId: number }
  'queue:updated': QueueEvent
  'story:completed': StoryCompleteEvent
  'story:blocked': StoryBlockedEvent
  'story:request-done': { storyId: number }
  'epic:request-done': { epicId: number }
  'task:recovered': TaskRecoveredEvent
  'task:alert': AlertEvent
  'app:log': LogEvent
  'diagnose:result': DiagnoseResultEvent
  'story:reset': StoryResetEvent
  'story:cancelled': StoryCancelEvent
  'story:request-reset': { storyId: number; targetStage: string }
  'story:request-cancel': { storyId: number }
  'story:done': StoryDoneEvent
  'epic:done': EpicDoneEvent
  'team:switched': TeamSwitchedEvent
  'team:request-switch': TeamRequestSwitchEvent
  'pipeline:draining': PipelineDrainingEvent
  'task:drained': TaskDrainedEvent
}
