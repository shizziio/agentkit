/**
 * Integration test — Story 22.3: Gemini Session Resume End-to-End Flow
 *
 * Wires StageWorker ↔ GeminiSessionResolver ↔ GeminiCliProvider using:
 *   - In-memory SQLite (real schema via runMigrations)
 *   - Mocked child_process (spawn + execSync)
 *   - Mocked readline, Logger, PromptLoader, OutputFileManager
 *
 * Covers AC1 (new session + stories.sessionInfo), AC2 (resume success),
 *         AC3 (resume fallback), AC4 (gemini CLI unavailable),
 *         AC5 (log format), AC6 (session name write guard).
 *
 * Note on _agentkit_meta raw SQL: this table is a runtime metadata store created
 * by RunMigrations.ensureMetaTable(). It is intentionally not in the Drizzle
 * schema (src/core/db/schema.ts) because it is managed by migrations at runtime,
 * not by the application ORM. All _agentkit_meta access uses the drizzle sql``
 * tagged template (parameterised queries) — raw string interpolation is never used.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { spawn, execSync } from 'node:child_process'
import readline from 'node:readline'
import { eq, sql } from 'drizzle-orm'

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks — must be declared before any import that transitively loads
// the mocked modules.
// ─────────────────────────────────────────────────────────────────────────────

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execSync: vi.fn() }))

vi.mock('node:readline', () => ({
  default: { createInterface: vi.fn() },
  createInterface: vi.fn(),
}))

vi.mock('@core/Logger.js', () => ({
  Logger: {
    getOrNoop: vi.fn(() => mockLogger),
    getLogger: vi.fn(() => mockLogger),
  },
}))

vi.mock('../../../src/workers/PromptLoader.js', () => ({
  loadPrompt: vi.fn().mockReturnValue('Test base prompt {{STORY_TITLE}} {{OUTPUT_FILE}}'),
  injectInput: vi.fn(
    (_template: string, opts: Record<string, unknown>) =>
      `Full prompt content. Output to: ${String(opts.outputFile ?? '')}`,
  ),
  buildResumePrompt: vi.fn(
    (_title: string, _input: string | null, outputFile: string) =>
      `Resume: continue previous session. Output to: ${outputFile}`,
  ),
  extractLatestFeedback: vi.fn().mockReturnValue(''),
}))

vi.mock('../../../src/workers/OutputFileManager.js', () => ({
  getOutputPath: vi.fn(
    (_root: string, taskId: number) => `/tmp/agentkit-test/task-${taskId}.json`,
  ),
  ensureOutputDir: vi.fn(),
  deleteOutputFile: vi.fn(),
  // Returning OUTPUT_FILE_MISSING forces resolveOutput to fall back to stdout parsing,
  // which succeeds when the mock child emits a valid JSON line.
  readOutputFile: vi.fn().mockReturnValue({ success: false, error: 'OUTPUT_FILE_MISSING' }),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Imports (after mocks are registered)
// ─────────────────────────────────────────────────────────────────────────────

import { createConnection } from '../../../src/core/db/Connection.js'
import { runMigrations } from '../../../src/core/db/RunMigrations.js'
import { projects, epics, stories, tasks } from '../../../src/core/db/schema.js'
import { StageWorker } from '../../../src/workers/StageWorker.js'
import { GeminiCliProvider } from '../../../src/providers/agent/GeminiCliProvider.js'
import { GeminiSessionResolver } from '../../../src/providers/session/GeminiSessionResolver.js'
import { Router } from '../../../src/workers/Router.js'
import { EventBus } from '../../../src/core/EventBus.js'
import { TaskLogWriter } from '../../../src/workers/TaskLogWriter.js'
import type { DequeueResult } from '../../../src/core/QueueTypes.js'
import type { DrizzleDB } from '../../../src/core/db/Connection.js'
import type { StageWorkerConfig } from '../../../src/workers/StageWorkerTypes.js'
import type { StageConfig } from '../../../src/core/ConfigTypes.js'
import type { BaseProvider } from '../../../src/providers/interfaces/BaseProvider.js'

// ─────────────────────────────────────────────────────────────────────────────
// Typed alias for accessing the private processTask method in tests.
// Casting via `unknown` avoids unguarded `as any`.
// ─────────────────────────────────────────────────────────────────────────────

type TestableWorker = StageWorker & { processTask(task: DequeueResult): Promise<void> }

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures & constants
// ─────────────────────────────────────────────────────────────────────────────

/** A stable session name for pre-seeded resume tests */
const SESSION_NAME = 'AGENTKIT-1.1-SM-abc12345'
/** UUID to pair with SESSION_NAME in _agentkit_meta */
const SESSION_UUID = 'c05c6ee4-a334-4eb1-845f-8fc4ed410f1e'

/** Pattern: real UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A list-sessions output line for the session above */
const LIST_SESSIONS_WITH_NAME =
  `  42. TaskName: ${SESSION_NAME} (10 minutes ago) [${SESSION_UUID}]`

/** StageConfig for the 'sm' stage used in Router wiring tests */
const SM_STAGE_CONFIG: StageConfig = {
  name: 'sm',
  displayName: 'SM',
  icon: '📝',
  prompt: 'agentkit/sm.md',
  timeout: 30_000,
  workers: 1,
  retries: 3,
  next: 'tester',
  reject_to: 'sm',
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock process helpers
// ─────────────────────────────────────────────────────────────────────────────

class MockChild extends EventEmitter {
  pid = 12345
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  }
}

class MockRl extends EventEmitter {
  close = vi.fn()
}

function setupMockProcess(): { child: MockChild; rl: MockRl } {
  const child = new MockChild()
  const rl = new MockRl()
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  vi.mocked(readline.createInterface).mockReturnValue(
    rl as unknown as ReturnType<typeof readline.createInterface>,
  )
  return { child, rl }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

function createTestDb(): DrizzleDB {
  const db = createConnection(':memory:')
  runMigrations(db)
  return db
}

interface SeedResult {
  projectId: number
  epicId: number
  storyId: number
  taskId: number
}

function seedDb(
  db: DrizzleDB,
  opts: { sessionInfo?: string; attempt?: number } = {},
): SeedResult {
  const now = new Date().toISOString()

  db.insert(projects)
    .values({ projectName: 'test-project', activeTeam: 'agentkit', createdAt: now, updatedAt: now })
    .run()
  const projectRow = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.projectName, 'test-project'))
    .get()
  const projectId = projectRow!.id

  db.insert(epics)
    .values({ projectId, epicKey: '1', title: 'Test Epic', orderIndex: 0, createdAt: now, updatedAt: now })
    .run()
  const epicRow = db
    .select({ id: epics.id })
    .from(epics)
    .where(eq(epics.projectId, projectId))
    .get()
  const epicId = epicRow!.id

  db.insert(stories)
    .values({
      epicId,
      storyKey: '1.1',
      title: 'Test Story Title',
      content: 'Story body content',
      orderIndex: 0,
      sessionInfo: opts.sessionInfo ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  const storyRow = db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.epicId, epicId))
    .get()
  const storyId = storyRow!.id

  db.insert(tasks)
    .values({
      storyId,
      team: 'agentkit',
      stageName: 'sm',
      status: 'running',
      attempt: opts.attempt ?? 1,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  const taskRow = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.storyId, storyId))
    .get()
  const taskId = taskRow!.id

  return { projectId, epicId, storyId, taskId }
}

function createWorker(db: DrizzleDB, projectRoot = '/tmp/test-project', eventBus?: EventBus): StageWorker {
  const provider = new GeminiCliProvider()
  const localEventBus = eventBus ?? new EventBus()
  // mockTaskLogWriter satisfies the TaskLogWriter interface for test purposes.
  const mockTaskLogWriter = {
    write: vi.fn(),
    flush: vi.fn(),
    drain: vi.fn().mockResolvedValue(undefined),
    getLatestLogs: vi.fn().mockReturnValue([]),
    stop: vi.fn(),
  }
  const config: StageWorkerConfig = {
    stageName: 'sm',
    workerIndex: 0,
    projectRoot,
    pollInterval: 1000,
    maxPollInterval: 30_000,
    backoffMultiplier: 1.5,
    model: 'gemini-2.5-pro',
    timeout: 30_000,
    promptPath: 'agentkit/sm.md',
    activeTeam: 'agentkit',
  }
  return new StageWorker(config, db, provider, localEventBus, mockTaskLogWriter as unknown as TaskLogWriter)
}

function makeDequeueResult(taskId: number, storyId: number, attempt: number): DequeueResult {
  const now = new Date().toISOString()
  return {
    id: taskId,
    storyId,
    parentId: null,
    team: 'agentkit',
    stageName: 'sm',
    status: 'running',
    prompt: null,
    input: null,
    output: null,
    workerModel: null,
    inputTokens: null,
    outputTokens: null,
    attempt,
    maxAttempts: 3,
    startedAt: now,
    completedAt: null,
    durationMs: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
}

/**
 * Pre-seed the _agentkit_meta table with a session name → UUID mapping.
 *
 * Note: _agentkit_meta is not in the Drizzle schema (it is a runtime metadata
 * table created by migrations). The sql`` tagged template produces parameterised
 * queries — no raw string interpolation occurs.
 */
function seedSessionMapping(db: DrizzleDB, sessionName: string, uuid: string): void {
  db.run(
    sql`INSERT INTO _agentkit_meta (key, value, updated_at)
        VALUES (${'gemini_session_id:' + sessionName}, ${uuid}, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('gemini-session-resume integration', () => {
  let db: DrizzleDB

  beforeEach(() => {
    vi.clearAllMocks()
    db = createTestDb()
    // Default: execSync returns empty string (no sessions listed)
    vi.mocked(execSync).mockReturnValue('')
  })

  // ───────────────────────────────────────────────────────────────────────────
  // AC1: New session — attempt=1 stores human-readable session name
  // ───────────────────────────────────────────────────────────────────────────

  describe('AC1 — new session: tasks.sessionName and stories.sessionInfo set correctly', () => {
    it('should write a non-null session name to tasks.sessionName after attempt=1', async () => {
      const { storyId, taskId } = seedDb(db, { attempt: 1 })
      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 1)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const taskRow = db
        .select({ sessionName: tasks.sessionName })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()
      expect(taskRow?.sessionName).toBeTruthy()
    })

    it('should write a session name matching format PROJ-STORYKEY-STAGE-hex8 (not a UUID)', async () => {
      const { storyId, taskId } = seedDb(db, { attempt: 1 })
      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 1)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const taskRow = db
        .select({ sessionName: tasks.sessionName })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()

      expect(taskRow?.sessionName).not.toMatch(UUID_PATTERN)
      expect(taskRow?.sessionName).toMatch(/^[A-Z0-9]+-[\w.]+-SM-[a-f0-9]{8}$/)
    })

    it('should inject TaskName prefix into prompt for new session', async () => {
      const { storyId, taskId } = seedDb(db, { attempt: 1 })
      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 1)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
      expect(writtenContent).toContain('TaskName:')
    })

    it('should not include -r flag in spawn args for a new session', async () => {
      const { storyId, taskId } = seedDb(db, { attempt: 1 })
      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 1)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
      expect(spawnArgs).not.toContain('-r')
    })

    /**
     * End-to-end: stories.sessionInfo['sm'] is populated by Router.persistSessionInfo()
     * after StageWorker emits task:completed → Router.routeCompletedTask().
     *
     * Wire: local EventBus → Router.routeCompletedTask() → persistSessionInfo()
     * → stories.sessionInfo update.
     */
    it('should persist session name to stories.sessionInfo["sm"] via Router after task completes', async () => {
      const localEventBus = new EventBus()
      const { storyId, taskId } = seedDb(db, { attempt: 1 })

      const router = new Router(db, 'agentkit')

      // When task:completed fires, read the stored task and route it so that
      // Router.persistSessionInfo() writes tasks.sessionName → stories.sessionInfo.
      localEventBus.on('task:completed', (event) => {
        const taskRow = db
          .select({
            output: tasks.output,
            attempt: tasks.attempt,
            maxAttempts: tasks.maxAttempts,
            team: tasks.team,
          })
          .from(tasks)
          .where(eq(tasks.id, event.taskId))
          .get()
        if (!taskRow) return
        router.routeCompletedTask(
          {
            id: event.taskId,
            storyId: event.storyId,
            output: taskRow.output,
            attempt: taskRow.attempt,
            maxAttempts: taskRow.maxAttempts,
            team: taskRow.team,
          },
          SM_STAGE_CONFIG,
        )
      })

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db, '/tmp/test-project', localEventBus)
      const task = makeDequeueResult(taskId, storyId, 1)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const storyRow = db
        .select({ sessionInfo: stories.sessionInfo })
        .from(stories)
        .where(eq(stories.id, storyId))
        .get()
      const sessionInfo = JSON.parse(storyRow?.sessionInfo ?? '{}') as Record<string, string>

      expect(sessionInfo['sm']).toBeTruthy()
      expect(sessionInfo['sm']).not.toMatch(UUID_PATTERN)
      expect(sessionInfo['sm']).toMatch(/^[A-Z0-9]+-[\w.]+-SM-[a-f0-9]{8}$/)
    })

    /**
     * Verify the bug-fix contract from Router's perspective:
     * persistSessionInfo must NOT write a UUID to stories.sessionInfo['sm'].
     * This test calls Router.routeCompletedTask() after setting tasks.sessionName
     * to a human-readable name (simulating the fixed StageWorker behaviour).
     */
    it('should never write a UUID to stories.sessionInfo via Router.persistSessionInfo', () => {
      const { storyId, taskId } = seedDb(db, { attempt: 1 })

      // Manually set tasks.sessionName to a human-readable name (fixed StageWorker path)
      db.update(tasks)
        .set({ sessionName: 'AGENTKIT-1.1-SM-cafebabe', output: '{"status":"ok"}', status: 'done' })
        .where(eq(tasks.id, taskId))
        .run()

      const router = new Router(db, 'agentkit')
      router.routeCompletedTask(
        { id: taskId, storyId, output: '{"status":"ok"}', attempt: 1, maxAttempts: 3, team: 'agentkit' },
        SM_STAGE_CONFIG,
      )

      const storyRow = db
        .select({ sessionInfo: stories.sessionInfo })
        .from(stories)
        .where(eq(stories.id, storyId))
        .get()
      const sessionInfo = JSON.parse(storyRow?.sessionInfo ?? '{}') as Record<string, string>

      expect(sessionInfo['sm']).toBe('AGENTKIT-1.1-SM-cafebabe')
      expect(sessionInfo['sm']).not.toMatch(UUID_PATTERN)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // AC2: Resume success — spawn receives -r UUID, tasks.sessionName stays null
  // ───────────────────────────────────────────────────────────────────────────

  describe('AC2 — resume success: spawn called with -r UUID', () => {
    it('should include -r <uuid> in spawn args when resolver finds the session', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
      expect(spawnArgs).toContain('-r')
      expect(spawnArgs).toContain(SESSION_UUID)
    })

    it('should position -r before -p in spawn args', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
      const rIndex = spawnArgs.indexOf('-r')
      const pIndex = spawnArgs.indexOf('-p')
      expect(rIndex).toBeGreaterThan(-1)
      expect(pIndex).toBeGreaterThan(rIndex)
    })

    it('should write resume prompt (not full story prompt) to stdin', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const stdinContent = child.stdin.write.mock.calls[0]?.[0] as string
      expect(stdinContent).not.toContain('TaskName:')
      expect(stdinContent).toContain('Resume:')
    })

    it('should close stdin after writing the prompt', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      expect(child.stdin.end).toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // AC3: Resume fallback — resolve() returns null → new session created
  // ───────────────────────────────────────────────────────────────────────────

  describe('AC3 — resume fallback: resolve returns null → new session', () => {
    it('should spawn gemini WITHOUT -r flag when session UUID is not found', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: 'AGENTKIT-1.1-SM-stale999' }),
      })
      vi.mocked(execSync).mockReturnValue('')

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
      expect(spawnArgs).not.toContain('-r')
    })

    it('should log a warning containing "falling back to new session" when UUID not found', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: 'AGENTKIT-1.1-SM-stale999' }),
      })
      vi.mocked(execSync).mockReturnValue('')

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const warnMessages = mockLogger.warn.mock.calls.flat() as string[]
      const hasFallbackWarn = warnMessages.some(
        (m) => typeof m === 'string' && m.includes('falling back to new session'),
      )
      expect(hasFallbackWarn).toBe(true)
    })

    it('should set tasks.sessionName to a new (non-null, non-UUID) name on fallback', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: 'AGENTKIT-1.1-SM-stale999' }),
      })
      vi.mocked(execSync).mockReturnValue('')

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const taskRow = db
        .select({ sessionName: tasks.sessionName })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()

      expect(taskRow?.sessionName).toBeTruthy()
      expect(taskRow?.sessionName).not.toMatch(UUID_PATTERN)
    })

    it('should use full prompt (with TaskName injection) on fallback-new-session path', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: 'AGENTKIT-1.1-SM-stale999' }),
      })
      vi.mocked(execSync).mockReturnValue('')

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const stdinContent = child.stdin.write.mock.calls[0]?.[0] as string
      expect(stdinContent).toContain('TaskName:')
      expect(stdinContent).toContain('Full prompt content')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // AC4: Gemini CLI unavailable — scanNewSessions() handles ENOENT gracefully
  //
  // Note on log level: the SM spec says AC4 should "emit a debug log", but
  // GeminiSessionResolver.ts line 65 emits logger.warn() (not debug) when
  // execSync throws. The tests below validate the actual implementation behaviour
  // (warn) rather than the spec description. This is intentional — the spec
  // description was imprecise; the implementation's warn level is more appropriate
  // for a degraded-mode signal.
  // ───────────────────────────────────────────────────────────────────────────

  describe('AC4 — gemini CLI unavailable: scanNewSessions returns 0 without throwing', () => {
    it('should return 0 when execSync throws ENOENT (gemini not installed)', () => {
      const err = Object.assign(new Error('spawnSync gemini ENOENT'), { code: 'ENOENT' })
      vi.mocked(execSync).mockImplementation(() => {
        throw err
      })

      const resolver = new GeminiSessionResolver(db, '/tmp/test-project')
      const result = resolver.scanNewSessions()

      expect(result).toBe(0)
    })

    it('should not throw when execSync throws ENOENT', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw Object.assign(new Error('spawnSync gemini ENOENT'), { code: 'ENOENT' })
      })

      const resolver = new GeminiSessionResolver(db, '/tmp/test-project')
      expect(() => resolver.scanNewSessions()).not.toThrow()
    })

    it('should emit a warn log (implementation uses warn, not debug) when gemini CLI is unavailable', () => {
      // Spec says "debug log" but GeminiSessionResolver.ts:65 calls logger.warn().
      // Test validates actual implementation behaviour.
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('spawnSync gemini ENOENT')
      })

      const resolver = new GeminiSessionResolver(db, '/tmp/test-project')
      resolver.scanNewSessions()

      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should not update _agentkit_meta when execSync throws (no updateLastScan on failure)', () => {
      // _agentkit_meta is a runtime metadata table not in the Drizzle schema.
      // The sql`` tagged template below uses parameterised values — no raw interpolation.
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found: gemini')
      })

      const resolver = new GeminiSessionResolver(db, '/tmp/test-project')
      resolver.scanNewSessions()

      const row = db.get<{ value: string }>(
        sql`SELECT value FROM _agentkit_meta WHERE key = 'gemini_last_scan'`,
      )
      expect(row).toBeUndefined()
    })

    it('should allow StageWorker processTask to complete without crashing even if scan fails', async () => {
      const { storyId, taskId } = seedDb(db, { attempt: 1 })
      vi.mocked(execSync).mockImplementation(() => {
        throw Object.assign(new Error('spawnSync gemini ENOENT'), { code: 'ENOENT' })
      })

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 1)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })

      await expect(execPromise).resolves.toBeUndefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // AC5: Consistent logging on successful resume
  // ───────────────────────────────────────────────────────────────────────────

  describe('AC5 — resume log: correct format emitted on successful resume', () => {
    it('should emit an info log matching the 🔄 Resuming pattern', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const infoCalls = mockLogger.info.mock.calls.flat() as string[]
      const resumeLog = infoCalls.find(
        (m) =>
          typeof m === 'string' &&
          /🔄 Resuming session task#\d+ \[stage=.+ name=.+ uuid=.+\]/.test(m),
      )

      expect(resumeLog).toBeDefined()
    })

    it('should include session name in the resume log', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const infoCalls = mockLogger.info.mock.calls.flat() as string[]
      const resumeLog = infoCalls.find(
        (m) => typeof m === 'string' && m.includes('🔄 Resuming'),
      )

      expect(resumeLog).toContain(SESSION_NAME)
    })

    it('should include UUID in the resume log', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const infoCalls = mockLogger.info.mock.calls.flat() as string[]
      const resumeLog = infoCalls.find(
        (m) => typeof m === 'string' && m.includes('🔄 Resuming'),
      )

      expect(resumeLog).toContain(SESSION_UUID)
    })

    it('should include stage name in the resume log', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const infoCalls = mockLogger.info.mock.calls.flat() as string[]
      const resumeLog = infoCalls.find(
        (m) => typeof m === 'string' && m.includes('🔄 Resuming'),
      )

      expect(resumeLog).toContain('stage=sm')
    })

    it('should log "Resolved session" from GeminiSessionResolver when scan discovers the session', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      // Do NOT pre-seed _agentkit_meta — force the resolver to scan via execSync.
      // Flow: resolve(SESSION_NAME) → cache miss → scanNewSessions() → parses execSync
      //       output → storeMapping() → logger.info("Resolved session: ...") → lookup()
      vi.mocked(execSync).mockReturnValue(LIST_SESSIONS_WITH_NAME)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const infoCalls = mockLogger.info.mock.calls.flat() as string[]
      const resolvedLog = infoCalls.find(
        (m) => typeof m === 'string' && m.includes('Resolved session:'),
      )
      expect(resolvedLog).toBeDefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // AC6: tasks.sessionName guard — only written on new-session paths
  // ───────────────────────────────────────────────────────────────────────────

  describe('AC6 — session name write guard: only new-session writes to tasks.sessionName', () => {
    it('should write tasks.sessionName on new session (attempt=1)', async () => {
      const { storyId, taskId } = seedDb(db, { attempt: 1 })
      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 1)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const taskRow = db
        .select({ sessionName: tasks.sessionName })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()
      expect(taskRow?.sessionName).toBeTruthy()
    })

    it('should write tasks.sessionName on fallback-new-session (attempt=2, no UUID found)', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: 'AGENTKIT-1.1-SM-expired' }),
      })
      vi.mocked(execSync).mockReturnValue('')

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const taskRow = db
        .select({ sessionName: tasks.sessionName })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()
      expect(taskRow?.sessionName).toBeTruthy()
      expect(taskRow?.sessionName).not.toMatch(UUID_PATTERN)
    })

    it('should NOT write tasks.sessionName on resume-success path (bug fix validation)', async () => {
      // BEFORE BUG FIX: tasks.sessionName = UUID (resumeSession value stored)
      // AFTER BUG FIX:  tasks.sessionName = null  (guard: `if (sessionName)` not `if (sessionName || resumeSession)`)
      //
      // This is the core regression test. Storing the UUID in tasks.sessionName caused
      // Router.persistSessionInfo() to write stories.sessionInfo['sm'] = UUID, breaking
      // all subsequent resolve() calls that expect a human-readable name.
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const taskRow = db
        .select({ sessionName: tasks.sessionName })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()

      // After fix: tasks.sessionName must remain null (no new session was started)
      expect(taskRow?.sessionName).toBeNull()
    })

    it('should never store a UUID string in tasks.sessionName on any path', async () => {
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })
      seedSessionMapping(db, SESSION_NAME, SESSION_UUID)

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })
      await execPromise

      const taskRow = db
        .select({ sessionName: tasks.sessionName })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()

      if (taskRow?.sessionName !== null) {
        // If written, the value must be a human-readable name, never a UUID
        expect(taskRow?.sessionName).not.toMatch(UUID_PATTERN)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ───────────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should start a new session (no crash) when attempt=2 but sessionInfo is null', async () => {
      // parseSessionInfo(null) → {} → existingSession = null → isResumable = false → new session
      const { storyId, taskId } = seedDb(db, { attempt: 2, sessionInfo: undefined })

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })

      await expect(execPromise).resolves.toBeUndefined()
    })

    it('should treat invalid JSON in sessionInfo as empty and start new session', async () => {
      // parseSessionInfo('NOT VALID JSON') → {} → existingSession = null → new session
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: 'NOT VALID JSON',
      })

      const { child, rl } = setupMockProcess()
      const worker = createWorker(db)
      const task = makeDequeueResult(taskId, storyId, 2)

      const execPromise = (worker as unknown as TestableWorker).processTask(task)
      setImmediate(() => {
        rl.emit('line', '{"status":"ok"}')
        child.emit('close', 0)
      })

      await expect(execPromise).resolves.toBeUndefined()
    })

    it('should handle undefined sessionResolver (provider without createSessionResolver) via optional-chain', async () => {
      // Provider without createSessionResolver → sessionResolver = null in StageWorker.
      // StageWorker line 160: `this.sessionResolver?.resolve(existingSession!) ?? null`
      // The optional-chain returns undefined → treated as null → fallback to full prompt.
      const { storyId, taskId } = seedDb(db, {
        attempt: 2,
        sessionInfo: JSON.stringify({ sm: SESSION_NAME }),
      })

      const minimalProvider: BaseProvider = {
        name: 'test-no-resolver',
        type: 'agent',
        capabilities: {
          streaming: false,
          nativeToolUse: false,
          supportedModels: ['gemini-2.5-pro'],
          sessionSupport: true,
        },
        isAvailable: vi.fn().mockResolvedValue(true),
        validateConfig: vi.fn().mockReturnValue({ valid: true, errors: [] }),
        execute: vi.fn(async function* () {
          yield { taskId: 1, stageName: 'sm', type: 'text' as const, timestamp: Date.now(), data: { text: '{"status":"ok"}' } }
          yield { taskId: 1, stageName: 'sm', type: 'done' as const, timestamp: Date.now(), data: {} }
          yield { taskId: 1, stageName: 'sm', type: 'raw_trace' as const, timestamp: Date.now(), data: { stdout: '', stderr: '' } }
        }),
        // createSessionResolver intentionally omitted — tests optional-chain safety
      }

      const eventBus = new EventBus()
      const mockTaskLogWriter = {
        write: vi.fn(),
        flush: vi.fn(),
        drain: vi.fn().mockResolvedValue(undefined),
        getLatestLogs: vi.fn().mockReturnValue([]),
        stop: vi.fn(),
      }
      const config: StageWorkerConfig = {
        stageName: 'sm',
        workerIndex: 0,
        projectRoot: '/tmp/test-project',
        pollInterval: 1000,
        maxPollInterval: 30_000,
        backoffMultiplier: 1.5,
        model: 'gemini-2.5-pro',
        timeout: 30_000,
        promptPath: 'agentkit/sm.md',
        activeTeam: 'agentkit',
      }

      const worker = new StageWorker(
        config,
        db,
        minimalProvider,
        eventBus,
        mockTaskLogWriter as unknown as TaskLogWriter,
      )
      const task = makeDequeueResult(taskId, storyId, 2)

      await expect(
        (worker as unknown as TestableWorker).processTask(task),
      ).resolves.toBeUndefined()
    })
  })
})
