import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StageConfig } from '@core/ConfigTypes'
import { CompletionHandler } from '@workers/CompletionHandler'
import { Router } from '@workers/Router'
import { eventBus } from '@core/EventBus'

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}))

// Mock schema
vi.mock('@core/db/schema.js', () => ({
  tasks: {
    id: 'id',
    storyId: 'story_id',
    stageName: 'stage_name',
    status: 'status',
    output: 'output',
    attempt: 'attempt',
    maxAttempts: 'max_attempts',
  },
  stories: { id: 'id', status: 'status', storyKey: 'story_key', epicId: 'epic_id' },
  epics: { id: 'id', epicKey: 'epic_key' },
}))

// Mock EventBus
vi.mock('@core/EventBus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  EventBus: vi.fn(),
  default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}))

// Mock defaults
vi.mock('@config/defaults.js', () => ({
  MAX_CHAIN_LENGTH: 10,
}))

// Mock StateManager
vi.mock('@core/StateManager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    getTaskChain: vi.fn().mockReturnValue([]),
  })),
}))

function makeStageConfig(overrides: Partial<StageConfig> = {}): StageConfig {
  return {
    name: 'dev',
    displayName: 'Developer',
    icon: '🔨',
    prompt: 'agentkit/prompts/dev.md',
    timeout: 300000,
    workers: 1,
    retries: 3,
    ...overrides,
  }
}

function createMockDb() {
  const txRunFn = vi.fn()
  const txWhereFn = vi.fn().mockReturnValue({ run: txRunFn })
  const txSetFn = vi.fn().mockReturnValue({ where: txWhereFn })
  const txUpdateFn = vi.fn().mockReturnValue({ set: txSetFn })
  const txValuesFn = vi.fn().mockReturnValue({ run: txRunFn })
  const txInsertFn = vi.fn().mockReturnValue({ values: txValuesFn })

  const runFn = vi.fn()
  const getFn = vi.fn().mockReturnValue(undefined)
  const allFn = vi.fn().mockReturnValue([])
  const whereFn = vi.fn().mockReturnValue({ run: runFn, get: getFn, all: allFn })
  const setFn = vi.fn().mockReturnValue({ where: whereFn })
  const updateFn = vi.fn().mockReturnValue({ set: setFn })
  const fromFn = vi.fn().mockReturnValue({ where: whereFn })
  const selectFn = vi.fn().mockReturnValue({ from: fromFn })

  const tx = { update: txUpdateFn, insert: txInsertFn }
  const transactionFn = vi.fn().mockImplementation((cb: (t: typeof tx) => void) => {
    return cb(tx)
  })

  return {
    select: selectFn,
    update: updateFn,
    transaction: transactionFn,
    _getFn: getFn,
    _whereFn: whereFn,
    _runFn: runFn,
    _fromFn: fromFn,
    _txUpdateFn: txUpdateFn,
  }
}

describe('CompletionHandler', () => {
  let mockDb: ReturnType<typeof createMockDb>
  let router: Router
  let stageMap: Map<string, StageConfig>
  let handler: CompletionHandler

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = createMockDb()
    router = new Router(mockDb as never)
    stageMap = new Map<string, StageConfig>()
    stageMap.set('sm', makeStageConfig({ name: 'sm', next: 'dev' }))
    stageMap.set('dev', makeStageConfig({ name: 'dev', next: 'review' }))
    stageMap.set('review', makeStageConfig({ name: 'review', next: 'tester', reject_to: 'dev' }))
    stageMap.set('tester', makeStageConfig({ name: 'tester', reject_to: 'dev' }))
    handler = new CompletionHandler(mockDb as never, router, stageMap)
  })

  describe('isRejectionOutput', () => {
    it('returns false for null output', () => {
      expect(CompletionHandler.isRejectionOutput(null)).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(CompletionHandler.isRejectionOutput('')).toBe(false)
    })

    it('returns false for invalid JSON', () => {
      expect(CompletionHandler.isRejectionOutput('not json')).toBe(false)
    })

    it('returns false when no result field', () => {
      expect(CompletionHandler.isRejectionOutput('{"status":"ok"}')).toBe(false)
    })

    it('returns false for successful result', () => {
      expect(CompletionHandler.isRejectionOutput('{"result":"APPROVED"}')).toBe(false)
    })

    it('returns true for CHANGES_REQUESTED', () => {
      expect(CompletionHandler.isRejectionOutput('{"result":"CHANGES_REQUESTED"}')).toBe(true)
    })

    it('returns true for FAILED', () => {
      expect(CompletionHandler.isRejectionOutput('{"result":"FAILED"}')).toBe(true)
    })
  })

  describe('handleTaskCompletion', () => {
    it('returns early if stage not found in stageMap', () => {
      handler.handleTaskCompletion(1, 10, 'unknown_stage')
      expect(mockDb.select).not.toHaveBeenCalled()
    })

    it('returns early if task not found in DB', () => {
      mockDb._getFn.mockReturnValue(undefined)
      handler.handleTaskCompletion(1, 10, 'dev')
      // select was called but no routing happened
      expect(mockDb.select).toHaveBeenCalled()
    })

    it('routes to next stage on successful completion', () => {
      mockDb._getFn.mockReturnValue({
        output: '{"result":"APPROVED"}',
        attempt: 1,
        maxAttempts: 3,
      })

      const routeSpy = vi.spyOn(router, 'routeCompletedTask')
      const detectLoopSpy = vi.spyOn(router, 'detectLoop').mockReturnValue({
        isLoop: false,
        chainLength: 2,
        stageCounts: {},
      })

      handler.handleTaskCompletion(1, 10, 'dev')

      expect(routeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, storyId: 10 }),
        stageMap.get('dev')
      )
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'task:routed',
        expect.objectContaining({ stageName: 'review' })
      )

      routeSpy.mockRestore()
      detectLoopSpy.mockRestore()
    })

    it('routes rejected task to reject_to stage', () => {
      mockDb._getFn.mockReturnValue({
        output: '{"result":"CHANGES_REQUESTED"}',
        attempt: 1,
        maxAttempts: 3,
      })

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('routed')

      handler.handleTaskCompletion(5, 10, 'review')

      expect(rejectSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 5, storyId: 10, attempt: 1 }),
        stageMap.get('review')
      )
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'task:routed',
        expect.objectContaining({ stageName: 'dev', attempt: 2 })
      )

      rejectSpy.mockRestore()
    })

    it('blocks story when rejected task exceeds max attempts', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"FAILED"}',
          attempt: 3,
          maxAttempts: 3,
        })
        .mockReturnValue({ storyKey: 'story-1.1', epicId: 1 })

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('blocked')

      handler.handleTaskCompletion(5, 10, 'tester')

      expect(rejectSpy).toHaveBeenCalled()
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'task:rejected',
        expect.objectContaining({ taskId: 5, storyId: 10 })
      )
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'story:blocked',
        expect.objectContaining({ storyId: 10, reason: 'MAX_ATTEMPTS_EXCEEDED' })
      )

      rejectSpy.mockRestore()
    })

    it('completes story when no next stage', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"PASSED"}',
          attempt: 1,
          maxAttempts: 3,
        })
        .mockReturnValueOnce({ storyKey: 'story-1.1', epicId: 1 })
        .mockReturnValueOnce({ epicKey: 'epic-1' })

      const completeSpy = vi.spyOn(router, 'completeStory')

      handler.handleTaskCompletion(8, 10, 'tester')

      expect(completeSpy).toHaveBeenCalledWith({ id: 8, storyId: 10 }, 'story-1.1', 'epic-1')

      completeSpy.mockRestore()
    })

    it('blocks story on loop detection', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"APPROVED"}',
          attempt: 1,
          maxAttempts: 3,
        })
        .mockReturnValue({ storyKey: 'story-1.1', epicId: 1 })

      const detectLoopSpy = vi.spyOn(router, 'detectLoop').mockReturnValue({
        isLoop: true,
        chainLength: 10,
        stageCounts: { dev: 5 },
        reason: 'Chain length 10 >= MAX_CHAIN_LENGTH (10)',
      })

      handler.handleTaskCompletion(1, 10, 'dev')

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'story:blocked',
        expect.objectContaining({ storyId: 10, reason: 'LOOP_DETECTED' })
      )
      // Task blocked update should be in a transaction
      expect(mockDb.transaction).toHaveBeenCalled()

      detectLoopSpy.mockRestore()
    })

    it('does not route rejection if stage has no reject_to', () => {
      // Use sm stage which has next but no reject_to
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"FAILED"}',
          attempt: 1,
          maxAttempts: 3,
        })
        .mockReturnValue(undefined)

      const detectLoopSpy = vi.spyOn(router, 'detectLoop').mockReturnValue({
        isLoop: false,
        chainLength: 1,
        stageCounts: {},
      })

      // sm has next: 'dev' but no reject_to, so FAILED output won't trigger rejection path
      handler.handleTaskCompletion(1, 10, 'sm')

      // Should route as normal completion (since no reject_to)
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'task:routed',
        expect.objectContaining({ stageName: 'dev' })
      )

      detectLoopSpy.mockRestore()
    })
  })

  describe('blockStoryAndTask atomic transaction', () => {
    it('updates both task and story in single transaction on max attempts exceeded', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"FAILED"}',
          attempt: 3,
          maxAttempts: 3,
        })
        .mockReturnValue({ storyKey: 'story-1.1', epicId: 1, epicKey: 'epic-1' })

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('blocked')

      handler.handleTaskCompletion(5, 10, 'tester')

      // Verify transaction was called exactly once for atomic blocking
      expect(mockDb.transaction).toHaveBeenCalledTimes(1)

      // Verify that the transaction callback updates both task and story
      const txCallback = mockDb.transaction.mock.calls[0]?.[0]
      expect(txCallback).toBeDefined()

      rejectSpy.mockRestore()
    })

    it('blocks story on loop detection with atomic transaction', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"APPROVED"}',
          attempt: 1,
          maxAttempts: 3,
        })
        .mockReturnValue({ storyKey: 'story-1.1', epicId: 1 })

      const detectLoopSpy = vi.spyOn(router, 'detectLoop').mockReturnValue({
        isLoop: true,
        chainLength: 10,
        stageCounts: { dev: 5 },
        reason: 'Chain length 10 >= MAX_CHAIN_LENGTH (10)',
      })

      handler.handleTaskCompletion(1, 10, 'dev')

      // Task blocked update should be in a single atomic transaction
      expect(mockDb.transaction).toHaveBeenCalledTimes(1)

      // Verify story:blocked event emitted with correct reason
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'story:blocked',
        expect.objectContaining({
          storyId: 10,
          storyKey: 'story-1.1',
          reason: 'LOOP_DETECTED',
          taskId: 1,
        })
      )

      detectLoopSpy.mockRestore()
    })

    it('emits task:rejected event when blocked due to max attempts', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"FAILED"}',
          attempt: 3,
          maxAttempts: 3,
        })
        .mockReturnValue({ storyKey: 'story-1.1', epicId: 1 })

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('blocked')

      handler.handleTaskCompletion(5, 10, 'tester')

      // Verify task:rejected event is emitted before story:blocked
      const rejectedCall = vi
        .mocked(eventBus.emit)
        .mock.calls.find(call => call[0] === 'task:rejected')
      expect(rejectedCall).toBeDefined()
      expect(rejectedCall?.[1]).toEqual(
        expect.objectContaining({
          taskId: 5,
          storyId: 10,
          status: 'rejected',
        })
      )

      // And then story:blocked should follow
      const blockedCall = vi
        .mocked(eventBus.emit)
        .mock.calls.find(call => call[0] === 'story:blocked')
      expect(blockedCall).toBeDefined()

      rejectSpy.mockRestore()
    })

    it('retrieves story info after blocking for event emission', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"FAILED"}',
          attempt: 3,
          maxAttempts: 3,
        })
        .mockReturnValue({ storyKey: 'story-1.2', epicId: 2 })

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('blocked')

      handler.handleTaskCompletion(5, 15, 'tester')

      // Verify story:blocked event contains correct story context
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'story:blocked',
        expect.objectContaining({
          storyId: 15,
          storyKey: 'story-1.2',
          taskId: 5,
        })
      )

      rejectSpy.mockRestore()
    })

    it('includes taskId in story:blocked event on max attempts exceeded', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"FAILED"}',
          attempt: 3,
          maxAttempts: 3,
        })
        .mockReturnValue({ storyKey: 'story-2.3', epicId: 3 })

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('blocked')

      handler.handleTaskCompletion(42, 99, 'review')

      // Verify story:blocked event has taskId field
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'story:blocked',
        expect.objectContaining({
          taskId: 42,
          storyId: 99,
          storyKey: 'story-2.3',
          reason: 'MAX_ATTEMPTS_EXCEEDED',
        })
      )

      rejectSpy.mockRestore()
    })

    it('includes taskId in story:blocked event on loop detection', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"APPROVED"}',
          attempt: 2,
          maxAttempts: 3,
        })
        .mockReturnValue({ storyKey: 'story-3.1', epicId: 4 })

      const detectLoopSpy = vi.spyOn(router, 'detectLoop').mockReturnValue({
        isLoop: true,
        chainLength: 10,
        stageCounts: { dev: 6 },
      })

      handler.handleTaskCompletion(77, 88, 'dev')

      // Verify story:blocked event has taskId field when loop is detected
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'story:blocked',
        expect.objectContaining({
          taskId: 77,
          storyId: 88,
          storyKey: 'story-3.1',
          reason: 'LOOP_DETECTED',
        })
      )

      detectLoopSpy.mockRestore()
    })
  })

  describe('rejection routing atomicity', () => {
    it('routes rejected task atomically (no router DB calls when max attempts exceeded)', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"CHANGES_REQUESTED"}',
          attempt: 3,
          maxAttempts: 3,
        })
        .mockReturnValue({ storyKey: 'story-1.1', epicId: 1 })

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('blocked')

      handler.handleTaskCompletion(5, 10, 'review')

      // Router returns 'blocked', so no routing happens (no new task created)
      expect(rejectSpy).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 3, maxAttempts: 3 }),
        expect.any(Object)
      )

      // Story blocking is delegated to CompletionHandler (atomic with task blocking)
      expect(mockDb.transaction).toHaveBeenCalled()

      rejectSpy.mockRestore()
    })

    it('routes rejected task before max attempts (task+story NOT blocked)', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"CHANGES_REQUESTED"}',
          attempt: 2,
          maxAttempts: 3,
        })
        .mockReturnValue(undefined)

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('routed')

      handler.handleTaskCompletion(5, 10, 'review')

      // Router handles task routing and creates new task atomically
      expect(rejectSpy).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 2, maxAttempts: 3 }),
        expect.any(Object)
      )

      // Story/task blocking transaction should NOT be called
      // (router already handled routing atomically)
      const blockingTransactions = vi.mocked(mockDb.transaction).mock.calls.filter(call => {
        // Check if this looks like a blocking transaction (would update both task and story)
        const txCallback = call[0]
        return typeof txCallback === 'function'
      })

      // Only the task:routed event, not story:blocked
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'task:routed',
        expect.objectContaining({ attempt: 3 })
      )

      rejectSpy.mockRestore()
    })
  })

  describe('completion routing', () => {
    it('routes completed task atomically with new task creation', () => {
      mockDb._getFn.mockReturnValue({
        output: '{"result":"APPROVED"}',
        attempt: 1,
        maxAttempts: 3,
      })

      const routeSpy = vi.spyOn(router, 'routeCompletedTask')
      const detectLoopSpy = vi.spyOn(router, 'detectLoop').mockReturnValue({
        isLoop: false,
        chainLength: 1,
        stageCounts: { sm: 1 },
      })

      handler.handleTaskCompletion(1, 10, 'sm')

      // Router handles routing atomically
      expect(routeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, storyId: 10 }),
        expect.any(Object)
      )

      // Task:routed event emitted with next stage
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'task:routed',
        expect.objectContaining({ stageName: 'dev' })
      )

      routeSpy.mockRestore()
      detectLoopSpy.mockRestore()
    })

    it('completes story when reaching last stage without rejection', () => {
      mockDb._getFn
        .mockReturnValueOnce({
          output: '{"result":"APPROVED"}',
          attempt: 1,
          maxAttempts: 3,
        })
        .mockReturnValueOnce({ storyKey: 'story-1.1', epicId: 1 })
        .mockReturnValueOnce({ epicKey: 'epic-1' })

      const completeSpy = vi.spyOn(router, 'completeStory')

      // tester stage has no 'next', so task completion should complete story
      handler.handleTaskCompletion(8, 10, 'tester')

      expect(completeSpy).toHaveBeenCalledWith({ id: 8, storyId: 10 }, 'story-1.1', 'epic-1')

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'story:completed',
        expect.objectContaining({ storyId: 10 })
      )

      completeSpy.mockRestore()
    })
  })

  describe('task:alert emission', () => {
    it('emits task:alert with isBlocked=false when rejection is routed', () => {
      mockDb._getFn.mockReturnValueOnce({
        output: '{"result":"CHANGES_REQUESTED","issues":["fix this","fix that"]}',
        attempt: 1,
        maxAttempts: 3,
      })

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('routed')

      handler.handleTaskCompletion(5, 10, 'review')

      const alertCall = vi.mocked(eventBus.emit).mock.calls.find(call => call[0] === 'task:alert')
      expect(alertCall).toBeDefined()
      expect(alertCall?.[1]).toEqual(
        expect.objectContaining({
          taskId: 5,
          storyId: 10,
          stageName: 'review',
          isBlocked: false,
          routedTo: 'dev',
          attempt: 1,
          maxAttempts: 3,
          issues: ['fix this', 'fix that'],
        })
      )

      rejectSpy.mockRestore()
    })

    it('emits task:alert with isBlocked=true when rejection is blocked (max attempts)', () => {
      mockDb._getFn.mockReturnValueOnce({
        output: '{"result":"FAILED","issues":["critical error"]}',
        attempt: 3,
        maxAttempts: 3,
      })

      const rejectSpy = vi.spyOn(router, 'routeRejectedTask').mockReturnValue('blocked')

      handler.handleTaskCompletion(5, 10, 'tester')

      const alertCall = vi.mocked(eventBus.emit).mock.calls.find(call => call[0] === 'task:alert')
      expect(alertCall).toBeDefined()
      expect(alertCall?.[1]).toEqual(
        expect.objectContaining({
          taskId: 5,
          storyId: 10,
          stageName: 'tester',
          isBlocked: true,
          attempt: 3,
          maxAttempts: 3,
          issues: ['critical error'],
        })
      )

      rejectSpy.mockRestore()
    })

    it('emits task:alert with isBlocked=true before story:blocked on loop detection', () => {
      mockDb._getFn.mockReturnValueOnce({
        output: '{"result":"APPROVED"}',
        attempt: 1,
        maxAttempts: 3,
      })

      const detectLoopSpy = vi.spyOn(router, 'detectLoop').mockReturnValue({
        isLoop: true,
        chainLength: 10,
        stageCounts: { dev: 5 },
        reason: 'Chain length 10 >= MAX_CHAIN_LENGTH (10)',
      })

      handler.handleTaskCompletion(1, 10, 'dev')

      const allCalls = vi.mocked(eventBus.emit).mock.calls.map(c => c[0])
      const alertIdx = allCalls.indexOf('task:alert')
      const blockedIdx = allCalls.indexOf('story:blocked')

      expect(alertIdx).toBeGreaterThanOrEqual(0)
      expect(blockedIdx).toBeGreaterThanOrEqual(0)
      expect(alertIdx).toBeLessThan(blockedIdx)

      const alertCall = vi.mocked(eventBus.emit).mock.calls.find(call => call[0] === 'task:alert')
      expect(alertCall?.[1]).toEqual(
        expect.objectContaining({
          taskId: 1,
          storyId: 10,
          stageName: 'dev',
          isBlocked: true,
        })
      )

      detectLoopSpy.mockRestore()
    })

    it('parseIssues returns empty array for null output', () => {
      expect(CompletionHandler.parseIssues(null)).toEqual([])
    })

    it('parseIssues returns empty array for invalid JSON', () => {
      expect(CompletionHandler.parseIssues('not json')).toEqual([])
    })

    it('parseIssues returns empty array when no issues field', () => {
      expect(CompletionHandler.parseIssues('{"result":"FAILED"}')).toEqual([])
    })

    it('parseIssues returns issues array from JSON', () => {
      expect(CompletionHandler.parseIssues('{"result":"FAILED","issues":["a","b"]}')).toEqual([
        'a',
        'b',
      ])
    })
  })
})
