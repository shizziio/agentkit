import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { eq, sql } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { projects } from '@core/db/schema.js'
import { Logger } from '@core/Logger.js'
import { AGENTKIT_DIR, CONFIG_FILENAME } from '@config/defaults.js'
import { ConfigLoader } from './ConfigLoader.js'
import { ConfigError, TeamSwitchError } from './Errors.js'
import { eventBus } from './EventBus.js'
import type { ITeamSwitchService, PipelineRef } from './TeamSwitchTypes.js'

const logger = Logger.getOrNoop('TeamSwitchService')

// In-memory mutex — all workers run in same process (architecture-rules.md Section 4.1)
let isSwitching = false
const switchQueue: Array<() => void> = []

function acquireMutex(): Promise<() => void> {
  return new Promise(resolve => {
    const tryAcquire = (): void => {
      if (!isSwitching) {
        isSwitching = true
        resolve(() => {
          isSwitching = false
          const next = switchQueue.shift()
          if (next) next()
        })
      } else {
        switchQueue.push(tryAcquire)
      }
    }
    tryAcquire()
  })
}

export class TeamSwitchService implements ITeamSwitchService {
  private db: DrizzleDB
  private projectRoot: string
  private pipeline?: PipelineRef

  constructor(db: DrizzleDB, projectRoot: string, pipeline?: PipelineRef) {
    this.db = db
    this.projectRoot = projectRoot
    this.pipeline = pipeline

    eventBus.on('team:request-switch', (payload) => {
      this.switchTeam(payload.toTeam).catch((err: unknown) => {
        logger.error('teamSwitch: async request failed', {
          team: payload.toTeam,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    })
  }

  async switchTeam(toTeam: string, pipeline?: PipelineRef): Promise<void> {
    const release = await acquireMutex()
    try {
      this.doSwitch(toTeam, pipeline ?? this.pipeline)
    } finally {
      release()
    }
  }

  private doSwitch(toTeam: string, pipeline?: PipelineRef): void {
    // 1. Block if workers are running
    if (pipeline?.isRunning()) {
      throw new TeamSwitchError('Workers dang chay. Dung workers truoc khi switch team.')
    }

    // 2. Load current project config
    const configLoader = new ConfigLoader(this.projectRoot)
    const projectConfig = configLoader.loadProjectConfig()
    const fromTeam = projectConfig.activeTeam

    if (fromTeam === toTeam) {
      logger.info('teamSwitch: already on team', { team: toTeam })
      return
    }

    // 3. Validate target team exists and has valid config (rollback guard — file not yet written)
    try {
      configLoader.loadTeamConfig(toTeam)
    } catch (err: unknown) {
      if (err instanceof ConfigError && err.message.includes('not found')) {
        throw new TeamSwitchError(`Team '${toTeam}' khong ton tai.`)
      }
      // Re-throw config validation errors with details intact
      throw err
    }

    // 4. Build updated config object
    const updatedTeams = projectConfig.teams.includes(toTeam)
      ? projectConfig.teams
      : [...projectConfig.teams, toTeam]
    const updatedConfig = {
      ...projectConfig,
      version: 2,
      activeTeam: toTeam,
      teams: updatedTeams,
      models: {},
    }

    // 5. Update projects.active_team in DB (wrapped in transaction per architecture-rules.md Section 4.2)
    const project = this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.projectName, projectConfig.project.name))
      .get()

    if (project) {
      this.db.transaction((tx) => {
        tx.update(projects)
          .set({ activeTeam: toTeam, updatedAt: new Date().toISOString(), version: sql`${projects.version} + 1` })
          .where(eq(projects.id, project.id))
          .run()
      })
    }

    // 6. Write config file AFTER DB transaction succeeds — prevents stale file if DB throws
    const configPath = join(this.projectRoot, AGENTKIT_DIR, CONFIG_FILENAME)
    writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2) + '\n', 'utf-8')

    // 7. Emit event and log
    eventBus.emit('team:switched', { from: fromTeam, to: toTeam })
    logger.info(`Switched team: ${fromTeam} → ${toTeam}`)
  }
}
