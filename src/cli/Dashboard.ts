import { join } from 'node:path';

import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { ConfigLoader } from '@core/ConfigLoader.js';
import { openDatabase } from '@core/db/Connection.js';
import { projects } from '@core/db/schema.js';
import { AgentKitError } from '@core/Errors.js';
import { eventBus } from '@core/EventBus.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import { requireInitialized } from './RequireInitialized.js';
import { WorkerToggle } from './WorkerToggle.js';
import { UnifiedApp } from '@ui/UnifiedApp.js';
import { Logger } from '@core/Logger.js';

import { TraceService } from '@core/TraceService.js';
import { ResetService } from '@core/ResetService.js';
import { MarkDoneService } from '@core/MarkDoneService.js';
import { ConfigService } from '@core/ConfigService.js';
import { TeamSwitchService } from '@core/TeamSwitchService.js';
import { DiagnoseService } from '@core/DiagnoseService.js';
import { LoadService } from '@core/LoadService.js';
import { MarkdownParser } from '@core/MarkdownParser.js';

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Open the real-time TUI pipeline dashboard')
    .action(async () => {
      requireInitialized();

      try {
        const logger = Logger.getOrNoop('CLI:Dashboard');
        logger.info('dashboard: invoked');
        const agentkitDir = join(process.cwd(), AGENTKIT_DIR);
        const configLoader = new ConfigLoader(process.cwd());
        const pipelineConfig = configLoader.load();

        const db = openDatabase(join(agentkitDir, DB_FILENAME));
        const project = db.select({ id: projects.id }).from(projects).limit(1).get();

        if (!project) {
          throw new AgentKitError('No project found in database. Run `agentkit init` first.', 'PROJECT_NOT_FOUND');
        }

        const workerToggle = new WorkerToggle({
          db,
          pipelineConfig,
          eventBus,
          projectId: project.id,
          projectRoot: process.cwd(),
        });

        // Instantiate services here (CLI layer) instead of in the UI layer
        const traceService = new TraceService(db);
        const resetService = new ResetService(db, eventBus, pipelineConfig);
        const markDoneService = new MarkDoneService(db, eventBus);
        const configService = new ConfigService(process.cwd(), eventBus);
        const teamSwitchService = new TeamSwitchService(db, process.cwd(), { isRunning: () => workerToggle.isRunning() });
        const diagnoseService = new DiagnoseService(db, pipelineConfig);
        const loadService = new LoadService(db);
        const markdownParser = new MarkdownParser();

        const app = render(
          React.createElement(UnifiedApp, {
            pipelineConfig,
            projectId: project.id,
            db,
            eventBus,
            traceService,
            resetService,
            markDoneService,
            configService,
            teamSwitchService,
            diagnoseService,
            loadService,
            markdownParser,
            onComplete: () => app.unmount(),
            onToggleWorkers: () => workerToggle.toggle(),
            onDrain: () => workerToggle.drain(),
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
