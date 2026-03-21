import { join } from 'node:path';
import { statSync } from 'node:fs';

import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { requireInitialized } from './RequireInitialized.js';
import { WorkerToggle } from './WorkerToggle.js';
import { ConfigLoader } from '@core/ConfigLoader.js';
import { openDatabase } from '@core/db/Connection.js';
import { projects } from '@core/db/schema.js';
import { Pipeline as CorePipeline } from '@core/Pipeline.js';
import { eventBus } from '@core/EventBus.js';
import { Logger } from '@core/Logger.js';
import { Pipeline as WorkerPipeline } from '@workers/Pipeline.js';
import { ClaudeCliProvider } from '@providers/agent/ClaudeCliProvider.js';
import { GeminiCliProvider } from '@providers/agent/GeminiCliProvider.js';
import { CodexCliProvider } from '@providers/agent/CodexCliProvider.js';
import { AgentKitError } from '@core/Errors.js';
import { AGENTKIT_DIR, DB_FILENAME, DB_SIZE_WARN_THRESHOLD } from '@config/defaults.js';
import { SimpleLogger } from '@ui/simple/SimpleLogger.js';
import { UnifiedApp } from '@ui/UnifiedApp.js';

import { TraceService } from '@core/TraceService.js';
import { ResetService } from '@core/ResetService.js';
import { MarkDoneService } from '@core/MarkDoneService.js';
import { ConfigService } from '@core/ConfigService.js';
import { TeamSwitchService } from '@core/TeamSwitchService.js';
import { DiagnoseService } from '@core/DiagnoseService.js';
import { LoadService } from '@core/LoadService.js';
import { MarkdownParser } from '@core/MarkdownParser.js';

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Start pipeline workers for all stages')
    .option('--simple', 'Use plain log output instead of TUI dashboard')
    .action(async (options: { simple?: boolean }) => {
      requireInitialized();

      const useSimple = options.simple === true || !process.stdout.isTTY;

      if (useSimple) {
        process.stdout.write('agentkit run \u2014 simple log mode\nPress Ctrl+C to stop.\n\n');
      }

      try {
        const projectRoot = process.cwd();
        const configLoader = new ConfigLoader(projectRoot);
        const pipelineConfig = configLoader.load();
        const dbPath = join(projectRoot, AGENTKIT_DIR, DB_FILENAME);
        try {
          const { size } = statSync(dbPath);
          if (size > DB_SIZE_WARN_THRESHOLD) {
            const mb = (size / (1024 * 1024)).toFixed(0);
            process.stderr.write(
              `Warning: database is ${mb} MB. Run \`agentkit cleanup\` to reclaim space.\n`,
            );
          }
        } catch {
          // DB file not yet created; ignore
        }
        const db = openDatabase(dbPath);

        const project = db.select({ id: projects.id }).from(projects).limit(1).get();
        if (!project) {
          throw new AgentKitError('No project found in database. Run `agentkit init` first.', 'PROJECT_NOT_FOUND');
        }

        if (useSimple) {
          const simpleLogger = new SimpleLogger(eventBus);

          // Wire up WorkerPipeline startup when core Pipeline signals ready
          eventBus.on('pipeline:ready', () => {
            const provider = pipelineConfig.provider === 'gemini-cli' 
              ? new GeminiCliProvider()
              : pipelineConfig.provider === 'codex-cli'
              ? new CodexCliProvider()
              : new ClaudeCliProvider();
              
            const workerPipeline = new WorkerPipeline({
              db,
              pipelineConfig,
              provider,
              projectRoot,
            });
            workerPipeline.start().catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              process.stderr.write(`Worker pipeline error: ${message}\n`);
              process.exit(1);
            });
          });

          eventBus.on('pipeline:stop', () => {
            simpleLogger.detach();
          });

          // Core Pipeline handles crash recovery and emits pipeline:ready
          const corePipeline = new CorePipeline({
            db,
            eventBus,
            projectId: project.id,
          });
          await corePipeline.start();
        } else {
          const workerToggle = new WorkerToggle({
            db,
            pipelineConfig,
            eventBus,
            projectId: project.id,
            projectRoot,
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
              onTerminateWorkers: () => workerToggle.terminate(),
              onDrain: () => workerToggle.drain(),
            }),
          );

          setImmediate(async () => {
            try {
              // Register one-time listener for pipeline:ready → start workers
              workerToggle.registerReadyListener();

              // Core Pipeline handles crash recovery and emits pipeline:ready
              const corePipeline = new CorePipeline({
                db,
                eventBus,
                projectId: project.id,
              });
              const recovery = await corePipeline.start();

              if (recovery.recoveredCount > 0) {
                const log = Logger.getLogger('agentkit');
                log.info(`Recovered ${recovery.recoveredCount} orphaned task(s) from previous run.`);
              }
            } catch (err) {
              if (err instanceof AgentKitError) {
                process.stderr.write(`Error: ${err.message}\n`);
                app.unmount();
                process.exit(1);
              }
              throw err;
            }
          });

          await app.waitUntilExit();
        }
      } catch (err) {
        if (err instanceof AgentKitError) {
          process.stderr.write(`Error: ${err.message}\n`);
          process.exit(1);
        }
        throw err;
      }
    });
}
