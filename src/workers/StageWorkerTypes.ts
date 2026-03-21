export interface StageWorkerConfig {
  stageName: string
  workerIndex: number
  projectRoot: string
  pollInterval: number
  maxPollInterval: number
  backoffMultiplier: number
  model: string
  timeout: number
  promptPath: string
  next?: string
  reject_to?: string
  activeTeam: string
  providerEnv?: Record<string, string>
  settingsPath?: string
}

export type StageWorkerStatus = 'idle' | 'running' | 'stopping' | 'stopped'

export type ParsedOutput =
  | { success: true; data: unknown }
  | { success: false; rawText: string; error: string }
