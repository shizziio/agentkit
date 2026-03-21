import { join } from 'node:path'
import { homedir } from 'node:os'

const GLOBAL_DIR_NAME = '.agentkit'

export function getGlobalDir(): string {
  return join(homedir(), GLOBAL_DIR_NAME)
}

export function getGlobalTeamsDir(): string {
  return join(getGlobalDir(), 'teams')
}

export function getGlobalResourcesDir(): string {
  return join(getGlobalDir(), 'resources')
}
