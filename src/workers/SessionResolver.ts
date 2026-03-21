import { readdirSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { sql } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import type { SessionIdResolver } from '@providers/interfaces/BaseProvider.js'
import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('ClaudeSessionResolver')

/** Max age of .jsonl files to scan (3 hours in ms) */
const MAX_FILE_AGE_MS = 3 * 60 * 60 * 1000

/** Meta key prefix for tracking scanned files */
const SCANNED_PREFIX = 'claude_session_scanned:'
/** Meta key prefix for sessionName → sessionId mapping */
const SESSION_ID_PREFIX = 'claude_session_id:'

interface CustomTitleEntry {
  type: 'custom-title'
  customTitle: string
  sessionId: string
}

/**
 * Claude CLI implementation of SessionIdResolver.
 *
 * Claude CLI stores sessions as {UUID}.jsonl files under ~/.claude/projects/-{path}/.
 * When spawned with `-n NAME`, the first line contains a custom-title entry mapping
 * the human-readable name to the UUID. This resolver scans those files and builds
 * a lookup table so `--resume UUID` can be used instead of the unsupported `--resume NAME`.
 */
export class ClaudeSessionResolver implements SessionIdResolver {
  private readonly db: DrizzleDB
  private readonly sessionsDir: string

  constructor(db: DrizzleDB, projectPath: string) {
    this.db = db
    this.sessionsDir = ClaudeSessionResolver.computeSessionsDir(projectPath)
  }

  /**
   * Compute Claude's session storage directory for a given project path.
   * Claude uses: ~/.claude/projects/-{path with / replaced by -}/
   */
  static computeSessionsDir(projectPath: string): string {
    const normalized = '-' + projectPath.replace(/^\//, '').replace(/\//g, '-')
    return join(homedir(), '.claude', 'projects', normalized)
  }

  scanNewSessions(): number {
    let files: string[]
    try {
      files = readdirSync(this.sessionsDir).filter(f => f.endsWith('.jsonl'))
    } catch (err) {
      logger.debug(`Sessions dir not accessible: ${this.sessionsDir}`, {
        error: err instanceof Error ? err.message : String(err),
      })
      return 0
    }

    const cutoff = Date.now() - MAX_FILE_AGE_MS
    let resolved = 0

    for (const file of files) {
      const filePath = join(this.sessionsDir, file)

      // Optimization: skip files older than 3 hours
      try {
        const stat = statSync(filePath)
        if (stat.mtimeMs < cutoff) continue
      } catch {
        continue
      }

      // Skip already-scanned files
      const fileKey = SCANNED_PREFIX + file
      const existing = this.db.get<{ value: string }>(
        sql`SELECT value FROM _agentkit_meta WHERE key = ${fileKey}`
      )
      if (existing) continue

      // Read first line and parse
      const entry = this.readFirstLine(filePath)
      if (entry) {
        this.storeMapping(entry.customTitle, entry.sessionId)
        resolved++
        logger.info(
          `Resolved session: "${entry.customTitle}" → ${entry.sessionId}`
        )
      }

      // Mark file as scanned regardless of whether it had a custom-title
      this.markScanned(fileKey)
    }

    if (resolved > 0) {
      logger.info(`Scan complete: ${resolved} new session(s) resolved from ${files.length} files`)
    } else {
      logger.debug(`Scan complete: 0 new sessions (checked ${files.length} recent files)`)
    }

    return resolved
  }

  resolve(sessionName: string): string | null {
    // Try direct lookup first (fast path)
    const cached = this.lookup(sessionName)
    if (cached) return cached

    // Scan for new sessions and try again
    this.scanNewSessions()
    return this.lookup(sessionName)
  }

  private lookup(sessionName: string): string | null {
    const key = SESSION_ID_PREFIX + sessionName
    const row = this.db.get<{ value: string }>(
      sql`SELECT value FROM _agentkit_meta WHERE key = ${key}`
    )
    return row?.value ?? null
  }

  /**
   * Read only the first line of a .jsonl file (max 4KB) and parse as custom-title entry.
   * Uses low-level read to avoid loading multi-MB session files into memory.
   */
  private readFirstLine(filePath: string): CustomTitleEntry | null {
    let fd: number | undefined
    try {
      fd = openSync(filePath, 'r')
      const buf = Buffer.alloc(4096)
      const bytesRead = readSync(fd, buf, 0, 4096, 0)
      const chunk = buf.toString('utf-8', 0, bytesRead)
      const newlineIdx = chunk.indexOf('\n')
      const firstLine = newlineIdx === -1 ? chunk : chunk.substring(0, newlineIdx)
      if (!firstLine.trim()) return null

      const parsed = JSON.parse(firstLine) as Record<string, unknown>
      if (
        parsed.type === 'custom-title' &&
        typeof parsed.customTitle === 'string' &&
        typeof parsed.sessionId === 'string'
      ) {
        return parsed as unknown as CustomTitleEntry
      }
    } catch (err) {
      logger.debug(`Failed to parse first line: ${filePath}`, {
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
    return null
  }

  private storeMapping(sessionName: string, sessionId: string): void {
    const key = SESSION_ID_PREFIX + sessionName
    this.db.run(
      sql`INSERT INTO _agentkit_meta (key, value, updated_at)
          VALUES (${key}, ${sessionId}, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
          ON CONFLICT(key) DO UPDATE SET value = ${sessionId}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    )
  }

  private markScanned(fileKey: string): void {
    this.db.run(
      sql`INSERT INTO _agentkit_meta (key, value, updated_at)
          VALUES (${fileKey}, '1', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
          ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    )
  }
}
