import type { PipelineConfig, ProjectConfig, IConfigService } from '@core/ConfigTypes.js'
import type { EventBus } from '@core/EventBus.js'
import type { DrizzleDB } from '@core/db/Connection.js'
import type { IResetService } from '@core/ResetTypes.js'
import type { IMarkDoneService } from '@core/MarkDoneTypes.js'
import type { ITeamSwitchService } from '@core/TeamSwitchTypes.js'
import type { ITraceService } from '@core/TraceTypes.js'
import type { IDiagnoseService } from '@core/DiagnoseTypes.js'
import type { ILoadService, IMarkdownParser } from '@core/LoadTypes.js'

export type LayoutMode = 'compact' | 'grid'

export type DashboardMode = 'overview' | 'trace'

export type PipelineState = 'stopped' | 'running' | 'draining'

export const ACTION_MODES = [
  'load',
  'ship',
  'diagnose',
  'config',
  'view-config',
  'change-team',
  'change-models',
  'change-provider',
  'help',
  'mark-done',
  'history',
  'replay',
  'terminate-confirm',
  'quit-confirm',
  'reset-story',
  'cancel-story',
  'epic-story-mgmt',
  'task-mgmt',
  'chat',
  'ask-agent',
  'switch-team',
  'drain-confirm',
  'create-planning',
  'ask-agentkit',
  'custom-rules',
] as const

export type ActionMode = 'none' | typeof ACTION_MODES[number]

export type PanelId = 0 | 1 | 2 | 3

export const PANEL_PIPELINE_FLOW = 0 as const
export const PANEL_ACTIVE_STORIES = 1 as const
export const PANEL_LIVE_ACTIVITY = 2 as const
export const PANEL_DIAGNOSE = 3 as const

export interface WorkerStatusEntry {
  stageName: string
  displayName: string
  status: 'idle' | 'run'
  runStartedAt: number | null
}

export interface DashboardProps {
  pipelineConfig: PipelineConfig
  projectConfig?: ProjectConfig
  projectId: number
  db: DrizzleDB
  eventBus: EventBus
  resetService: IResetService
  markDoneService: IMarkDoneService
  configService: IConfigService
  teamSwitchService: ITeamSwitchService
  traceService: ITraceService
  diagnoseService: IDiagnoseService
  loadService: ILoadService
  markdownParser: IMarkdownParser
  onComplete: () => void
  onToggleWorkers?: () => void
  onEnterTrace?: () => void
  onTerminateWorkers?: () => void
  onDrain?: () => void
}
