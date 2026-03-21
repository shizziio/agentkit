import { execSync } from 'node:child_process'
import { sql } from 'drizzle-orm'
import { Logger } from '@core/Logger.js'
import type { SessionIdResolver } from '../interfaces/BaseProvider.js'
import type { DrizzleDB } from '@core/db/Connection.js'

const SESSION_ID_PREFIX = 'gemini_session_id:'
const LAST_SCAN_KEY = 'gemini_last_scan'
const SCAN_THROTTLE_MS = 30_000

// Group 1: session name (e.g. AGENTKIT-21.1-DEV-abc1), Group 2: UUID
const SESSION_LINE_RE = /TaskName:\s*([\w.\-]+).*\[([a-f0-9-]+)\]/i

const logger = Logger.getOrNoop('GeminiSessionResolver')

export class GeminiSessionResolver implements SessionIdResolver {
  private readonly db: DrizzleDB

  constructor(db: DrizzleDB, _projectPath: string) {
    this.db = db
  }

  private lookup(sessionName: string): string | null {
    const key = SESSION_ID_PREFIX + sessionName
    const row = this.db.get<{ value: string }>(
      sql`SELECT value FROM _agentkit_meta WHERE key = ${key}`
    )
    return row?.value ?? null
  }

  private storeMapping(name: string, uuid: string): void {
    const key = SESSION_ID_PREFIX + name
    this.db.run(
      sql`INSERT INTO _agentkit_meta (key, value, updated_at)
          VALUES (${key}, ${uuid}, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
          ON CONFLICT(key) DO UPDATE SET value = ${uuid}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    )
  }

  private updateLastScan(): void {
    const now = new Date().toISOString()
    this.db.run(
      sql`INSERT INTO _agentkit_meta (key, value, updated_at)
          VALUES (${LAST_SCAN_KEY}, ${now}, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
          ON CONFLICT(key) DO UPDATE SET value = ${now}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
    )
  }

  private isThrottled(): boolean {
    const row = this.db.get<{ value: string }>(
      sql`SELECT value FROM _agentkit_meta WHERE key = ${LAST_SCAN_KEY}`
    )
    if (!row) return false
    const elapsed = Date.now() - Date.parse(row.value)
    return elapsed < SCAN_THROTTLE_MS
  }

  scanNewSessions(): number {
    if (this.isThrottled()) return 0

    let output: string
    try {
      output = execSync('gemini --list-sessions', { encoding: 'utf8', timeout: 10_000 })
    } catch (err) {
      logger.warn(
        `Failed to list Gemini sessions: ${err instanceof Error ? err.message : String(err)}`
      )
      return 0
    }

    let count = 0
    for (const line of output.split('\n')) {
      const match = SESSION_LINE_RE.exec(line)
      if (!match) continue
      const name = match[1]!
      const uuid = match[2]!.toLowerCase()
      this.storeMapping(name, uuid)
      logger.info(`Resolved session: "${name}" → ${uuid}`)
      count++
    }

    this.updateLastScan()

    if (count > 0) {
      logger.info(`Scan complete: ${count} new session(s)`)
    } else {
      logger.debug(`Scan complete: 0 new session(s)`)
    }

    return count
  }

  resolve(sessionName: string): string | null {
    const cached = this.lookup(sessionName)
    if (cached) return cached

    this.scanNewSessions()
    return this.lookup(sessionName)
  }
}
