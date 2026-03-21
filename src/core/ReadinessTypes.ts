export type SetupStepId = 'project-docs' | 'team-config' | 'epic-plans'
export type SetupStatus = 'ready' | 'partial' | 'missing'

export interface SetupStepProvider {
  /** File paths (absolute) to load as system prompt context */
  promptFiles: string[]
  /** Short description shown to user before spawning */
  description: string
  /** Optional initial message to send (e.g. "DP" to trigger a workflow command) */
  initialMessage?: string
}

export interface SetupStep {
  id: SetupStepId
  label: string
  status: SetupStatus
  detail: string
  provider: SetupStepProvider
  /** Steps that must be 'ready' or 'partial' before this step can run */
  blockedBy?: SetupStepId[]
}

export interface ReadinessResult {
  /** True if no steps have status 'missing' */
  allReady: boolean
  steps: SetupStep[]
}
