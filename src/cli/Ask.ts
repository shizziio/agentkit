import { join } from 'node:path'
import { existsSync } from 'node:fs'

import type { Command } from 'commander'

import { AGENTKIT_DIR } from '@config/defaults.js'
import { ConfigLoader } from '@core/ConfigLoader.js'
import { requireInitialized } from './RequireInitialized.js'
import { launchInteractiveSession } from '@shared/InteractiveSession.js'

function resolveResource(projectRoot: string, relativePath: string): string {
  const localPath = join(projectRoot, AGENTKIT_DIR, 'resources', relativePath)
  if (existsSync(localPath)) return localPath
  return localPath
}

export function registerAskCommand(program: Command): void {
  program
    .command('ask')
    .description('Launch interactive session with AgentKit Master agent')
    .action(() => {
      requireInitialized()

      const projectRoot = process.cwd()
      let provider = 'claude-cli'
      try {
        const configLoader = new ConfigLoader(projectRoot)
        provider = configLoader.loadProjectConfig().provider
      } catch {
        // Use default
      }

      launchInteractiveSession({
        provider,
        systemPromptFiles: [
          resolveResource(projectRoot, 'agents/agent-kit-master.md'),
        ],
      })
    })
}
