import { existsSync, readdirSync, readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

import { Logger } from '@core/Logger.js';
import { getGlobalTeamsDir } from '@shared/GlobalPath.js';
import { AGENTKIT_DIR } from '@config/defaults.js';
import type { DrizzleDB } from '@core/db/Connection.js';
import type { MigrationResult } from '@core/db/RunMigrations.js';
import { sql } from 'drizzle-orm';

const logger = Logger.getOrNoop('UpdateService');

export interface ResourceSyncResult {
  file: string;
  action: 'added' | 'updated' | 'unchanged' | 'skipped_customized';
}

export interface UpdateResult {
  migration: MigrationResult;
  resources: ResourceSyncResult[];
  previousVersion: string | null;
  currentVersion: string;
}

function hashFileContent(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}

function getMetaValue(db: DrizzleDB, key: string): string | null {
  try {
    const row = db.get<{ value: string }>(
      sql`SELECT value FROM _agentkit_meta WHERE key = ${key}`
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function upsertMeta(db: DrizzleDB, key: string, value: string): void {
  db.run(sql`INSERT INTO _agentkit_meta (key, value, updated_at)
    VALUES (${key}, ${value}, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(key) DO UPDATE SET value = ${value}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`);
}

function walkFiles(dir: string, base?: string): { relative: string; absolute: string }[] {
  const results: { relative: string; absolute: string }[] = [];
  if (!existsSync(dir)) return results;
  const baseDir = base ?? dir;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, baseDir));
    } else {
      results.push({ relative: relative(baseDir, fullPath), absolute: fullPath });
    }
  }
  return results;
}

export class UpdateService {
  constructor(
    private db: DrizzleDB,
    private projectRoot: string,
  ) {}

  syncBundledResources(teams: string[]): ResourceSyncResult[] {
    const results: ResourceSyncResult[] = [];
    const localTeamsDir = join(this.projectRoot, AGENTKIT_DIR, 'teams');

    for (const team of teams) {
      const bundledDir = join(getGlobalTeamsDir(), team);
      if (!existsSync(bundledDir)) {
        logger.warn(`Bundled team not found: ${team}`);
        continue;
      }

      const localDir = join(localTeamsDir, team);
      const bundledFiles = walkFiles(bundledDir);

      for (const file of bundledFiles) {
        const localPath = join(localDir, file.relative);
        const metaKey = `bundled_hash:${team}/${file.relative}`;

        if (!existsSync(localPath)) {
          // New file — copy it
          mkdirSync(join(localDir, join(file.relative, '..')), { recursive: true });
          copyFileSync(file.absolute, localPath);
          upsertMeta(this.db, metaKey, hashFileContent(file.absolute));
          results.push({ file: `${team}/${file.relative}`, action: 'added' });
          continue;
        }

        const bundledHash = hashFileContent(file.absolute);
        const localHash = hashFileContent(localPath);

        if (bundledHash === localHash) {
          results.push({ file: `${team}/${file.relative}`, action: 'unchanged' });
          continue;
        }

        // Content differs — check if user customized
        const storedBundledHash = getMetaValue(this.db, metaKey);

        if (storedBundledHash === null || localHash === storedBundledHash) {
          // User hasn't customized (local matches last known bundled) → safe to update
          copyFileSync(file.absolute, localPath);
          upsertMeta(this.db, metaKey, bundledHash);
          results.push({ file: `${team}/${file.relative}`, action: 'updated' });
        } else {
          // User has customized → skip
          results.push({ file: `${team}/${file.relative}`, action: 'skipped_customized' });
        }
      }
    }

    return results;
  }

  getPreviousVersion(): string | null {
    return getMetaValue(this.db, 'agentkit_version');
  }

  /**
   * Discover installed teams from project config.
   */
  getInstalledTeams(): string[] {
    const teamsDir = join(this.projectRoot, AGENTKIT_DIR, 'teams');
    if (!existsSync(teamsDir)) return [];

    return readdirSync(teamsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  /**
   * List available bundled teams.
   */
  getAvailableTeams(): string[] {
    const teamsDir = getGlobalTeamsDir();
    if (!existsSync(teamsDir)) return [];

    return readdirSync(teamsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }
}
