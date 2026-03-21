import { eq, and } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import { epics, stories } from '@core/db/schema.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('DependencyDisplay');

export interface DepStatus {
  key: string;
  status: string;
}

/**
 * Parses a depends_on JSON array and resolves each dep key to its current story status.
 * Resolves one level deep only — does not recurse into dep's deps.
 * @param db - Drizzle DB connection
 * @param dependsOnJson - JSON string (e.g. '["21.1","21.2"]') or null
 * @param projectId - scoped to this project only
 */
export function resolveDepStatuses(
  db: DrizzleDB,
  dependsOnJson: string | null,
  projectId: number,
): DepStatus[] {
  if (!dependsOnJson) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(dependsOnJson);
  } catch {
    logger.warn('Failed to parse depends_on JSON', { dependsOnJson });
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const keys = parsed.filter((item): item is string => typeof item === 'string');
  if (keys.length === 0) return [];

  return keys.map((key) => {
    const dotIndex = key.indexOf('.');
    if (dotIndex === -1) {
      return { key, status: 'unknown' };
    }
    const epicKey = key.slice(0, dotIndex);
    const storyKey = key.slice(dotIndex + 1);

    try {
      const row = db
        .select({ status: stories.status })
        .from(stories)
        .innerJoin(epics, eq(stories.epicId, epics.id))
        .where(
          and(
            eq(epics.projectId, projectId),
            eq(epics.epicKey, epicKey),
            eq(stories.storyKey, storyKey),
          ),
        )
        .get();

      return { key, status: row?.status ?? 'unknown' };
    } catch {
      return { key, status: 'unknown' };
    }
  });
}

/**
 * Formats an array of dep statuses into a human-readable string.
 * done → ✓ (green), everything else → ⏳
 */
export function formatDepList(deps: DepStatus[]): string {
  if (deps.length === 0) return '';
  return deps
    .map((dep) => `${dep.key} ${dep.status === 'done' ? '✓' : '⏳'}`)
    .join(', ');
}
