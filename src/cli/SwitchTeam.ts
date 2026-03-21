import { join } from 'node:path'

import type { Command } from 'commander'

import { requireInitialized } from './RequireInitialized.js'
import { openDatabase } from '@core/db/Connection.js'
import { TeamSwitchService } from '@core/TeamSwitchService.js'
import { AgentKitError } from '@core/Errors.js'
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js'
import { Logger } from '@core/Logger.js'

export function registerSwitchTeamCommand(program: Command): void {
  program
    .command('switch-team <name>')
    .description('Switch the active team for this project')
    .action(async (name: string) => {
      try {
        const logger = Logger.getOrNoop('CLI:SwitchTeam')
        logger.info('switch-team: invoked', { team: name })
        requireInitialized()

        const projectRoot = process.cwd()
        const db = openDatabase(join(projectRoot, AGENTKIT_DIR, DB_FILENAME))
        const service = new TeamSwitchService(db, projectRoot)

        await service.switchTeam(name)

        process.stdout.write(`Switched team: ${name}\n`)
        process.stdout.write(`Run 'agentkit run' to start the pipeline with the new team.\n`)
        process.exit(0)
      } catch (err: unknown) {
        if (err instanceof AgentKitError) {
          process.stderr.write(`Error: ${err.message}\n`)
          process.exit(1)
        }
        throw err
      }
    })
}
