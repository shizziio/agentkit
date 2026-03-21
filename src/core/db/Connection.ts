import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { BUSY_TIMEOUT } from '@config/defaults.js';
import { Logger } from '@core/Logger.js';

import * as schema from './schema.js';
import { runMigrations } from './RunMigrations.js';

const logger = Logger.getOrNoop('DB');

export function createConnection(dbPath: string) {
  try {
    const sqlite = new Database(dbPath);

    sqlite.pragma(`journal_mode = WAL`);
    logger.debug('db: WAL mode enabled');
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT}`);
    sqlite.pragma(`foreign_keys = ON`);

    const db = drizzle(sqlite, { schema });
    logger.info('db: connection opened', { path: dbPath });
    return db;
  } catch (err: unknown) {
    logger.error('db: connection failed', { path: dbPath, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Open database connection and auto-apply pending Drizzle migrations.
 * Use this in CLI commands. Use createConnection() directly in tests
 * or InitService where migrations are handled separately.
 */
export function openDatabase(dbPath: string): DrizzleDB {
  const db = createConnection(dbPath);
  runMigrations(db);
  return db;
}

export type DrizzleDB = ReturnType<typeof createConnection>;
