import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';
import { sql } from 'drizzle-orm';

import { requireInitialized } from './RequireInitialized.js';
import { openDatabase } from '@core/db/Connection.js';
import { UpdateService } from '@core/UpdateService.js';
import { AGENTKIT_DIR, DB_FILENAME } from '@config/defaults.js';
import { Logger } from '@core/Logger.js';

const ACTION_ICONS: Record<string, string> = {
  added: '✓',
  updated: '✓',
  unchanged: '○',
  skipped_customized: '⚠',
};

const ACTION_LABELS: Record<string, string> = {
  added: 'added',
  updated: 'updated',
  unchanged: 'unchanged',
  skipped_customized: 'skipped (user customized)',
};

export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Sync database schema and bundled resources after upgrading agentkit')
    .action(async () => {
      try {
        const logger = Logger.getOrNoop('CLI:Update');
        logger.info('update: invoked');
        requireInitialized();

        const projectRoot = process.cwd();
        const dbPath = join(projectRoot, AGENTKIT_DIR, DB_FILENAME);
        const db = openDatabase(dbPath);
        const svc = new UpdateService(db, projectRoot);

        // Version info
        const previousVersion = svc.getPreviousVersion();
        const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
        let currentVersion = '0.0.0';
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
          currentVersion = pkg.version;
        } catch { /* fallback */ }

        // Schema version (migrations already applied by openDatabase)
        let schemaVersion = '0';
        try {
          const row = db.get<{ value: string }>(sql`SELECT value FROM _agentkit_meta WHERE key = 'schema_version'`);
          schemaVersion = row?.value ?? '0';
        } catch { /* meta table may not exist */ }

        // Sync bundled resources
        const teams = svc.getInstalledTeams();
        const resources = svc.syncBundledResources(teams);

        // Output
        process.stdout.write('\nAgentKit Update\n');
        process.stdout.write('──────────────────────────────────\n');

        if (previousVersion && previousVersion !== currentVersion) {
          process.stdout.write(`Version: ${previousVersion} → ${currentVersion}\n`);
        } else {
          process.stdout.write(`Version: ${currentVersion} (up to date)\n`);
        }

        process.stdout.write(`\nDatabase:\n`);
        process.stdout.write(`  ✓ Schema version: ${schemaVersion}\n`);

        if (resources.length > 0) {
          process.stdout.write(`\nBundled Resources:\n`);
          for (const r of resources) {
            const icon = ACTION_ICONS[r.action] ?? '?';
            const label = ACTION_LABELS[r.action] ?? r.action;
            process.stdout.write(`  ${icon} ${r.file} — ${label}\n`);
          }
        } else {
          process.stdout.write(`\nBundled Resources: (no teams installed)\n`);
        }

        process.stdout.write('\nDone!\n');
        process.exit(0);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${msg}\n`);
        process.exit(1);
      }
    });
}
