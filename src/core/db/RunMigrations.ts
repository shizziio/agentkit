import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DrizzleDB } from './Connection.js';
import { Logger } from '@core/Logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, 'migrations');

const logger = Logger.getOrNoop('DB:Migration');

export interface MigrationResult {
  applied: number;
  schemaVersion: number;
  agentKitVersion: string;
}

function getPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

function ensureMetaTable(db: DrizzleDB): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS _agentkit_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  )`);
}

function countAppliedMigrations(db: DrizzleDB): number {
  try {
    const result = db.get<{ count: number }>(
      sql`SELECT COUNT(*) as count FROM __drizzle_migrations`
    );
    return result?.count ?? 0;
  } catch {
    // Table doesn't exist yet (first run)
    return 0;
  }
}

function upsertMeta(db: DrizzleDB, key: string, value: string): void {
  db.run(sql`INSERT INTO _agentkit_meta (key, value, updated_at)
    VALUES (${key}, ${value}, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(key) DO UPDATE SET value = ${value}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`);
}

export function runMigrations(db: DrizzleDB): MigrationResult {
  const pkgVersion = getPackageVersion();

  try {
    ensureMetaTable(db);
    const beforeCount = countAppliedMigrations(db);

    migrate(db, { migrationsFolder });

    const afterCount = countAppliedMigrations(db);
    const delta = afterCount - beforeCount;

    upsertMeta(db, 'schema_version', String(afterCount));
    upsertMeta(db, 'agentkit_version', pkgVersion);

    if (delta > 0) {
      upsertMeta(db, 'last_migrated_at', new Date().toISOString());
      logger.info(`Applied ${delta} pending migration(s). Schema version: ${afterCount}`);
    } else {
      logger.debug(`DB schema up to date (version ${afterCount})`);
    }

    return { applied: delta, schemaVersion: afterCount, agentKitVersion: pkgVersion };
  } catch (err: unknown) {
    logger.error('migration: failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
