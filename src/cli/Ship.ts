import { join } from 'node:path'

import type { Command } from 'commander'
import { eq, and } from 'drizzle-orm'
import React from 'react'
import { render } from 'ink'

import { openDatabase } from '@core/db/Connection.js'
import { projects, epics, stories } from '@core/db/schema.js'
import { ConfigLoader } from '@core/ConfigLoader.js'
import { ShipService } from '@core/ShipService.js'
import { Logger } from '@core/Logger.js'
import { resolveDepStatuses, formatDepList } from '@core/DependencyDisplay.js'
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js'
import { ShipWizard } from '@ui/ship/ShipWizard.js'
import { requireInitialized } from './RequireInitialized.js'
import { useAppStore } from '@ui/stores/appStore.js'

function printWaitingStories(
  db: ReturnType<typeof openDatabase>,
  projectId: number,
): void {
  const waitingRows = db
    .select({
      id: stories.id,
      storyKey: stories.storyKey,
      epicKey: epics.epicKey,
      dependsOn: stories.dependsOn,
    })
    .from(stories)
    .innerJoin(epics, eq(stories.epicId, epics.id))
    .where(and(eq(epics.projectId, projectId), eq(stories.status, 'waiting')))
    .all()

  for (const row of waitingRows) {
    const deps = resolveDepStatuses(db, row.dependsOn, projectId)
    const depStr = formatDepList(deps)
    console.log(`  Story ${row.epicKey}.${row.storyKey} → waiting (needs: ${depStr})`)
  }
}

export function registerShipCommand(program: Command): void {
  program
    .command('ship')
    .description('Ship loaded stories into the pipeline queue')
    .option('--epic <n>', 'Ship all unshipped stories from epic N')
    .option('--all', 'Ship all unshipped stories')
    .action(async (options: { epic?: string; all?: boolean }) => {
      requireInitialized()
      try {
        const logger = Logger.getOrNoop('CLI:Ship')
        logger.info('ship: invoked', { epic: options.epic, all: options.all })
        const agentkitDir = join(process.cwd(), AGENTKIT_DIR)
        const dbPath = join(agentkitDir, DB_FILENAME)
        const db = openDatabase(dbPath)

        const project = db.select({ id: projects.id }).from(projects).get()
        if (!project) {
          console.error('No project found in database. Run `agentkit init` first.')
          process.exit(1)
        }

        const config = new ConfigLoader(process.cwd()).load()
        const firstStageName = config.stages[0]!.name
        const activeTeam = config.team
        const service = new ShipService(db)

        if (options.all) {
          const allStories = service.getStories(project.id)
          const eligible = allStories.filter(s => !s.hasExistingTasks && s.status !== 'in_progress')
          if (eligible.length === 0) {
            console.log('0 stories to ship.')
            process.exit(0)
          }
          const result = service.shipStories(
            eligible.map(s => s.id),
            firstStageName,
            activeTeam
          )
          const summary = result.waitingCount > 0
            ? `Shipped ${result.shippedCount} stories, ${result.waitingCount} waiting for dependencies (stage: ${firstStageName}).`
            : `Shipped ${result.shippedCount} stories into the pipeline (stage: ${firstStageName}).`
          console.log(summary)
          printWaitingStories(db, project.id)
          return
        }

        if (options.epic !== undefined) {
          const epicNum = parseInt(options.epic, 10)
          if (isNaN(epicNum)) {
            console.error('Invalid epic number')
            process.exit(1)
          }
          const epicRow = db
            .select({ id: epics.id })
            .from(epics)
            .where(and(eq(epics.projectId, project.id), eq(epics.epicKey, String(epicNum))))
            .get()
          if (!epicRow) {
            console.error(`Epic ${epicNum} not found`)
            process.exit(1)
          }
          const epicStories = service.getStories(project.id, epicRow.id)
          const eligible = epicStories.filter(
            s => !s.hasExistingTasks && s.status !== 'in_progress'
          )
          if (eligible.length === 0) {
            console.log('0 stories to ship.')
            process.exit(0)
          }
          const result = service.shipStories(
            eligible.map(s => s.id),
            firstStageName,
            activeTeam
          )
          const epicSummary = result.waitingCount > 0
            ? `Shipped ${result.shippedCount} stories, ${result.waitingCount} waiting for dependencies (stage: ${firstStageName}).`
            : `Shipped ${result.shippedCount} stories into the pipeline (stage: ${firstStageName}).`
          console.log(epicSummary)
          printWaitingStories(db, project.id)
          return
        }

        // Interactive mode
        useAppStore.setState({ db, projectId: project.id, pipelineConfig: config })
        const app = render(
          React.createElement(ShipWizard, {
            onComplete: () => {
              app.unmount()
            },
            onCancel: () => {
              app.unmount()
            },
          })
        )
        await app.waitUntilExit()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
