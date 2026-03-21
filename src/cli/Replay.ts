import { join } from 'node:path';

import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { openDatabase } from '@core/db/Connection.js';
import { AgentKitError } from '@core/Errors.js';
import { ReplayService } from '@core/ReplayService.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import { ReplayApp } from '@ui/replay/ReplayApp.js';
import { requireInitialized } from './RequireInitialized.js';
import { Logger } from '@core/Logger.js';

export function registerReplayCommand(program: Command): void {
  program
    .command('replay <task-id>')
    .description('Replay a task execution visually')
    .action(async (taskIdStr: string) => {
      requireInitialized();
      try {
        const taskId = parseInt(taskIdStr, 10);
        if (isNaN(taskId)) {
          process.stderr.write('Error: task-id must be a number\n');
          process.exit(1);
        }

        const logger = Logger.getOrNoop('CLI:Replay');
        logger.info('replay: invoked', { taskId });

        const agentkitDir = join(process.cwd(), AGENTKIT_DIR);
        const db = openDatabase(join(agentkitDir, DB_FILENAME));
        const replayService = new ReplayService(db);

        const task = replayService.getTask(taskId);
        if (task === null) {
          process.stderr.write(`Error: Task ${taskId} not found\n`);
          process.exit(1);
        }

        const logCount = replayService.getTotalLogCount(taskId);
        if (logCount === 0) {
          process.stderr.write(`No logs found for task ${taskId}\n`);
          process.exit(0);
        }

        if (process.stdout.isTTY) process.stdout.write('\x1Bc');
        const app = render(
          React.createElement(ReplayApp, {
            replayService,
            taskId,
            onQuit: () => {
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
