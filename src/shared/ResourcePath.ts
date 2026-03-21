import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigError } from '@core/Errors.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

function assertSafeName(name: string, label: string): void {
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new ConfigError(`Invalid ${label}: ${name}`);
  }
}

export function getBundledTeamsDir(): string {
  return join(moduleDir, '..', 'resources', 'teams');
}

export function getBundledTeamDir(teamName: string): string {
  assertSafeName(teamName, 'team name');
  return join(moduleDir, '..', 'resources', 'teams', teamName);
}

export function getBundledProjectResourcesDir(): string {
  return join(moduleDir, '..', 'resources', 'project-resources');
}

