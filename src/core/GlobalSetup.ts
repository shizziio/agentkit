import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { getGlobalDir, getGlobalTeamsDir, getGlobalResourcesDir } from '@shared/GlobalPath.js'
import { getBundledTeamsDir, getBundledProjectResourcesDir } from '@shared/ResourcePath.js'

function walkDir(dir: string, base?: string): { rel: string; abs: string }[] {
  const results: { rel: string; abs: string }[] = []
  if (!existsSync(dir)) return results
  const baseDir = base ?? dir
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, baseDir))
    } else {
      results.push({ rel: relative(baseDir, fullPath), abs: fullPath })
    }
  }
  return results
}

function syncDir(srcDir: string, destDir: string): void {
  if (!existsSync(srcDir)) return
  const files = walkDir(srcDir)
  for (const file of files) {
    const dest = join(destDir, file.rel)
    // Only copy if destination doesn't exist (preserve user customizations)
    if (!existsSync(dest)) {
      mkdirSync(join(dest, '..'), { recursive: true })
      copyFileSync(file.abs, dest)
    }
  }
}

/**
 * Ensure ~/.agentkit exists with bundled teams and docs.
 * Called once on every CLI invocation. Only copies missing files —
 * never overwrites user customizations.
 */
export function ensureGlobalDir(): void {
  const globalDir = getGlobalDir()

  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true })
  }

  // Sync bundled teams → ~/.agentkit/teams/
  syncDir(getBundledTeamsDir(), getGlobalTeamsDir())

  // Sync bundled project resources → ~/.agentkit/resources/
  syncDir(getBundledProjectResourcesDir(), getGlobalResourcesDir())
}
