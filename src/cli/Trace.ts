import { join } from 'node:path';

import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { openDatabase } from '@core/db/Connection.js';
import { projects } from '@core/db/schema.js';
import { AgentKitError } from '@core/Errors.js';
import { TraceService } from '@core/TraceService.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import { requireInitialized } from './RequireInitialized.js';
import { TraceWizard } from '@ui/trace/TraceWizard.js';
import { Logger } from '@core/Logger.js';

export function registerTraceCommand(program: Command): void {
  program
    .command('trace')
    .description('Browse pipeline execution history in an interactive tree view')
    .action(async () => {
      requireInitialized();

      try {
        const logger = Logger.getOrNoop('CLI:Trace');
        logger.info('trace: invoked');
        const agentkitDir = join(process.cwd(), AGENTKIT_DIR);
        const db = openDatabase(join(agentkitDir, DB_FILENAME));
        const project = db.select({ id: projects.id }).from(projects).limit(1).get();

        if (!project) {
          throw new AgentKitError('No project found in database. Run `agentkit init` first.', 'PROJECT_NOT_FOUND');
        }

        const traceService = new TraceService(db);

        if (process.stdout.isTTY) process.stdout.write('\x1Bc');
        const app = render(
          React.createElement(TraceWizard, {
            traceService,
            projectId: project.id,
            onComplete: () => app.unmount(),
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
