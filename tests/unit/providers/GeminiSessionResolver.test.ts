import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any import that depends on them
// ---------------------------------------------------------------------------

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('node:child_process', () => ({ execSync: vi.fn() }))

vi.mock('@core/Logger.js', () => ({
  Logger: { getOrNoop: vi.fn(() => mockLogger) },
}))

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { GeminiSessionResolver } from '../../../src/providers/session/GeminiSessionResolver.js'

// ---------------------------------------------------------------------------
// Constants & fixtures
// ---------------------------------------------------------------------------

const UUID_1 = 'c05c6ee4-a334-4eb1-845f-8fc4ed410f1e'
const UUID_2 = '0f4196c8-6b93-4c3d-9cfd-870f985225d8'
const UUID_3 = 'aaaabbbb-cccc-dddd-eeee-000011112222'

const SESSION_NAME_1 = 'AGENTKIT-21.1-DEV-abc1'
const SESSION_NAME_2 = 'AGENTKIT-21.2-DEV-def2'
const SESSION_NAME_3 = 'AGENTKIT-22.1-DEV-xyz9'

/** Single line with TaskName marker — used in many tests */
const SINGLE_TASKNAME_LINE =
  `  102. TaskName: ${SESSION_NAME_1} some desc (3 days ago) [${UUID_1}]`

/** Three lines each with a distinct TaskName marker */
const MULTI_TASKNAME_OUTPUT = [
  `  102. TaskName: ${SESSION_NAME_1} (3 days ago) [${UUID_1}]`,
  `  103. TaskName: ${SESSION_NAME_2} (2 days ago) [${UUID_2}]`,
  `  104. TaskName: ${SESSION_NAME_3} (1 day ago) [${UUID_3}]`,
].join('\n')

/** Lines without TaskName marker (non-agentkit sessions) */
const NON_AGENTKIT_OUTPUT = [
  `  105. relay (39 minutes ago) [${UUID_2}]`,
  `  106. # Developer Prompt ## Role You are... (1 hour ago) [${UUID_3}]`,
].join('\n')

// ---------------------------------------------------------------------------
// DB stub factory
// ---------------------------------------------------------------------------

function makeDb() {
  return {
    get: vi.fn<() => { value: string } | undefined>(),
    run: vi.fn<() => void>(),
  }
}

type MockDb = ReturnType<typeof makeDb>

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GeminiSessionResolver', () => {
  let db: MockDb
  let resolver: GeminiSessionResolver

  beforeEach(() => {
    vi.clearAllMocks()
    db = makeDb()
    resolver = new GeminiSessionResolver(db as any, '/path/to/project')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // scanNewSessions()
  // ─────────────────────────────────────────────────────────────────────────

  describe('scanNewSessions()', () => {

    // ── AC1: Parse list-sessions output and store mapping ─────────────────

    describe('AC1 — parse list-sessions and store name→UUID mapping', () => {
      it('should call execSync("gemini --list-sessions") to fetch session list', () => {
        db.get.mockReturnValue(undefined) // isThrottled: no last-scan row
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        resolver.scanNewSessions()

        expect(execSync).toHaveBeenCalledWith(
          'gemini --list-sessions',
          expect.any(Object),
        )
      })

      it('should call execSync with timeout: 10_000 to prevent hangs', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue('')

        resolver.scanNewSessions()

        expect(execSync).toHaveBeenCalledWith(
          'gemini --list-sessions',
          expect.objectContaining({ timeout: 10_000 }),
        )
      })

      it('should call execSync with encoding: "utf8"', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue('')

        resolver.scanNewSessions()

        expect(execSync).toHaveBeenCalledWith(
          'gemini --list-sessions',
          expect.objectContaining({ encoding: 'utf8' }),
        )
      })

      it('should return 1 when exactly one TaskName line is found', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        const count = resolver.scanNewSessions()

        expect(count).toBe(1)
      })

      it('should call db.run to store the mapping (storeMapping call)', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        resolver.scanNewSessions()

        // At minimum: 1× storeMapping + 1× updateLastScan
        expect(db.run).toHaveBeenCalledTimes(2)
      })

      it('should call db.run to update gemini_last_scan after scanning', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue('')

        resolver.scanNewSessions()

        // Even with 0 matches, updateLastScan must be called after a successful scan
        expect(db.run).toHaveBeenCalledTimes(1)
      })
    })

    // ── AC5: Scan throttle (30 s) ─────────────────────────────────────────

    describe('AC5 — 30-second scan throttle', () => {
      it('should return 0 without calling execSync when last scan was < 30s ago', () => {
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString()
        db.get.mockReturnValue({ value: tenSecondsAgo }) // throttled

        const count = resolver.scanNewSessions()

        expect(count).toBe(0)
        expect(execSync).not.toHaveBeenCalled()
      })

      it('should not call db.run when throttled (no store, no updateLastScan)', () => {
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString()
        db.get.mockReturnValue({ value: tenSecondsAgo })

        resolver.scanNewSessions()

        expect(db.run).not.toHaveBeenCalled()
      })

      it('should proceed with scan when last scan was exactly 30s + 1ms ago', () => {
        const justExpired = new Date(Date.now() - 30_001).toISOString()
        db.get.mockReturnValue({ value: justExpired }) // not throttled
        vi.mocked(execSync).mockReturnValue('')

        resolver.scanNewSessions()

        expect(execSync).toHaveBeenCalled()
      })

      it('should proceed with scan when gemini_last_scan row is absent (first scan)', () => {
        db.get.mockReturnValue(undefined) // no row at all

        vi.mocked(execSync).mockReturnValue('')

        resolver.scanNewSessions()

        expect(execSync).toHaveBeenCalled()
      })

      it('should proceed (fail-open) when gemini_last_scan value is an invalid date string', () => {
        db.get.mockReturnValue({ value: 'not-a-valid-date' }) // NaN from Date.parse
        vi.mocked(execSync).mockReturnValue('')

        resolver.scanNewSessions()

        // NaN < SCAN_THROTTLE_MS is false, so scan should run
        expect(execSync).toHaveBeenCalled()
      })
    })

    // ── AC6: Multiple TaskNames parsed ───────────────────────────────────

    describe('AC6 — multiple TaskName lines all parsed', () => {
      it('should return count equal to number of TaskName lines', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(MULTI_TASKNAME_OUTPUT)

        const count = resolver.scanNewSessions()

        expect(count).toBe(3)
      })

      it('should call db.run once per mapping plus once for updateLastScan (3+1=4)', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(MULTI_TASKNAME_OUTPUT)

        resolver.scanNewSessions()

        expect(db.run).toHaveBeenCalledTimes(4) // 3 storeMapping + 1 updateLastScan
      })
    })

    // ── AC7: Non-agentkit sessions ignored ───────────────────────────────

    describe('AC7 — sessions without TaskName marker are ignored', () => {
      it('should return 0 when no TaskName marker is present in output', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(NON_AGENTKIT_OUTPUT)

        const count = resolver.scanNewSessions()

        expect(count).toBe(0)
      })

      it('should call db.run only for updateLastScan (no storeMapping) when output has no TaskName', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(NON_AGENTKIT_OUTPUT)

        resolver.scanNewSessions()

        expect(db.run).toHaveBeenCalledTimes(1) // only updateLastScan
      })

      it('should only count lines that match the TaskName pattern when output is mixed', () => {
        const mixed = [
          `  102. TaskName: ${SESSION_NAME_1} (3 days ago) [${UUID_1}]`,
          `  105. relay (39 minutes ago) [${UUID_2}]`,
          `  106. # developer prompt (1 hour ago) [${UUID_3}]`,
        ].join('\n')
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(mixed)

        const count = resolver.scanNewSessions()

        expect(count).toBe(1)
      })

      it('should return 0 when list-sessions output is an empty string', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue('')

        const count = resolver.scanNewSessions()

        expect(count).toBe(0)
      })
    })

    // ── AC8: Logging ─────────────────────────────────────────────────────

    describe('AC8 — logging', () => {
      it('should log info containing session name for each resolved mapping', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        resolver.scanNewSessions()

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining(SESSION_NAME_1),
        )
      })

      it('should log info containing UUID for each resolved mapping', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        resolver.scanNewSessions()

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining(UUID_1),
        )
      })

      it('should log info "Scan complete: 1 new session(s)" when count is 1', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        resolver.scanNewSessions()

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringMatching(/Scan complete: 1 new session/),
        )
      })

      it('should log info "Scan complete: 3 new session(s)" when count is 3', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(MULTI_TASKNAME_OUTPUT)

        resolver.scanNewSessions()

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringMatching(/Scan complete: 3 new session/),
        )
      })

      it('should NOT log info "Scan complete" when count is 0 (use debug instead)', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue('')

        resolver.scanNewSessions()

        const scanCompleteInfoCalls = mockLogger.info.mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('Scan complete'),
        )
        expect(scanCompleteInfoCalls).toHaveLength(0)
      })

      it('should log warn when execSync throws (not throw to caller)', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockImplementation(() => {
          throw new Error('ENOENT: gemini not found')
        })

        expect(() => resolver.scanNewSessions()).not.toThrow()
        expect(mockLogger.warn).toHaveBeenCalled()
      })
    })

    // ── execSync error handling ───────────────────────────────────────────

    describe('execSync error handling', () => {
      it('should return 0 when execSync throws ENOENT (gemini not installed)', () => {
        db.get.mockReturnValue(undefined)
        const err = Object.assign(new Error('spawnSync gemini ENOENT'), { code: 'ENOENT' })
        vi.mocked(execSync).mockImplementation(() => { throw err })

        const count = resolver.scanNewSessions()

        expect(count).toBe(0)
      })

      it('should return 0 when execSync throws a non-zero exit error', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockImplementation(() => {
          throw new Error('Command failed: gemini --list-sessions\nexit code 1')
        })

        const count = resolver.scanNewSessions()

        expect(count).toBe(0)
      })

      it('should not call db.run when execSync throws (no updateLastScan on failure)', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockImplementation(() => { throw new Error('fail') })

        resolver.scanNewSessions()

        expect(db.run).not.toHaveBeenCalled()
      })
    })

    // ── Regex edge cases ─────────────────────────────────────────────────

    describe('regex — session names with dots and hyphens', () => {
      it('should capture session name "AGENTKIT-21.1-DEV-abc1" (dots and hyphens)', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(
          `  102. TaskName: AGENTKIT-21.1-DEV-abc1 (now) [${UUID_1}]`,
        )

        const count = resolver.scanNewSessions()

        expect(count).toBe(1)
      })

      it('should handle two entries with the same TaskName (last write wins via UPSERT)', () => {
        const duplicateOutput = [
          `  102. TaskName: ${SESSION_NAME_1} (3 days ago) [${UUID_1}]`,
          `  108. TaskName: ${SESSION_NAME_1} (1 hour ago) [${UUID_2}]`,
        ].join('\n')
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue(duplicateOutput)

        const count = resolver.scanNewSessions()

        // Both lines matched — count reflects lines parsed (UPSERT handles key collision)
        expect(count).toBe(2)
        // 2 storeMapping + 1 updateLastScan
        expect(db.run).toHaveBeenCalledTimes(3)
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // resolve()
  // ─────────────────────────────────────────────────────────────────────────

  describe('resolve()', () => {

    // ── AC2: Cache hit — no spawn ─────────────────────────────────────────

    describe('AC2 — cache hit returns UUID without spawning execSync', () => {
      it('should return cached UUID when mapping is already in _agentkit_meta', () => {
        // db.get #1: lookup() → cache hit
        db.get.mockReturnValue({ value: UUID_1 })

        const result = resolver.resolve(SESSION_NAME_1)

        expect(result).toBe(UUID_1)
      })

      it('should NOT call execSync on a cache hit', () => {
        db.get.mockReturnValue({ value: UUID_1 })

        resolver.resolve(SESSION_NAME_1)

        expect(execSync).not.toHaveBeenCalled()
      })

      it('should NOT call db.run on a cache hit (no scan, no updateLastScan)', () => {
        db.get.mockReturnValue({ value: UUID_1 })

        resolver.resolve(SESSION_NAME_1)

        expect(db.run).not.toHaveBeenCalled()
      })
    })

    // ── AC3: Cache miss → scan → hit ─────────────────────────────────────

    describe('AC3 — cache miss triggers scan and returns UUID when found', () => {
      it('should call execSync when initial lookup returns null', () => {
        // Call order: lookup (miss) → isThrottled (not throttled) → ... → lookup (hit)
        db.get
          .mockReturnValueOnce(undefined)          // lookup: miss
          .mockReturnValueOnce(undefined)          // isThrottled: no last-scan row
          .mockReturnValueOnce({ value: UUID_1 })  // lookup after scan: hit
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        resolver.resolve(SESSION_NAME_1)

        expect(execSync).toHaveBeenCalledWith('gemini --list-sessions', expect.any(Object))
      })

      it('should return the UUID discovered during the scan', () => {
        db.get
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce({ value: UUID_1 })
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        const result = resolver.resolve(SESSION_NAME_1)

        expect(result).toBe(UUID_1)
      })

      it('should call execSync exactly once during a single resolve() call', () => {
        db.get
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce({ value: UUID_1 })
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        resolver.resolve(SESSION_NAME_1)

        expect(execSync).toHaveBeenCalledTimes(1)
      })
    })

    // ── AC4: Cache miss → scan → still miss → null ────────────────────────

    describe('AC4 — cache miss and session absent from list-sessions returns null', () => {
      it('should return null when session name is not found after scan', () => {
        db.get
          .mockReturnValueOnce(undefined)   // lookup: miss
          .mockReturnValueOnce(undefined)   // isThrottled: no last-scan row
          .mockReturnValueOnce(undefined)   // lookup after scan: still miss
        vi.mocked(execSync).mockReturnValue(NON_AGENTKIT_OUTPUT)

        const result = resolver.resolve(SESSION_NAME_1)

        expect(result).toBeNull()
      })

      it('should return null when list-sessions output is empty', () => {
        db.get
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(undefined)
        vi.mocked(execSync).mockReturnValue('')

        const result = resolver.resolve('NONEXISTENT-SESSION')

        expect(result).toBeNull()
      })

      it('should return null when execSync throws (gemini not installed)', () => {
        db.get
          .mockReturnValueOnce(undefined)   // lookup: miss
          .mockReturnValueOnce(undefined)   // isThrottled: not throttled
          .mockReturnValueOnce(undefined)   // lookup after failed scan: miss
        vi.mocked(execSync).mockImplementation(() => { throw new Error('ENOENT') })

        const result = resolver.resolve(SESSION_NAME_1)

        expect(result).toBeNull()
      })
    })

    // ── AC5 via resolve(): throttle prevents re-scan ──────────────────────

    describe('AC5 — throttle in resolve() path (cache miss but scan throttled)', () => {
      it('should return null without calling execSync when throttled and cache is empty', () => {
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString()
        db.get
          .mockReturnValueOnce(undefined)                    // lookup: miss
          .mockReturnValueOnce({ value: tenSecondsAgo })    // isThrottled: throttled!
          .mockReturnValueOnce(undefined)                    // lookup after (skipped) scan: miss
        vi.mocked(execSync).mockReturnValue(SINGLE_TASKNAME_LINE)

        const result = resolver.resolve(SESSION_NAME_1)

        expect(execSync).not.toHaveBeenCalled()
        expect(result).toBeNull()
      })
    })

    // ── Synchronous interface contract ────────────────────────────────────

    describe('synchronous interface contract', () => {
      it('resolve() should return a string (not a Promise) on cache hit', () => {
        db.get.mockReturnValue({ value: UUID_1 })

        const result = resolver.resolve(SESSION_NAME_1)

        expect(result).not.toBeInstanceOf(Promise)
        expect(typeof result).toBe('string')
      })

      it('resolve() should return null (not a Promise) when session is not found', () => {
        db.get
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(undefined)
        vi.mocked(execSync).mockReturnValue('')

        const result = resolver.resolve('MISSING')

        expect(result).not.toBeInstanceOf(Promise)
        expect(result).toBeNull()
      })
    })

    // ── scanNewSessions() synchronous interface contract ──────────────────

    describe('scanNewSessions() synchronous interface contract', () => {
      it('should return a number (not a Promise)', () => {
        db.get.mockReturnValue(undefined)
        vi.mocked(execSync).mockReturnValue('')

        const result = resolver.scanNewSessions()

        expect(result).not.toBeInstanceOf(Promise)
        expect(typeof result).toBe('number')
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should accept db and projectPath without throwing', () => {
      expect(() => new GeminiSessionResolver(db as any, '/some/path')).not.toThrow()
    })

    it('should implement SessionIdResolver interface (resolve and scanNewSessions methods)', () => {
      const r = new GeminiSessionResolver(db as any, '/some/path')
      expect(typeof r.resolve).toBe('function')
      expect(typeof r.scanNewSessions).toBe('function')
    })
  })
})
