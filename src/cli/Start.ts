import { join } from 'node:path';

import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { ConfigLoader } from '@core/ConfigLoader.js';
import { openDatabase } from '@core/db/Connection.js';
import { projects, stories } from '@core/db/schema.js';
import { AgentKitError } from '@core/Errors.js';
import { eventBus } from '@core/EventBus.js';
import { Logger } from '@core/Logger.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import { ReadinessChecker } from '@core/ReadinessChecker.js';
import { requireInitialized } from './RequireInitialized.js';
import { WorkerToggle } from './WorkerToggle.js';
import { UnifiedApp } from '@ui/UnifiedApp.js';
import { SetupMenu } from '@ui/setup/SetupMenu.js';

import { TraceService } from '@core/TraceService.js';
import { ResetService } from '@core/ResetService.js';
import { MarkDoneService } from '@core/MarkDoneService.js';
import { ConfigService } from '@core/ConfigService.js';
import { TeamSwitchService } from '@core/TeamSwitchService.js';
import { DiagnoseService } from '@core/DiagnoseService.js';
import { LoadService } from '@core/LoadService.js';
import { MarkdownParser } from '@core/MarkdownParser.js';

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Launch the interactive pipeline menu')
    .option('--skip-setup', 'Skip the readiness check and go directly to dashboard')
    .action(async (opts: { skipSetup?: boolean }) => {
      requireInitialized();

      try {
        const projectRoot = process.cwd();

        // Readiness gate: check if project setup is complete
        if (!opts.skipSetup) {
          const checker = new ReadinessChecker(projectRoot);
          const readiness = checker.check();

          if (!readiness.allReady) {
            let provider = 'claude-cli';
            try {
              const cl = new ConfigLoader(projectRoot);
              provider = cl.loadProjectConfig().provider;
            } catch { /* use default */ }

            let skipResolved: () => void;
            const skipPromise = new Promise<void>(resolve => { skipResolved = resolve; });

            const setupApp = render(
              React.createElement(SetupMenu, {
                readiness,
                provider,
                onSkip: () => {
                  setupApp.unmount();
                  skipResolved!();
                },
              }),
            );

            await skipPromise;
            // User chose "Skip" — fall through to dashboard
          }
        }

        const agentkitDir = join(projectRoot, AGENTKIT_DIR);
        const configLoader = new ConfigLoader(projectRoot);

        // Check if a team is configured before trying to load pipeline config
        if (!configLoader.hasTeam()) {
          process.stderr.write('No team configured yet. Run `agentkit setup` to create a team, or re-run `agentkit start` and select "Setup Team Config".\n');
          process.exit(1);
        }

        const pipelineConfig = configLoader.load();

        const dbPath = join(agentkitDir, DB_FILENAME);
        const db = openDatabase(dbPath);
        const project = db.select({ id: projects.id }).from(projects).limit(1).get();

        if (!project) {
          throw new AgentKitError('No project found in database. Run `agentkit init` first.', 'PROJECT_NOT_FOUND');
        }

        let activeCount = 0;
        let pendingCount = 0;
        try {
          const allStories = db.select({ id: stories.id, status: stories.status }).from(stories).all();
          activeCount = allStories.filter((s) => s.status === 'running').length;
          pendingCount = allStories.filter((s) => s.status === 'queued').length;
        } catch {
          // Schema not yet migrated; non-critical
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

        process.stdout.write('\x1Bc');
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

        setImmediate(() => {
          const log = Logger.getLogger('agentkit');
          log.info('Config loaded', {
            project: pipelineConfig.project.name,
            team: pipelineConfig.team,
            provider: pipelineConfig.provider,
          });
          log.info('DB connected', { path: dbPath });
          log.info('Stories summary', { active: activeCount, pending: pendingCount });
        });

        await app.waitUntilExit();
      } catch (err: unknown) {
        if (err instanceof AgentKitError) {
          process.stderr.write(`Error: ${err.message}\n`);
          process.exit(1);
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exit(1);
      }
    });
}
