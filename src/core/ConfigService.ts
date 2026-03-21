import { writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { AGENTKIT_DIR, CONFIG_FILENAME } from '@config/defaults.js'
import { ConfigError } from './Errors.js'
import { ConfigLoader } from './ConfigLoader.js'
import type { ProjectConfig, IConfigService, ConfigSettings } from './ConfigTypes.js'
import type { EventBus } from './EventBus.js'
import { Logger } from '@core/Logger.js'
import { getGlobalTeamsDir } from '@shared/GlobalPath.js'

const logger = Logger.getOrNoop('ConfigService')

export class ConfigService implements IConfigService {
  private projectRoot: string
  private eventBus?: EventBus

  constructor(projectRoot: string, eventBus?: EventBus) {
    this.projectRoot = projectRoot
    this.eventBus = eventBus
  }

  loadSettings(): ConfigSettings {
    const configLoader = new ConfigLoader(this.projectRoot)
    const pipeline = configLoader.load()
    const projectConfig = configLoader.loadProjectConfig()
    const teamConfig = configLoader.loadTeamConfig(projectConfig.activeTeam)

    logger.debug('config: loaded', { configPath: this.projectRoot })
    return { projectConfig, teamConfig, pipeline }
  }

  saveModelAssignments(models: Record<string, string>): void {
    const configLoader = new ConfigLoader(this.projectRoot)
    const projectConfig = configLoader.loadProjectConfig()
    const teamConfig = configLoader.loadTeamConfig(projectConfig.activeTeam)

    const providerModelsCfg = teamConfig.models[projectConfig.provider]
    if (!providerModelsCfg) {
      throw new ConfigError(
        `Provider "${projectConfig.provider}" is not configured in team "${teamConfig.team}" models`
      )
    }

    const allowed = providerModelsCfg.allowed
    for (const [stage, model] of Object.entries(models)) {
      if (!allowed.includes(model)) {
        throw new ConfigError(
          `Model "${model}" for stage "${stage}" is not in allowed models: ${allowed.join(', ')}`
        )
      }
    }

    const updatedModels = { ...projectConfig.models }
    updatedModels[projectConfig.provider] = models

    const updated: ProjectConfig = {
      ...projectConfig,
      models: updatedModels,
    }

    const configPathOut = join(this.projectRoot, AGENTKIT_DIR, CONFIG_FILENAME)
    try {
      writeFileSync(configPathOut, JSON.stringify(updated, null, 2) + '\n', 'utf-8')
      logger.info('config: saved')

      if (this.eventBus) {
        const configLoader = new ConfigLoader(this.projectRoot)
        const newPipeline = configLoader.load()
        this.eventBus.emit('pipeline:reconfigured', newPipeline)
      }
    } catch (err: unknown) {
      logger.error('config: file error', {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  switchProvider(provider: string): void {
    const configLoaderProvider = new ConfigLoader(this.projectRoot)
    const pConfig = configLoaderProvider.loadProjectConfig()

    if (pConfig.provider === provider) {
      return // No change needed
    }

    const updatedConfig: ProjectConfig = {
      ...pConfig,
      provider,
    }

    const cPath = join(this.projectRoot, AGENTKIT_DIR, CONFIG_FILENAME)
    try {
      writeFileSync(cPath, JSON.stringify(updatedConfig, null, 2) + '\n', 'utf-8')
      logger.info('config: switched provider', { provider })

      if (this.eventBus) {
        const configLoader = new ConfigLoader(this.projectRoot)
        const newPipeline = configLoader.load()
        this.eventBus.emit('pipeline:reconfigured', newPipeline)
      }
    } catch (err: unknown) {
      logger.error('config: file error on switch', {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  saveEnv(provider: string, env: Record<string, string>): void {
    const configLoaderEnv = new ConfigLoader(this.projectRoot)
    const pConfig = configLoaderEnv.loadProjectConfig()

    const allEnv = { ...(pConfig.env ?? {}) }
    if (Object.keys(env).length > 0) {
      allEnv[provider] = env
    } else {
      delete allEnv[provider]
    }

    const updatedConfig: ProjectConfig = {
      ...pConfig,
      env: Object.keys(allEnv).length > 0 ? allEnv : undefined,
    }

    const configPathOut = join(this.projectRoot, AGENTKIT_DIR, CONFIG_FILENAME)
    try {
      writeFileSync(configPathOut, JSON.stringify(updatedConfig, null, 2) + '\n', 'utf-8')
      logger.info('config: saved env', { provider, envKeys: Object.keys(env) })

      if (this.eventBus) {
        const configLoader = new ConfigLoader(this.projectRoot)
        const newPipeline = configLoader.load()
        this.eventBus.emit('pipeline:reconfigured', newPipeline)
      }
    } catch (err: unknown) {
      logger.error('config: file error on env save', {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  saveSettings(provider: string, settingsPath: string | null): void {
    const configLoaderSettings = new ConfigLoader(this.projectRoot)
    const pConfig = configLoaderSettings.loadProjectConfig()

    const settings = { ...(pConfig.settings ?? {}) }
    if (settingsPath) {
      settings[provider] = settingsPath
    } else {
      delete settings[provider]
    }

    const updatedConfig: ProjectConfig = {
      ...pConfig,
      settings: Object.keys(settings).length > 0 ? settings : undefined,
    }

    const configPathOut = join(this.projectRoot, AGENTKIT_DIR, CONFIG_FILENAME)
    try {
      writeFileSync(configPathOut, JSON.stringify(updatedConfig, null, 2) + '\n', 'utf-8')
      logger.info('config: saved settings', { provider, settingsPath })

      if (this.eventBus) {
        const configLoader = new ConfigLoader(this.projectRoot)
        const newPipeline = configLoader.load()
        this.eventBus.emit('pipeline:reconfigured', newPipeline)
      }
    } catch (err: unknown) {
      logger.error('config: file error on settings save', {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  listBundledTeams(): string[] {
    try {
      const dir = getGlobalTeamsDir()
      if (!existsSync(dir)) {
        return []
      }
      return readdirSync(dir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
    } catch (err: unknown) {
      logger.error('config: error reading bundled teams', {
        error: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  }
}
