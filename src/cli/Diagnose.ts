import { join } from 'node:path'
import { render } from 'ink'
import React from 'react'
import type { Command } from 'commander'

import { requireInitialized } from './RequireInitialized.js'
import { ConfigLoader } from '@core/ConfigLoader.js'
import { openDatabase } from '@core/db/Connection.js'
import { DiagnoseService } from '@core/DiagnoseService.js'
import { AgentKitError } from '@core/Errors.js'
import { DiagnoseWizard } from '@ui/diagnose/DiagnoseWizard.js'
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js'
import { Logger } from '@core/Logger.js'
import { useAppStore } from '@ui/stores/appStore.js'

export function registerDiagnoseCommand(program: Command): void {
  program
    .command('diagnose')
    .description('Diagnose pipeline health and surface errors')
    .option('--auto-fix', 'Non-interactively apply fixes and print a summary')
    .action(async (options: { autoFix?: boolean }) => {
      try {
        const logger = Logger.getOrNoop('CLI:Diagnose');
        logger.info('diagnose: invoked');
        requireInitialized()

        const projectRoot = process.cwd()
        const loader = new ConfigLoader(projectRoot)
        const pipelineConfig = loader.load()
        const dbPath = join(projectRoot, AGENTKIT_DIR, DB_FILENAME)
        const db = openDatabase(dbPath)

        const service = new DiagnoseService(db, pipelineConfig)

        if (options.autoFix) {
          const result = service.diagnose()
          const fixed = service.autoFix(result)
          process.stdout.write(
            `Auto-fix summary: reset ${fixed.resetCount}, re-routed ${fixed.reroutedCount}, skipped ${fixed.skippedCount}\n`
          )
          process.exit(0)
        }

        if (process.stdout.isTTY) process.stdout.write('\x1Bc');
        useAppStore.setState({ db, pipelineConfig })
        const { unmount, waitUntilExit } = render(
          React.createElement(DiagnoseWizard, {
            onComplete: () => unmount(),
            onCancel: () => unmount(),
          })
        )

        await waitUntilExit()
      } catch (err) {
        if (err instanceof AgentKitError) {
          process.stderr.write(`Error: ${err.message}\n`)
          process.exit(1)
        }
        throw err
      }
    })
}
