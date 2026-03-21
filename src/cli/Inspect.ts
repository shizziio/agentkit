import path from 'node:path'

import { type Command } from 'commander'
import { render } from 'ink'
import React from 'react'

import { requireInitialized } from './RequireInitialized.js'
import { openDatabase } from '@core/db/Connection.js'
import { runMigrations } from '@core/db/RunMigrations.js'
import { InspectService } from '@core/InspectService.js'
import type { TaskInspectData } from '@core/InspectTypes.js'
import { InspectViewer } from '@ui/inspect/InspectViewer.js'
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js'
import { Logger } from '@core/Logger.js'

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect <taskId>')
    .description(
      'Show full context for a task: metadata, story, chain, prompt, input, output, events'
    )
    .option('--json', 'Output full data as JSON and exit')
    .option('--output-only', 'Output task output JSON and exit')
    .option('--input-only', 'Output task input JSON and exit')
    .option('--prompt-only', 'Output task prompt text and exit')
    .action(
      async (
        taskId: string,
        options: { json?: boolean; outputOnly?: boolean; inputOnly?: boolean; promptOnly?: boolean }
      ) => {
        requireInitialized()

        const parsedId = parseInt(taskId, 10)
        if (isNaN(parsedId)) {
          process.stderr.write(`Error: taskId must be a valid integer, got: ${taskId}\n`)
          process.exit(1)
        }

        const logger = Logger.getOrNoop('CLI:Inspect');
        logger.info('inspect: invoked', { taskId: parsedId });

        const dbPath = path.join(process.cwd(), AGENTKIT_DIR, DB_FILENAME)
        const db = openDatabase(dbPath)
        runMigrations(db)

        const service = new InspectService(db)
        let data: TaskInspectData
        try {
          data = service.getTaskInspect(parsedId)
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          process.stderr.write(`Error: ${message}\n`)
          process.exit(1)
        }

        // --json takes priority
        if (options.json) {
          process.stdout.write(JSON.stringify(data, null, 2) + '\n')
          process.exit(0)
        }

        if (options.outputOnly) {
          const val = data.task.output
          if (val === null || val === undefined) {
            process.stdout.write('(none)\n')
          } else {
            try {
              process.stdout.write(JSON.stringify(JSON.parse(val), null, 2) + '\n')
            } catch {
              process.stdout.write(val + '\n')
            }
          }
          process.exit(0)
        }

        if (options.inputOnly) {
          const val = data.task.input
          if (val === null || val === undefined) {
            process.stdout.write('(none)\n')
          } else {
            try {
              process.stdout.write(JSON.stringify(JSON.parse(val), null, 2) + '\n')
            } catch {
              process.stdout.write(val + '\n')
            }
          }
          process.exit(0)
        }

        if (options.promptOnly) {
          process.stdout.write((data.task.prompt ?? '(none)') + '\n')
          process.exit(0)
        }

        if (!process.stdout.isTTY) {
          // Plain-text summary fallback
          const t = data.task
          process.stdout.write(
            `Task #${t.id} [${t.stageName}] status=${t.status} attempt=${t.attempt}/${t.maxAttempts}\n`
          )
          process.stdout.write(`Story: ${data.story.storyKey} - ${data.story.title}\n`)
          process.stdout.write(`Epic: ${data.epic.epicKey} - ${data.epic.title}\n`)
          process.exit(0)
        }

        const { unmount, waitUntilExit } = render(
          React.createElement(InspectViewer, {
            data,
            onComplete: () => unmount(),
          })
        )

        await waitUntilExit()
      }
    )
}
