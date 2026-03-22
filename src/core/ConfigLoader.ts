import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { AGENTKIT_DIR } from '@config/defaults.js'
import { ConfigError } from './Errors.js'
import type { TeamConfig, ProjectConfig, PipelineConfig } from './ConfigTypes.js'
import { Logger } from '@core/Logger.js'
import { getGlobalTeamsDir } from '@shared/GlobalPath.js'
import { validateTeamConfig, validateProjectConfig } from './ConfigValidator.js'

const logger = Logger.getOrNoop('ConfigLoader')

export class ConfigLoader {
  private projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  loadTeamConfig(teamName: string): TeamConfig {
    if (teamName.includes('..') || teamName.includes('/') || teamName.includes('\\')) {
      throw new ConfigError(`Invalid team name: ${teamName}`)
    }

    // 1. Try project-local first (override)
    const localConfigPath = join(this.projectRoot, AGENTKIT_DIR, 'teams', teamName, 'config.json')

    // 2. Fallback to bundled (builtin)
    const bundledConfigPath = join(getGlobalTeamsDir(), teamName, 'config.json')

    const configPath = existsSync(localConfigPath) ? localConfigPath : bundledConfigPath

    if (!existsSync(configPath)) {
      throw new ConfigError(`Team config not found: ${teamName}`)
    }

    logger.debug('configLoader: config file found', { path: configPath })

    const raw = this.readJsonFile(configPath, `Team config not found: ${teamName}`)
    logger.debug('configLoader: parsed')

    validateTeamConfig(raw)
    return raw as TeamConfig
  }

  loadProjectConfig(): ProjectConfig {
    const configPath = join(this.projectRoot, AGENTKIT_DIR, 'agentkit.config.json')
    const raw = this.readJsonFile(
      configPath,
      `Project config not found: ${AGENTKIT_DIR}/agentkit.config.json`
    )

    validateProjectConfig(raw)
    return this.normalizeProjectConfig(raw as Record<string, unknown>)
  }

  private normalizeProjectConfig(raw: Record<string, unknown>): ProjectConfig {
    // v1 → v2 migration: `team` becomes `activeTeam` + `teams`
    if (raw.version === 1 || (raw.team !== undefined && raw.activeTeam === undefined)) {
      const team = raw.team as string
      const provider = (raw.provider as string) ?? 'claude-cli'
      const legacyModels = (raw.models ?? {}) as Record<string, string>
      return {
        version: 2,
        project: raw.project as ProjectConfig['project'],
        activeTeam: team,
        activeTeams: [team],
        defaultTeam: team,
        teams: [team],
        provider,
        models: {
          [provider]: legacyModels,
        },
      }
    }

    const config = raw as unknown as ProjectConfig

    // Backwards compat: derive activeTeams from activeTeam if not set
    if (!config.activeTeams && config.activeTeam) {
      config.activeTeams = [config.activeTeam]
    }

    // Backwards compat: derive defaultTeam from activeTeam if not set
    if (!config.defaultTeam && config.activeTeam) {
      config.defaultTeam = config.activeTeam
    }

    return config
  }

  /**
   * Returns true if the project has at least one team configured.
   */
  hasTeam(): boolean {
    try {
      const config = this.loadProjectConfig()
      return config.teams.length > 0
    } catch {
      return false
    }
  }

  load(): PipelineConfig {
    const projectConfig = this.loadProjectConfig()

    if (projectConfig.teams.length === 0) {
      throw new ConfigError(
        'No team configured. Run `agentkit setup` or `agentkit start` to create a team.'
      )
    }

    // Auto-set activeTeam to first team if empty
    if (!projectConfig.activeTeam) {
      projectConfig.activeTeam = projectConfig.teams[0]!
      logger.info('configLoader: auto-set activeTeam', { activeTeam: projectConfig.activeTeam })
    }

    if (!projectConfig.teams.includes(projectConfig.activeTeam)) {
      throw new ConfigError(
        `activeTeam "${projectConfig.activeTeam}" is not in teams: [${projectConfig.teams.join(', ')}]`
      )
    }

    return this.buildPipelineConfig(projectConfig, projectConfig.activeTeam)
  }

  /**
   * Load PipelineConfig for every active team.
   * Returns a Map keyed by team name.
   */
  loadAll(): Map<string, PipelineConfig> {
    const projectConfig = this.loadProjectConfig()
    const activeTeams = projectConfig.activeTeams ?? [projectConfig.activeTeam]
    const result = new Map<string, PipelineConfig>()

    for (const teamName of activeTeams) {
      if (!projectConfig.teams.includes(teamName)) {
        throw new ConfigError(
          `activeTeams entry "${teamName}" is not in teams: [${projectConfig.teams.join(', ')}]`
        )
      }
      result.set(teamName, this.buildPipelineConfig(projectConfig, teamName))
    }

    return result
  }

  private buildPipelineConfig(projectConfig: ProjectConfig, teamName: string): PipelineConfig {
    const teamConfig = this.loadTeamConfig(teamName)

    if (teamName !== teamConfig.team) {
      throw new ConfigError(
        `activeTeam "${teamName}" does not match team config team "${teamConfig.team}"`
      )
    }

    const resolved = this.mergeModels(teamConfig, projectConfig)
    const providerAllowedModels = teamConfig.models[projectConfig.provider]?.allowed ?? []
    this.validateModels(resolved, teamConfig, projectConfig.provider)

    const providerEnv = projectConfig.env?.[projectConfig.provider]
    const settingsPath = projectConfig.settings?.[projectConfig.provider]

    return {
      team: teamConfig.team,
      displayName: teamConfig.displayName,
      provider: projectConfig.provider,
      project: projectConfig.project,
      stages: teamConfig.stages.map((stage, index) => ({
        ...stage,
        prompt: join(teamName, stage.prompt),
        reset_to: stage.reset_to ?? teamConfig.stages.slice(0, index + 1).map(s => s.name),
      })),
      models: {
        allowed: providerAllowedModels,
        resolved,
      },
      providerEnv,
      settingsPath,
    }
  }

  private mergeModels(
    teamConfig: TeamConfig,
    projectConfig: ProjectConfig
  ): Record<string, string> {
    const providerModelsCfg = teamConfig.models[projectConfig.provider]
    if (!providerModelsCfg) {
      throw new ConfigError(
        `Provider "${projectConfig.provider}" is not configured in team "${teamConfig.team}" models`
      )
    }
    const resolved: Record<string, string> = { ...providerModelsCfg.defaults }

    const projectProviderModels = projectConfig.models[projectConfig.provider] ?? {}
    for (const [stage, model] of Object.entries(projectProviderModels)) {
      resolved[stage] = model
    }

    return resolved
  }

  private validateModels(
    resolved: Record<string, string>,
    teamConfig: TeamConfig,
    provider: string
  ): void {
    const allowed = teamConfig.models[provider]?.allowed ?? []

    for (const stage of teamConfig.stages) {
      const model = resolved[stage.name]
      if (!model) {
        throw new ConfigError(
          `Stage "${stage.name}" has no model assigned for provider ${provider}`
        )
      }
      if (!allowed.includes(model)) {
        throw new ConfigError(
          `Model "${model}" for stage "${stage.name}" is not in allowed models for ${provider}: ${allowed.join(', ')}`
        )
      }
    }
  }

  private readJsonFile(filePath: string, notFoundMessage: string): unknown {
    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        // Safe: guarded by instanceof Error && 'code' in err above
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        throw new ConfigError(notFoundMessage)
      }
      throw new ConfigError(`Failed to read config file: ${filePath}`)
    }

    try {
      return JSON.parse(content) as unknown
    } catch {
      logger.error('configLoader: parse failed', { error: 'Malformed JSON' })
      throw new ConfigError(`Malformed JSON in config file: ${filePath}`)
    }
  }
}
