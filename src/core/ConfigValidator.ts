import { ConfigError } from './Errors.js'

export function validateTeamConfig(raw: unknown): void {
  // Cast needed for property access; null/non-object caught by check below
  const config = raw as Record<string, unknown>
  if (!config || typeof config !== 'object') {
    throw new ConfigError('Team config must be an object')
  }
  if (!config.team || typeof config.team !== 'string') {
    throw new ConfigError('Team config missing required field: team')
  }
  if (!config.displayName || typeof config.displayName !== 'string') {
    throw new ConfigError('Team config missing required field: displayName')
  }
  if (typeof config.version !== 'number') {
    throw new ConfigError('Team config version must be a number')
  }
  if (!Array.isArray(config.stages) || config.stages.length === 0) {
    throw new ConfigError('Team config must have at least one stage')
  }
  // Cast for property access; non-object handled by Array.isArray check below
  const models = config.models as Record<string, unknown> | undefined
  if (!models || typeof models !== 'object') {
    throw new ConfigError('Team config missing required field: models')
  }

  for (const [provider, providerModels] of Object.entries(models)) {
    const pm = providerModels as Record<string, unknown> | undefined
    if (!pm || !Array.isArray(pm.allowed)) {
      throw new ConfigError(`Team config models for provider "${provider}" missing required field: allowed`)
    }
    if (!pm.defaults || typeof pm.defaults !== 'object') {
      throw new ConfigError(`Team config models for provider "${provider}" missing required field: defaults`)
    }
  }

  // Optional file ownership validation
  if (config.ownership !== undefined) {
    const ownership = config.ownership as Record<string, unknown>
    if (!ownership || typeof ownership !== 'object') {
      throw new ConfigError('Team config field "ownership" must be an object')
    }
    if (!Array.isArray(ownership.include) || ownership.include.length === 0) {
      throw new ConfigError('Team config ownership.include must be a non-empty array of glob patterns')
    }
    for (const pattern of ownership.include as unknown[]) {
      if (typeof pattern !== 'string') {
        throw new ConfigError('Team config ownership.include entries must be strings')
      }
    }
    if (ownership.exclude !== undefined) {
      if (!Array.isArray(ownership.exclude)) {
        throw new ConfigError('Team config ownership.exclude must be an array of glob patterns')
      }
      for (const pattern of ownership.exclude as unknown[]) {
        if (typeof pattern !== 'string') {
          throw new ConfigError('Team config ownership.exclude entries must be strings')
        }
      }
    }
  }

  const stageNames = new Set<string>()
  // Array verified above; element type checked on next line
  for (const stage of config.stages as Record<string, unknown>[]) {
    if (!stage || typeof stage !== 'object') {
      throw new ConfigError('Each stage must be an object')
    }
    if (typeof stage.name !== 'string' || stage.name.length === 0) {
      throw new ConfigError('Stage missing required field: name')
    }
    if (typeof stage.displayName !== 'string' || stage.displayName.length === 0) {
      throw new ConfigError(`Stage "${stage.name}" missing required field: displayName`)
    }
    if (typeof stage.prompt !== 'string' || stage.prompt.length === 0) {
      throw new ConfigError(`Stage "${stage.name}" missing required field: prompt`)
    }
    if (typeof stage.timeout !== 'number') {
      throw new ConfigError(`Stage "${stage.name}" missing required field: timeout`)
    }
    if (typeof stage.workers !== 'number') {
      throw new ConfigError(`Stage "${stage.name}" missing required field: workers`)
    }
    if (typeof stage.retries !== 'number') {
      throw new ConfigError(`Stage "${stage.name}" missing required field: retries`)
    }
    if (typeof stage.icon !== 'string' || stage.icon.length === 0) {
      throw new ConfigError(`Stage "${stage.name}" missing required field: icon`)
    }
    if (stage.skipDeps !== undefined && typeof stage.skipDeps !== 'boolean') {
      throw new ConfigError(`Stage "${stage.name}" field "skipDeps" must be a boolean`)
    }
    if (
      stage.skipDepsLevel !== undefined &&
      stage.skipDepsLevel !== 'epic' &&
      stage.skipDepsLevel !== 'story'
    ) {
      throw new ConfigError(`Stage "${stage.name}" field "skipDepsLevel" must be 'epic' or 'story'`)
    }
    if (stage.skipDeps === true && stage.skipDepsLevel !== undefined) {
      console.warn(
        `[agentkit] Stage "${stage.name}": skipDepsLevel is set but has no effect when skipDeps is true`
      )
    }
    stageNames.add(stage.name)
  }

  // Array verified above; element type checked in first loop
  for (const stage of config.stages as Record<string, unknown>[]) {
    if (stage.next !== undefined) {
      if (typeof stage.next !== 'string') {
        throw new ConfigError(`Stage "${stage.name}" field "next" must be a string`)
      }
      if (!stageNames.has(stage.next)) {
        throw new ConfigError(
          `Stage "${stage.name}" references unknown next stage: "${stage.next}"`
        )
      }
    }
    if (stage.reject_to !== undefined) {
      if (typeof stage.reject_to !== 'string') {
        throw new ConfigError(`Stage "${stage.name}" field "reject_to" must be a string`)
      }
      if (!stageNames.has(stage.reject_to)) {
        throw new ConfigError(
          `Stage "${stage.name}" references unknown reject_to stage: "${stage.reject_to}"`
        )
      }
    }
  }

  const stageOrderMap = new Map<string, number>()
  // Array verified in earlier loop; element shape already validated
  for (let i = 0; i < (config.stages as Record<string, unknown>[]).length; i++) {
    const stage = (config.stages as Record<string, unknown>[])[i]
    if (stage && typeof stage.name === 'string') {
      stageOrderMap.set(stage.name, i)
    }
  }

  for (const stage of config.stages as Record<string, unknown>[]) {
    if (stage.reset_to === undefined) continue
    if (!Array.isArray(stage.reset_to)) {
      throw new ConfigError(`Stage "${stage.name}" field "reset_to" must be an array`)
    }
    for (const target of stage.reset_to as unknown[]) {
      if (typeof target !== 'string') {
        throw new ConfigError(`Stage "${stage.name}" reset_to entries must be strings`)
      }
      if (!stageNames.has(target)) {
        throw new ConfigError(
          `Stage "${stage.name}" reset_to references unknown stage: "${target}"`
        )
      }
      if (stageOrderMap.get(target)! > stageOrderMap.get(stage.name as string)!) {
        throw new ConfigError(
          `Stage "${stage.name}" reset_to cannot reference a later stage: "${target}"`
        )
      }
    }
  }
}

export function validateProjectConfig(raw: unknown): void {
  // Cast needed for property access; null/non-object caught by check below
  const config = raw as Record<string, unknown>
  if (!config || typeof config !== 'object') {
    throw new ConfigError('Project config must be an object')
  }
  if (typeof config.version !== 'number') {
    throw new ConfigError('Project config version must be a number')
  }
  // Cast for property access; guard on next line handles undefined/non-object
  const project = config.project as Record<string, unknown> | undefined
  if (!project || typeof project.name !== 'string') {
    throw new ConfigError('Project config missing required field: project.name')
  }

  // v1: `team` field; v2: `activeTeam` + `teams`
  if (config.activeTeam !== undefined || config.teams !== undefined) {
    // v2 format — activeTeam can be empty string (no team configured yet)
    if (config.activeTeam === undefined || typeof config.activeTeam !== 'string') {
      throw new ConfigError('Project config missing required field: activeTeam')
    }
    if (!Array.isArray(config.teams)) {
      throw new ConfigError('Project config field "teams" must be an array')
    }
  } else {
    // v1 format
    if (!config.team || typeof config.team !== 'string') {
      throw new ConfigError('Project config missing required field: team')
    }
  }

  if (!config.provider || typeof config.provider !== 'string') {
    throw new ConfigError('Project config missing required field: provider')
  }
  if (!config.models || typeof config.models !== 'object') {
    throw new ConfigError('Project config missing required field: models')
  }

  // Optional multi-team fields
  if (config.activeTeams !== undefined) {
    if (!Array.isArray(config.activeTeams) || config.activeTeams.length === 0) {
      throw new ConfigError('Project config field "activeTeams" must be a non-empty array')
    }
    for (const t of config.activeTeams as unknown[]) {
      if (typeof t !== 'string') {
        throw new ConfigError('Project config field "activeTeams" entries must be strings')
      }
    }
  }
  if (config.defaultTeam !== undefined && typeof config.defaultTeam !== 'string') {
    throw new ConfigError('Project config field "defaultTeam" must be a string')
  }
  if (config.maxConcurrentSessions !== undefined) {
    if (typeof config.maxConcurrentSessions !== 'number' || config.maxConcurrentSessions < 1) {
      throw new ConfigError('Project config field "maxConcurrentSessions" must be a positive number')
    }
  }
}
