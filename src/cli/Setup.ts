import type { Command } from 'commander'
import React from 'react'
import { render } from 'ink'

import { ConfigLoader } from '@core/ConfigLoader.js'
import { ReadinessChecker } from '@core/ReadinessChecker.js'
import { requireInitialized } from './RequireInitialized.js'
import { SetupMenu } from '@ui/setup/SetupMenu.js'

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Check project readiness and run guided setup')
    .action(async () => {
      requireInitialized()

      const projectRoot = process.cwd()
      const checker = new ReadinessChecker(projectRoot)
      const readiness = checker.check()

      let provider = 'claude-cli'
      try {
        const configLoader = new ConfigLoader(projectRoot)
        const projectConfig = configLoader.loadProjectConfig()
        provider = projectConfig.provider
      } catch {
        // Use default provider if config can't be loaded
      }

      if (readiness.allReady) {
        process.stdout.write('All setup steps complete. Run `agentkit start` to launch the dashboard.\n')
        process.exit(0)
      }

      const app = render(
        React.createElement(SetupMenu, {
          readiness,
          provider,
          onSkip: () => {
            app.unmount()
            process.exit(0)
          },
        }),
      )

      await app.waitUntilExit()
    })
}
