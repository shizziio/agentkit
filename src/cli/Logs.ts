import { join } from 'node:path'

import type { Command } from 'commander'
import React from 'react'
import { render } from 'ink'

import { requireInitialized } from './RequireInitialized.js'
import { openDatabase } from '@core/db/Connection.js'
import { projects } from '@core/db/schema.js'
import { AgentKitError } from '@core/Errors.js'
import { eventBus } from '@core/EventBus.js'
import { LogsService } from '@core/LogsService.js'
import type { StreamEvent } from '@core/EventTypes.js'
import type { LogEntry } from '@core/LogsTypes.js'
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js'
import { formatLogEntry } from '@ui/logs/formatLogEntry.js'
import { LogsViewer } from '@ui/logs/LogsViewer.js'
import { Logger } from '@core/Logger.js'

function streamEventToLogEntry(event: StreamEvent): LogEntry {
  return {
    id: 0,
    taskId: event.taskId,
    sequence: 0,
    eventType: event.type,
    eventData: event.data as Record<string, unknown>, // widened for LogEntry.eventData compatibility
    createdAt: new Date(event.timestamp).toISOString(),
    stageName: event.stageName,
    storyId: 0,
  }
}

export function registerLogsCommand(program: Command): void {
  program
    .command('logs')
    .description('View task logs')
    .option('--task <id>', 'Filter by task ID')
    .option('--stage <name>', 'Filter by stage name')
    .option('--follow', 'Stream live log events')
    .option('--last <n>', 'Number of recent tasks to show', '5')
    .action(async (options: { task?: string; stage?: string; follow?: boolean; last?: string }) => {
      requireInitialized()

      try {
        const logger = Logger.getOrNoop('CLI:Logs');
        const taskId = options.task !== undefined ? parseInt(options.task, 10) : undefined
        logger.info('logs: invoked', { taskId });
        const stageName = options.stage
        const follow = options.follow === true

        const rawLast = parseInt(options.last ?? '5', 10)
        const lastN = isNaN(rawLast) ? 5 : Math.min(100, Math.max(1, rawLast))

        const dbPath = join(process.cwd(), AGENTKIT_DIR, DB_FILENAME)
        const db = openDatabase(dbPath)

        const project = db.select({ id: projects.id }).from(projects).limit(1).get()
        if (!project) {
          throw new AgentKitError(
            'No project found in database. Run `agentkit init` first.',
            'PROJECT_NOT_FOUND'
          )
        }

        const logsResult = new LogsService(db).query(project.id, {
          taskId,
          stageName,
          lastN,
        })

        if (follow) {
          for (const entry of logsResult.entries) {
            process.stdout.write(formatLogEntry(entry) + '\n')
          }

          const streamEvents: Array<keyof import('@core/EventTypes.js').EventMap> = [
            'stream:thinking',
            'stream:tool_use',
            'stream:tool_result',
            'stream:text',
            'stream:error',
            'stream:done',
          ]

          for (const evName of streamEvents) {
            eventBus.on(evName, (payload: any) => {
              if (stageName !== undefined && payload.stageName !== stageName) {
                return
              }
              const entry = streamEventToLogEntry(payload as StreamEvent)
              process.stdout.write(formatLogEntry(entry) + '\n')
            })
          }

          // Listeners are intentionally not unregistered: follow mode only terminates via
          // process exit, so cleanup only happens at exit anyway.
          process.on('SIGINT', () => process.exit(0))
          process.on('SIGTERM', () => process.exit(0))
          return
        }

        if (logsResult.entries.length === 0) {
          process.stdout.write('No logs found.\n')
          process.exit(0)
          return
        }

        if (!process.stdout.isTTY) {
          for (const entry of logsResult.entries) {
            process.stdout.write(formatLogEntry(entry) + '\n')
          }
          process.exit(0)
          return
        }

        const app = render(
          React.createElement(LogsViewer, {
            entries: logsResult.entries,
            onExit: () => app.unmount(),
          })
        )

        await app.waitUntilExit()
      } catch (err: unknown) {
        if (err instanceof AgentKitError) {
          process.stderr.write(`Error: ${err.message}\n`)
          process.exit(1)
        }
        throw err
      }
    })
}
