import { join } from 'node:path';

import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { openDatabase } from '@core/db/Connection.js';
import { projects } from '@core/db/schema.js';
import { HistoryService } from '@core/HistoryService.js';
import { AgentKitError } from '@core/Errors.js';
import type { HistoryFilter } from '@core/HistoryTypes.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import { HistoryWizard } from '@ui/history/HistoryWizard.js';
import { requireInitialized } from './RequireInitialized.js';
import { Logger } from '@core/Logger.js';
import { useAppStore } from '@ui/stores/appStore.js';

interface HistoryOptions {
  epic?: number;
  status?: string;
  last?: number;
}

export function registerHistoryCommand(program: Command): void {
  program
    .command('history')
    .description('View completed task history and reports')
    .option('--epic <n>', 'Filter by epic number', parseInt)
    .option('--status <status>', 'Filter by status: done|failed')
    .option('--last <n>', 'Show last N stories', parseInt)
    .action(async (options: HistoryOptions) => {
      requireInitialized();
      try {
        const logger = Logger.getOrNoop('CLI:History');
        logger.info('history: invoked');
        if (options.status !== undefined && options.status !== 'done' && options.status !== 'failed') {
          process.stderr.write(`Invalid --status value "${options.status}". Must be "done" or "failed".\n`);
          process.exit(1);
        }

        if (options.last !== undefined && (isNaN(options.last) || options.last <= 0)) {
          process.stderr.write(`Invalid --last value. Must be a positive integer.\n`);
          process.exit(1);
        }

        if (options.epic !== undefined && isNaN(options.epic)) {
          process.stderr.write(`Invalid --epic value. Must be a number.\n`);
          process.exit(1);
        }

        const db = openDatabase(join(process.cwd(), AGENTKIT_DIR, DB_FILENAME));

        const project = db.select({ id: projects.id }).from(projects).limit(1).get();
        if (!project) {
          process.stderr.write('No project found in database. Run `agentkit init` first.\n');
          process.exit(1);
        }

        const filter: HistoryFilter = {};
        if (options.epic !== undefined) filter.epicId = options.epic;
        if (options.status === 'done' || options.status === 'failed') filter.status = options.status;
        if (options.last !== undefined) filter.last = options.last;

        const isPlainText =
          options.epic !== undefined ||
          options.status !== undefined ||
          options.last !== undefined ||
          !process.stdout.isTTY;

        if (isPlainText) {
          const service = new HistoryService(db);
          const stats = service.getStatistics(project.id);
          const storyList = service.getStories(project.id, filter);

          process.stdout.write(`Total completed: ${stats.totalCompleted}\n`);
          for (const story of storyList) {
            process.stdout.write(
              `${story.storyKey}  ${story.title}  ${story.status}  stages=${story.stagesPassed.length}  attempts=${story.totalAttempts}\n`,
            );
          }
          process.exit(0);
        }

        if (process.stdout.isTTY) process.stdout.write('\x1Bc');
        useAppStore.setState({ db, projectId: project.id })
        const app = render(
          React.createElement(HistoryWizard, {
            filter,
            onExit: () => {
              app.unmount();
            },
          }),
        );
        await app.waitUntilExit();
      } catch (err: unknown) {
        if (err instanceof AgentKitError) {
          process.stderr.write(`Error: ${err.message}\n`);
          process.exit(1);
        }
        throw err;
      }
    });
}
