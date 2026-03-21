import { join } from 'node:path';

import type { Command } from 'commander';
import { eq, and } from 'drizzle-orm';

import { openDatabase } from '@core/db/Connection.js';
import { projects, epics, stories } from '@core/db/schema.js';
import { ConfigLoader } from '@core/ConfigLoader.js';
import { StateManager } from '@core/StateManager.js';
import { AgentKitError } from '@core/Errors.js';
import { resolveDepStatuses, formatDepList } from '@core/DependencyDisplay.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import { requireInitialized } from './RequireInitialized.js';
import { Logger } from '@core/Logger.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current pipeline and task status')
    .action(() => {
      requireInitialized();
      try {
        const logger = Logger.getOrNoop('CLI:Status');
        logger.info('status: invoked');
        const db = openDatabase(join(process.cwd(), AGENTKIT_DIR, DB_FILENAME));
        let teamName = '';
        try {
          const config = new ConfigLoader(process.cwd()).load();
          teamName = config.team;
        } catch {
          // proceed without config; status still shows DB-derived data
        }
        const sm = new StateManager(db, teamName);

        const storyCountsByStatus = sm.getStoryCountsByStatus();
        const queueByStage = sm.getQueueDepthByStage();
        const runningByStage = sm.getRunningTasksByStage();

        const knownStatuses = ['draft', 'in_progress', 'done', 'failed', 'waiting'];
        const storiesParts = knownStatuses
          .filter((s) => (storyCountsByStatus[s] ?? 0) > 0)
          .map((s) => `${s}=${storyCountsByStatus[s]}`);
        const storiesLine = `Stories:   ${storiesParts.join('  ')}`;

        const allStages = [...new Set([...Object.keys(queueByStage)])];
        const queueParts = allStages
          .filter((s) => (queueByStage[s] ?? 0) > 0)
          .map((s) => `${s}=${queueByStage[s]}`);
        const queueLine = `Queue:     ${queueParts.join('  ')}`;

        const runningStages = [...new Set([...Object.keys(runningByStage)])];
        const workerParts = runningStages
          .filter((s) => (runningByStage[s] ?? 0) > 0)
          .map((s) => `${s}=${runningByStage[s]}`);
        const workersLine = `Workers:   ${workerParts.join('  ')}`;

        process.stdout.write(storiesLine + '\n');
        process.stdout.write(queueLine + '\n');
        process.stdout.write(workersLine + '\n');

        // Waiting stories section (AC3) — best-effort, skip if DB schema not available
        try {
          const project = db.select({ id: projects.id }).from(projects).get();
          if (project) {
            const waitingRows = db
              .select({
                id: stories.id,
                storyKey: stories.storyKey,
                epicKey: epics.epicKey,
                dependsOn: stories.dependsOn,
              })
              .from(stories)
              .innerJoin(epics, eq(stories.epicId, epics.id))
              .where(and(eq(epics.projectId, project.id), eq(stories.status, 'waiting')))
              .all();

            if (waitingRows.length > 0) {
              process.stdout.write('Waiting:\n');
              for (const row of waitingRows) {
                const deps = resolveDepStatuses(db, row.dependsOn, project.id);
                const depStr = formatDepList(deps);
                process.stdout.write(`  ${row.epicKey}.${row.storyKey} → needs: ${depStr}\n`);
              }
            }
          }
        } catch {
          // Skip waiting section if DB doesn't support the query
        }

        process.exit(0);
      } catch (err: unknown) {
        if (err instanceof AgentKitError) {
          process.stderr.write(`Error: ${err.message}\n`);
          process.exit(1);
        }
        throw err;
      }
    });
}
