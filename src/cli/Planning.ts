import { join } from 'node:path'
import { existsSync } from 'node:fs'

import type { Command } from 'commander'

import { AGENTKIT_DIR } from '@config/defaults.js'
import { ConfigLoader } from '@core/ConfigLoader.js'
import { ReadinessChecker } from '@core/ReadinessChecker.js'
import { requireInitialized } from './RequireInitialized.js'
import { launchInteractiveSession } from '@shared/InteractiveSession.js'

function resolveResource(projectRoot: string, relativePath: string): string {
  const localPath = join(projectRoot, AGENTKIT_DIR, 'resources', relativePath)
  if (existsSync(localPath)) return localPath
  return localPath
}

export function registerPlanningCommand(program: Command): void {
  program
    .command('planning')
    .description('Launch interactive planning session (architect + planning workflow)')
    .action(() => {
      requireInitialized()

      const projectRoot = process.cwd()

      // Planning requires docs + team to be set up first
      const checker = new ReadinessChecker(projectRoot)
      const readiness = checker.check()
      const docsStep = readiness.steps.find(s => s.id === 'project-docs')
      const teamStep = readiness.steps.find(s => s.id === 'team-config')

      if (docsStep?.status === 'missing') {
        process.stderr.write('Project docs not found. Run `agentkit start` and setup Project Documentation first.\n')
        process.exit(1)
      }
      if (teamStep?.status === 'missing') {
        process.stderr.write('No team configured. Run `agentkit start` and setup Team Configuration first.\n')
        process.stderr.write('Planning requires a team so epics can be assigned to the correct pipeline.\n')
        process.exit(1)
      }

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
          resolveResource(projectRoot, 'agents/architect.md'),
          resolveResource(projectRoot, 'workflows/planning.md'),
        ],
      })
    })
}
