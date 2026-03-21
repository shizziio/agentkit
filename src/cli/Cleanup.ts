import { createInterface } from 'node:readline';
import { join } from 'node:path';

import type { Command } from 'commander';

import { requireInitialized } from './RequireInitialized.js';
import { openDatabase } from '@core/db/Connection.js';
import { CleanupService } from '@core/CleanupService.js';
import { AgentKitError } from '@core/Errors.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import type { DatabaseStats } from '@core/CleanupTypes.js';
import { Logger } from '@core/Logger.js';

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024) return '< 1 KB';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function printStats(dbPath: string, stats: DatabaseStats): void {
  const sizeStr = formatBytes(stats.fileSizeBytes);
  process.stdout.write(`Database: ${dbPath} (${sizeStr})\n\n`);
  process.stdout.write(`Table counts:\n`);

  const rows: Array<[string, number]> = [
    ['projects', stats.tableCounts.projects],
    ['epics', stats.tableCounts.epics],
    ['stories', stats.tableCounts.stories],
    ['tasks', stats.tableCounts.tasks],
    ['task_logs', stats.tableCounts.taskLogs],
  ];

  const maxCountLen = Math.max(...rows.map(([, n]) => n.toLocaleString().length));

  for (const [label, n] of rows) {
    const paddedLabel = label.padEnd(9);
    const paddedCount = n.toLocaleString().padStart(maxCountLen);
    process.stdout.write(`  ${paddedLabel} : ${paddedCount}\n`);
  }
}

async function confirm(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Confirm deletion? [Y/N]: ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

interface CleanupOptions {
  olderThan?: string;
  keepLast?: string;
  dryRun?: boolean;
  force?: boolean;
}

export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Inspect database size and prune old data')
    .option('--older-than <days>', 'Delete task logs for tasks completed more than N days ago')
    .option('--keep-last <n>', 'Delete all completed stories beyond the most-recent N')
    .option('--dry-run', 'Preview changes without deleting anything')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options: CleanupOptions) => {
      try {
        const logger = Logger.getOrNoop('CLI:Cleanup');
        logger.info('cleanup: invoked');
        requireInitialized();

        if (options.olderThan !== undefined && options.keepLast !== undefined) {
          process.stderr.write('Cannot use --older-than and --keep-last together.\n');
          process.exit(1);
        }

        const dbPath = join(process.cwd(), AGENTKIT_DIR, DB_FILENAME);
        const db = openDatabase(dbPath);
        const svc = new CleanupService(db, dbPath);

        const stats = svc.getDatabaseStats();
        printStats(dbPath, stats);

        if (options.olderThan === undefined && options.keepLast === undefined) {
          process.exit(0);
        }

        if (options.olderThan !== undefined) {
          const days = parseInt(options.olderThan, 10);
          if (isNaN(days) || days <= 0) {
            process.stderr.write(
              'Invalid value for --older-than. Must be a positive integer.\n',
            );
            process.exit(1);
          }

          const preview = svc.previewOlderThan(days);
          process.stdout.write(`\nCleanup preview (--older-than ${days} days, before ${preview.cutoffDate}):\n`);
          process.stdout.write(`  Task logs to delete : ${preview.taskLogCount.toLocaleString()}\n`);
          process.stdout.write(`  Task rows preserved : (task metadata kept)\n`);

          if (preview.taskLogCount === 0) {
            process.stdout.write('\nNothing to delete.\n');
            process.exit(0);
          }

          if (options.dryRun === true) {
            process.stdout.write('\n[dry-run] No changes made.\n');
            process.exit(0);
          }

          if (options.force !== true) {
            process.stdout.write('\n');
            const confirmed = await confirm();
            if (!confirmed) {
              process.stdout.write('Aborted.\n');
              process.exit(0);
            }
          }

          const result = svc.cleanupOlderThan(days);
          process.stdout.write('\nCleanup complete.\n');
          process.stdout.write(`  Task logs deleted : ${result.taskLogsDeleted.toLocaleString()}\n`);
          process.stdout.write(`  Tasks deleted     : ${result.tasksDeleted.toLocaleString()}\n`);
          process.stdout.write(`  Stories deleted   : ${result.storiesDeleted.toLocaleString()}\n`);
          process.exit(0);
        } else if (options.keepLast !== undefined) {
          const n = parseInt(options.keepLast, 10);
          if (isNaN(n) || n < 0) {
            process.stderr.write(
              'Invalid value for --keep-last. Must be a non-negative integer.\n',
            );
            process.exit(1);
          }

          const preview = svc.previewKeepLast(n);
          process.stdout.write(
            `\nCleanup preview (--keep-last ${n}, total completed: ${preview.totalCompleted}):\n`,
          );
          process.stdout.write(`  Stories to delete   : ${preview.storiesToDelete.toLocaleString()}\n`);
          process.stdout.write(`  Tasks to delete     : ${preview.tasksToDelete.toLocaleString()}\n`);
          process.stdout.write(`  Task logs to delete : ${preview.taskLogsToDelete.toLocaleString()}\n`);

          if (preview.storiesToDelete === 0) {
            process.stdout.write('\nNothing to delete.\n');
            process.exit(0);
          }

          if (options.dryRun === true) {
            process.stdout.write('\n[dry-run] No changes made.\n');
            process.exit(0);
          }

          if (options.force !== true) {
            process.stdout.write('\n');
            const confirmed = await confirm();
            if (!confirmed) {
              process.stdout.write('Aborted.\n');
              process.exit(0);
            }
          }

          const result = svc.cleanupKeepLast(n);
          process.stdout.write('\nCleanup complete.\n');
          process.stdout.write(`  Task logs deleted : ${result.taskLogsDeleted.toLocaleString()}\n`);
          process.stdout.write(`  Tasks deleted     : ${result.tasksDeleted.toLocaleString()}\n`);
          process.stdout.write(`  Stories deleted   : ${result.storiesDeleted.toLocaleString()}\n`);
          process.exit(0);
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
