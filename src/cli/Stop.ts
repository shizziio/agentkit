import { join } from 'node:path';

import type { Command } from 'commander';
import { eq, sql } from 'drizzle-orm';

import { tasks } from '@core/db/schema.js';
import { openDatabase } from '@core/db/Connection.js';
import { AgentKitError } from '@core/Errors.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import { requireInitialized } from './RequireInitialized.js';

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop running pipeline workers')
    .action(() => {
      requireInitialized();
      try {
        const db = openDatabase(join(process.cwd(), AGENTKIT_DIR, DB_FILENAME));
        const result = db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(tasks)
          .where(eq(tasks.status, 'running'))
          .get();
        const count = result?.count ?? 0;
        if (count === 0) {
          process.stdout.write('Khong co workers nao dang chay.\n');
        } else {
          process.stdout.write('Co workers dang chay. Su dung dashboard (phim R) de dung.\n');
        }
        process.exit(0);
      } catch (err: unknown) {
        if (err instanceof AgentKitError) {
          process.stderr.write(`Error: ${err.message}\n`);
          process.exit(1);
        }
        // DB might not exist yet — treat as no workers running
        process.stdout.write('Khong co workers nao dang chay.\n');
        process.exit(0);
      }
    });
}
