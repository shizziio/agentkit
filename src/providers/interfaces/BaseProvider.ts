import type { StreamEvent } from '@core/EventTypes.js'
import type { DrizzleDB } from '@core/db/Connection.js'

export interface ProviderConfig {
  taskId: number
  stageName: string
  model: string
  timeout: number
  permissions: 'dangerously-skip' | 'accept-edits' | 'default'
  providerEnv?: Record<string, string>
  settingsPath?: string
  sessionName?: string
  resumeSession?: string
}

export interface ProviderCapabilities {
  streaming: boolean
  nativeToolUse: boolean
  supportedModels: string[]
  sessionSupport: boolean
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Resolves human-readable session names to provider-specific session IDs.
 * Each provider with sessionSupport can implement its own resolution strategy.
 */
export interface SessionIdResolver {
  /** Resolve session name → provider session ID. Returns null if not found. */
  resolve(sessionName: string): string | null
  /** Scan for new sessions and index them. Returns count of newly resolved sessions. */
  scanNewSessions(): number
}

export interface BaseProvider {
  readonly name: string
  readonly type: 'agent' | 'api'
  readonly capabilities: ProviderCapabilities
  execute(prompt: string, config: ProviderConfig): AsyncIterable<StreamEvent>
  isAvailable(): Promise<boolean>
  validateConfig(config: ProviderConfig): ValidationResult
  /**
   * Create a session ID resolver for this provider.
   * Only called when sessionSupport is true. Returns null if not applicable.
   */
  createSessionResolver?(db: DrizzleDB, projectPath: string): SessionIdResolver | null
}
