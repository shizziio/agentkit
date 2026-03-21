import { join } from 'node:path';

import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { eq } from 'drizzle-orm';

import { openDatabase } from '@core/db/Connection.js';
import { projects, epics, stories } from '@core/db/schema.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import { LoadWizard } from '@ui/load/LoadWizard.js';
import { LoadService } from '@core/LoadService.js';
import { MarkdownParser } from '@core/MarkdownParser.js';
import { requireInitialized } from './RequireInitialized.js';
import { Logger } from '@core/Logger.js';
import { useAppStore } from '@ui/stores/appStore.js';

export function registerLoadCommand(program: Command): void {
  program
    .command("load")
    .description("Load epics and stories from a markdown file")
    .argument("[file]", "Path to markdown file")
    .option("--simple", "Non-interactive mode (auto-confirm)")
    .action(async (file: string | undefined, options: { simple?: boolean }) => {
      try {
        const logger = Logger.getOrNoop('CLI:Load');
        logger.info('load: invoked', { file });
        requireInitialized();
        const agentkitDir = join(process.cwd(), AGENTKIT_DIR);

        if (options.simple && !file) {
          console.error("File path required in non-interactive mode");
          process.exit(1);
        }

        const dbPath = join(agentkitDir, DB_FILENAME);
        const db = openDatabase(dbPath);

        const project = db.select({ id: projects.id }).from(projects).limit(1).get();

        if (!project) {
          console.error(
            "No project found in database. Run `agentkit init` first.",
          );
          process.exit(1);
        }

        const loadService = new LoadService(db);
        const markdownParser = new MarkdownParser();

        useAppStore.setState({ projectId: project.id, loadService, markdownParser })
        const app = render(
          React.createElement(LoadWizard, {
            filePath: file,
            isSimple: options.simple ?? false,
            onComplete: () => {
              app.unmount();
            },
            onCancel: () => {
              app.unmount();
            },
          }),
        );

        await app.waitUntilExit();

        // Dependency graph summary (AC5)
        const depRows = db
          .select({ dependsOn: stories.dependsOn })
          .from(stories)
          .innerJoin(epics, eq(stories.epicId, epics.id))
          .where(eq(epics.projectId, project.id))
          .all();

        const totalStories = depRows.length;
        if (totalStories > 0) {
          let totalEdges = 0;
          for (const row of depRows) {
            if (!row.dependsOn) continue;
            try {
              const parsed = JSON.parse(row.dependsOn) as unknown;
              if (Array.isArray(parsed)) {
                totalEdges += parsed.length;
              }
            } catch {
              // skip malformed JSON — count 0 edges for this story
            }
          }
          // TODO: use DependencyResolver.hasCycles when Story 21.5 is merged
          const cycles = 0;
          console.log(`Dependency graph: ${totalStories} stories, ${totalEdges} edges, ${cycles} cycles`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
