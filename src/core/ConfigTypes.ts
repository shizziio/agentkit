export interface StageConfig {
  name: string
  displayName: string
  icon: string
  prompt: string
  timeout: number
  workers: number
  retries: number
  next?: string
  reject_to?: string
  reset_to?: string[]
  skipDeps?: boolean
  skipDepsLevel?: 'epic' | 'story'
}

export interface ProviderModelsConfig {
  allowed: string[]
  defaults: Record<string, string>
}

export interface FileOwnership {
  include: string[]
  exclude?: string[]
}

export interface TeamConfig {
  team: string
  displayName: string
  version: number
  models: Record<string, ProviderModelsConfig>
  stages: StageConfig[]
  ownership?: FileOwnership
}

export interface ProjectConfig {
  version: number
  project: {
    name: string
    owner?: string
  }
  activeTeam: string
  activeTeams?: string[]
  defaultTeam?: string
  teams: string[]
  provider: string
  models: Record<string, Record<string, string>>
  env?: Record<string, Record<string, string>>
  settings?: Record<string, string>
  maxConcurrentSessions?: number
}

export interface ConfigSettings {
  projectConfig: ProjectConfig
  teamConfig: TeamConfig
  pipeline: PipelineConfig
}

export interface IConfigService {
  loadSettings(): ConfigSettings
  saveModelAssignments(models: Record<string, string>): void
  switchProvider(provider: string): void
  listBundledTeams(): string[]
  saveEnv(provider: string, env: Record<string, string>): void
  saveSettings(provider: string, settingsPath: string | null): void
}

export interface PipelineConfig {
  team: string
  displayName: string
  provider: string
  project: {
    name: string
    owner?: string
  }
  stages: StageConfig[]
  models: {
    allowed: string[]
    resolved: Record<string, string>
  }
  providerEnv?: Record<string, string>
  settingsPath?: string
}

export interface WorkerStatus {
  stageName: string
  workerIndex: number
  status: 'running' | 'stopping' | 'stopped'
  currentTaskId: number | null
  uptime: number
}

export interface PipelineStatus {
  state: 'running' | 'stopped' | 'stopping'
  workers: WorkerStatus[]
  activeTeam: string
}
