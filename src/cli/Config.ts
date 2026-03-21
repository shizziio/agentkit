import React from 'react'
import type { Command } from 'commander'
import { render } from 'ink'

import { requireInitialized } from './RequireInitialized.js'
import { ConfigService } from '@core/ConfigService.js'
import { ConfigWizard } from '@ui/config/ConfigWizard.js'
import { Logger } from '@core/Logger.js'
import type { ITeamSwitchService } from '@core/TeamSwitchTypes.js'

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('View or update project configuration')
    .option('--show', 'Print current config in non-interactive mode')
    .action(async (options: { show?: boolean }) => {
      try {
        const logger = Logger.getOrNoop('CLI:Config');
        logger.info('config: invoked', { action: options.show ? 'show' : 'edit' });
        requireInitialized()
        const projectRoot = process.cwd()
        const configService = new ConfigService(projectRoot)

        if (options.show) {
          const { pipeline } = configService.loadSettings()
          console.log(`Project:  ${pipeline.project.name}`)
          console.log(`Owner:    ${pipeline.project.owner ?? '(none)'}`)
          console.log(`Team:     ${pipeline.team}`)
          console.log(`Provider: ${pipeline.provider}`)
          console.log('Model Assignments:')
          for (const stage of pipeline.stages) {
            const model = pipeline.models.resolved[stage.name] ?? ''
            console.log(`  ${stage.icon} ${stage.displayName.padEnd(14)} ${model}`)
          }
          process.exit(0)
        } else {
          const { pipeline, projectConfig } = configService.loadSettings()
          // Create teamSwitchService lazily so render() is not blocked by DB setup
          const lazyTeamSwitchService: ITeamSwitchService = {
            switchTeam: async (toTeam, pipeline: { isRunning(): boolean } | undefined) => {
              const { openDatabase } = await import('@core/db/Connection.js')
              const { TeamSwitchService } = await import('@core/TeamSwitchService.js')
              const { join } = await import('node:path')
              const { AGENTKIT_DIR, DB_FILENAME } = await import('@config/defaults.js')
              const db = openDatabase(join(projectRoot, AGENTKIT_DIR, DB_FILENAME))
              const svc = new TeamSwitchService(db, projectRoot)
              return svc.switchTeam(toTeam, pipeline)
            },
          }
          const { unmount, waitUntilExit } = render(
            React.createElement(ConfigWizard, {
              pipeline,
              projectConfig,
              configService,
              teamSwitchService: lazyTeamSwitchService,
              onSave: async (models: Record<string, string>) => {
                await configService.saveModelAssignments(models)
              },
              onCancel: () => {
                unmount()
              },
            })
          )
          await waitUntilExit?.()
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`Error: ${msg}\n`)
        process.exit(1)
      }
    })
}
