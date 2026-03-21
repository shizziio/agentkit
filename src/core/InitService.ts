import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  Dirent,
} from 'node:fs'
import { join, relative } from 'node:path'

import { AGENTKIT_DIR, CONFIG_FILENAME, DB_FILENAME } from '@config/defaults.js'

import type { TeamConfig, ProjectConfig } from './ConfigTypes.js'
import { ConfigError, AgentKitError } from './Errors.js'
import { Logger } from '@core/Logger.js'
import { getGlobalTeamsDir, getGlobalResourcesDir } from '@shared/GlobalPath.js'
import { createConnection } from './db/Connection.js'
import { runMigrations } from './db/RunMigrations.js'
import { projects } from './db/schema.js'

const logger = Logger.getOrNoop('InitService')

function walkDir(dir: string, base?: string): { rel: string; abs: string }[] {
  const results: { rel: string; abs: string }[] = []
  if (!existsSync(dir)) return results
  const baseDir = base ?? dir
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, baseDir))
    } else {
      results.push({ rel: relative(baseDir, fullPath), abs: fullPath })
    }
  }
  return results
}

export interface InitOptions {
  projectPath: string
  projectName: string
  owner?: string
  provider: string
}

export interface InitResult {
  createdPaths: string[]
  dbPath: string
  configPath: string
}

export class InitService {
  listTeams(): TeamConfig[] {
    const teamsDir = getGlobalTeamsDir()
    let entries: Dirent[]
    try {
      entries = readdirSync(teamsDir, { withFileTypes: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ConfigError(`Cannot read global teams directory (~/.agentkit/teams/): ${message}`)
    }

    const teams: TeamConfig[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        teams.push(this.loadTeamConfig(entry.name))
      } catch {
        logger.debug('listTeams: skipping invalid team dir', { name: entry.name })
      }
    }
    return teams
  }

  loadTeamConfig(teamName: string): TeamConfig {
    const configPath = join(getGlobalTeamsDir(), teamName, 'config.json')

    if (!existsSync(configPath)) {
      throw new ConfigError(`Team config not found: ${configPath}`)
    }

    let raw: string
    try {
      raw = readFileSync(configPath, 'utf-8')
    } catch {
      throw new ConfigError(`Failed to read team config: ${configPath}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new ConfigError(`Malformed JSON in team config: ${configPath}`)
    }

    const config = parsed as Record<string, unknown>

    if (typeof config.team !== 'string' || !config.team) {
      throw new ConfigError('Team config missing required field: team')
    }

    if (typeof config.displayName !== 'string' || !config.displayName) {
      throw new ConfigError('Team config missing required field: displayName')
    }

    if (typeof config.version !== 'number') {
      throw new ConfigError('Team config missing required field: version')
    }

    if (!Array.isArray(config.stages) || config.stages.length === 0) {
      throw new ConfigError('Team config must have at least one stage')
    }

    // TeamConfig.models is Record<string, ProviderModelsConfig> — multi-provider schema
    // Each key is a provider name (e.g. 'claude-cli', 'gemini-cli')
    const models = config.models as Record<string, unknown> | undefined
    if (!models || typeof models !== 'object' || Array.isArray(models)) {
      throw new ConfigError('Team config missing required field: models')
    }

    const providerKeys = Object.keys(models)
    if (providerKeys.length === 0) {
      throw new ConfigError('Team config must define at least one provider in models')
    }

    for (const providerKey of providerKeys) {
      const providerConfig = models[providerKey] as Record<string, unknown> | undefined
      if (!providerConfig || !Array.isArray(providerConfig['allowed'])) {
        throw new ConfigError(`Team config models.${providerKey}.allowed must be an array`)
      }
      if (!providerConfig['defaults'] || typeof providerConfig['defaults'] !== 'object') {
        throw new ConfigError(`Team config models.${providerKey}.defaults must be an object`)
      }
    }

    // Safe: all required TeamConfig fields validated above
    return parsed as TeamConfig
  }

  checkExists(projectPath: string): boolean {
    const agentkitDir = join(projectPath, AGENTKIT_DIR)
    const exists = existsSync(agentkitDir)

    if (!exists) {
      const oldDir = join(projectPath, 'agentkit')
      if (existsSync(oldDir)) {
        throw new ConfigError("Found old 'agentkit/' folder. Please rename it to '_agent_kit/' before continuing.")
      }
    }

    return exists
  }

  scaffoldProject(options: InitOptions): InitResult {
    const { projectPath, projectName, owner, provider } = options

    logger.info('init: starting', { projectDir: options.projectPath })

    if (!projectName || projectName.trim().length === 0) {
      throw new AgentKitError('Project name is required', 'INIT_ERROR')
    }

    const agentkitDir = join(projectPath, AGENTKIT_DIR)
    const createdPaths: string[] = []

    try {
      // Create directory structure
      mkdirSync(join(agentkitDir, 'teams'), { recursive: true })
      createdPaths.push(agentkitDir)
      createdPaths.push(join(agentkitDir, 'teams'))

      // Copy resources (agents + workflows) from global dir into _agent_kit/resources/
      const globalResourcesDir = getGlobalResourcesDir()
      const localResourcesDir = join(agentkitDir, 'resources')
      if (existsSync(globalResourcesDir)) {
        const resFiles = walkDir(globalResourcesDir)
        for (const file of resFiles) {
          const dest = join(localResourcesDir, file.rel)
          mkdirSync(join(dest, '..'), { recursive: true })
          copyFileSync(file.abs, dest)
          createdPaths.push(dest)
        }
      }

      // Create _agentkit-output/planning/ for epic artifacts
      const outputDir = join(projectPath, '_agentkit-output', 'planning')
      mkdirSync(outputDir, { recursive: true })
      createdPaths.push(outputDir)

      // Write project config — no teams yet (created via setup workflow)
      const configPath = join(agentkitDir, CONFIG_FILENAME)
      const projectConfig: ProjectConfig = {
        version: 2,
        project: {
          name: projectName,
          ...(owner ? { owner } : {}),
        },
        activeTeam: '',
        teams: [],
        provider,
        models: {},
      }
      writeFileSync(configPath, JSON.stringify(projectConfig, null, 2) + '\n', 'utf-8')
      createdPaths.push(configPath)

      // Create and initialize database
      const dbPath = join(agentkitDir, DB_FILENAME)
      const db = createConnection(dbPath)
      runMigrations(db)
      createdPaths.push(dbPath)

      // Insert project record
      db.transaction(tx => {
        tx.insert(projects)
          .values({
            projectName,
            owner: owner || null,
            activeTeam: '',
          })
          .run()
      })

      // Scaffold .gitignore
      const gitignorePath = join(projectPath, '.gitignore')
      const gitignoreEntries = [`${AGENTKIT_DIR}/`, '_agentkit-output/']
      if (existsSync(gitignorePath)) {
        let content = readFileSync(gitignorePath, 'utf-8')
        const missing = gitignoreEntries.filter(e => !content.includes(e))
        if (missing.length > 0) {
          writeFileSync(gitignorePath, content + '\n' + missing.join('\n') + '\n', 'utf-8')
        }
      } else {
        writeFileSync(gitignorePath, gitignoreEntries.join('\n') + '\n', 'utf-8')
      }
      createdPaths.push(gitignorePath)

      logger.info('init: complete')

      return {
        createdPaths,
        dbPath,
        configPath,
      }
    } catch (err: unknown) {
      if (err instanceof AgentKitError) {
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      logger.error('init: failed', { error: message })
      throw new AgentKitError(`Failed to initialize project: ${message}`, 'INIT_ERROR')
    }
  }
}
