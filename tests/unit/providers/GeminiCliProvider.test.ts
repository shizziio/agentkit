import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import readline from 'node:readline'

import { GeminiCliProvider } from '../../../src/providers/agent/GeminiCliProvider.js'
import { processManager } from '../../../src/providers/agent/ProcessManager.js'
import { GeminiSessionResolver } from '../../../src/providers/session/GeminiSessionResolver.js'
import type { ProviderConfig } from '../../../src/providers/interfaces/BaseProvider.js'
import type { StreamEvent } from '../../../src/core/EventTypes.js'

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted so they apply at import time)
// ---------------------------------------------------------------------------

vi.mock('../../../src/core/Logger.js', () => ({
  Logger: { getOrNoop: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) },
}))

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('node:readline', () => ({
  default: { createInterface: vi.fn() },
  createInterface: vi.fn(),
}))

// Mock GeminiSessionResolver (Story 22.2 — not yet implemented)
vi.mock('../../../src/providers/session/GeminiSessionResolver.js', () => ({
  GeminiSessionResolver: vi.fn().mockImplementation(() => ({
    resolve: vi.fn().mockReturnValue(null),
    scanNewSessions: vi.fn().mockReturnValue(0),
  })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class MockChild extends EventEmitter {
  pid: number | undefined
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  }

  constructor(pid?: number) {
    super()
    this.pid = pid
  }
}

class MockRl extends EventEmitter {
  close = vi.fn()
}

function makeMockChild(pid?: number) {
  const child = new MockChild(pid)
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  return child
}

function makeMockRl() {
  const rl = new MockRl()
  vi.mocked(readline.createInterface).mockReturnValue(rl as unknown as ReturnType<typeof readline.createInterface>)
  return rl
}

async function collectEvents(gen: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const e of gen) events.push(e)
  return events
}

const defaultConfig: ProviderConfig = {
  taskId: 1,
  stageName: 'dev',
  model: 'gemini-2.5-pro',
  timeout: 30_000,
  permissions: 'default',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GeminiCliProvider', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  // ── AC1: sessionSupport enabled ────────────────────────────────────────

  describe('capabilities', () => {
    it('should have sessionSupport === true', () => {
      const provider = new GeminiCliProvider()
      expect(provider.capabilities.sessionSupport).toBe(true)
    })

    it('should still have streaming and nativeToolUse enabled', () => {
      const provider = new GeminiCliProvider()
      expect(provider.capabilities.streaming).toBe(true)
      expect(provider.capabilities.nativeToolUse).toBe(true)
    })
  })

  // ── AC5: createSessionResolver ─────────────────────────────────────────

  describe('createSessionResolver()', () => {
    it('should return a non-null object when called with db and projectPath', async () => {
      const provider = new GeminiCliProvider()
      const db = {} as Parameters<typeof provider.createSessionResolver>[0]
      const result = provider.createSessionResolver(db, '/path/to/project')
      expect(result).not.toBeNull()
    })

    it('should return an object with resolve() method', async () => {
      const provider = new GeminiCliProvider()
      const db = {} as Parameters<typeof provider.createSessionResolver>[0]
      const resolver = provider.createSessionResolver(db, '/path/to/project')
      expect(typeof resolver?.resolve).toBe('function')
    })

    it('should return an object with scanNewSessions() method', async () => {
      const provider = new GeminiCliProvider()
      const db = {} as Parameters<typeof provider.createSessionResolver>[0]
      const resolver = provider.createSessionResolver(db, '/path/to/project')
      expect(typeof resolver?.scanNewSessions).toBe('function')
    })

    it('should return null when GeminiSessionResolver constructor throws (import failure resilience)', () => {
      vi.mocked(GeminiSessionResolver).mockImplementationOnce(() => {
        throw new Error('load failed')
      })
      const provider = new GeminiCliProvider()
      const db = {} as Parameters<typeof provider.createSessionResolver>[0]
      const result = provider.createSessionResolver(db, '/path/to/project')
      expect(result).toBeNull()
    })
  })

  // ── execute() tests ────────────────────────────────────────────────────

  describe('execute()', () => {
    beforeEach(() => {
      makeMockRl()
    })

    // ── AC2: TaskName injection for new sessions ─────────────────────────

    describe('TaskName injection', () => {
      it('should prepend TaskName marker when sessionName is set and resumeSession is not set', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const config: ProviderConfig = {
          ...defaultConfig,
          sessionName: 'AGENTKIT-21.1-DEV-abc1',
        }
        const promise = collectEvents(provider.execute('my original prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
        expect(writtenContent).toBe('TaskName: AGENTKIT-21.1-DEV-abc1\nmy original prompt')
      })

      it('should start with TaskName on the first line (marker in preview position)', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const config: ProviderConfig = {
          ...defaultConfig,
          sessionName: 'AGENTKIT-21.1-DEV-abc1',
        }
        const promise = collectEvents(provider.execute('original prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
        expect(writtenContent.split('\n')[0]).toBe('TaskName: AGENTKIT-21.1-DEV-abc1')
      })

      it('should preserve the original prompt unchanged after the TaskName line', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const originalPrompt = 'Do something complex\nwith multiple lines'
        const config: ProviderConfig = {
          ...defaultConfig,
          sessionName: 'AGENTKIT-22.1-DEV-xyz9',
        }
        const promise = collectEvents(provider.execute(originalPrompt, config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
        expect(writtenContent).toBe(`TaskName: AGENTKIT-22.1-DEV-xyz9\n${originalPrompt}`)
      })
    })

    // ── AC3: No TaskName injection for resume sessions ───────────────────

    describe('resume session — no TaskName injection', () => {
      it('should NOT inject TaskName prefix when resumeSession is set', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const config: ProviderConfig = {
          ...defaultConfig,
          resumeSession: 'c05c6ee4-abcd-1234-efgh-000000000001',
        }
        const promise = collectEvents(provider.execute('resume prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
        expect(writtenContent).not.toContain('TaskName:')
      })

      it('should write original prompt unmodified when resumeSession is set', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const config: ProviderConfig = {
          ...defaultConfig,
          resumeSession: 'c05c6ee4-abcd-1234-efgh-000000000001',
        }
        const promise = collectEvents(provider.execute('resume prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
        expect(writtenContent).toBe('resume prompt')
      })
    })

    // ── AC4: Resume flag in args ─────────────────────────────────────────

    describe('resume flag in args', () => {
      it('should include -r <sessionId> in args when resumeSession is set', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const sessionId = 'c05c6ee4-abcd-1234-efgh-000000000001'
        const config: ProviderConfig = {
          ...defaultConfig,
          resumeSession: sessionId,
        }
        const promise = collectEvents(provider.execute('prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
        expect(spawnArgs).toContain('-r')
        expect(spawnArgs).toContain(sessionId)
      })

      it('should have args in exact order: [-m, model, --approval-mode=yolo, -r, sessionId, -p, " "]', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const sessionId = 'c05c6ee4-abcd-1234-efgh-000000000001'
        const config: ProviderConfig = {
          ...defaultConfig,
          resumeSession: sessionId,
        }
        const promise = collectEvents(provider.execute('prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
        expect(spawnArgs).toEqual(['-m', 'gemini-2.5-pro', '--approval-mode=yolo', '-r', sessionId, '-p', ' '])
      })

      it('should position -r before -p in args', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const config: ProviderConfig = {
          ...defaultConfig,
          resumeSession: 'session-abc123',
        }
        const promise = collectEvents(provider.execute('prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
        const rIndex = spawnArgs.indexOf('-r')
        const pIndex = spawnArgs.indexOf('-p')
        expect(rIndex).toBeGreaterThan(-1)
        expect(pIndex).toBeGreaterThan(rIndex)
      })
    })

    // ── AC6: Backward compatibility — no session config ──────────────────

    describe('backward compatibility', () => {
      it('should NOT include -r flag when neither sessionName nor resumeSession is set', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const promise = collectEvents(provider.execute('plain prompt', defaultConfig))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
        expect(spawnArgs).not.toContain('-r')
      })

      it('should use default args when no session config: [-m, model, --approval-mode=yolo, -p, " "]', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const promise = collectEvents(provider.execute('plain prompt', defaultConfig))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
        expect(spawnArgs).toEqual(['-m', 'gemini-2.5-pro', '--approval-mode=yolo', '-p', ' '])
      })

      it('should write original prompt to stdin unchanged when no session config', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const promise = collectEvents(provider.execute('plain original prompt', defaultConfig))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
        expect(writtenContent).toBe('plain original prompt')
      })

      it('should NOT inject TaskName when sessionName is not set', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const promise = collectEvents(provider.execute('plain prompt', defaultConfig))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
        expect(writtenContent).not.toContain('TaskName:')
      })
    })

    // ── Edge cases ────────────────────────────────────────────────────────

    describe('edge cases', () => {
      it('should NOT inject TaskName when both sessionName AND resumeSession are set (resume wins)', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const config: ProviderConfig = {
          ...defaultConfig,
          sessionName: 'AGENTKIT-21.1-DEV-abc1',
          resumeSession: 'c05c6ee4-abcd-1234-efgh-000000000001',
        }
        const promise = collectEvents(provider.execute('prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
        expect(writtenContent).not.toContain('TaskName:')
      })

      it('should include -r flag when both sessionName AND resumeSession are set', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const sessionId = 'c05c6ee4-abcd-1234-efgh-000000000001'
        const config: ProviderConfig = {
          ...defaultConfig,
          sessionName: 'AGENTKIT-21.1-DEV-abc1',
          resumeSession: sessionId,
        }
        const promise = collectEvents(provider.execute('prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
        expect(spawnArgs).toContain('-r')
        expect(spawnArgs).toContain(sessionId)
      })

      it('should NOT inject TaskName when sessionName is empty string (falsy guard)', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const config: ProviderConfig = {
          ...defaultConfig,
          sessionName: '',
        }
        const promise = collectEvents(provider.execute('prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const writtenContent = child.stdin.write.mock.calls[0]?.[0] as string
        expect(writtenContent).not.toContain('TaskName:')
      })

      it('should NOT include -r flag when resumeSession is empty string (falsy guard)', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const config: ProviderConfig = {
          ...defaultConfig,
          resumeSession: '',
        }
        const promise = collectEvents(provider.execute('prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
        expect(spawnArgs).not.toContain('-r')
      })

      it('should include both --settings and -r flags when settingsPath and resumeSession are both set', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const sessionId = 'c05c6ee4-abcd-1234-efgh-000000000001'
        const config: ProviderConfig = {
          ...defaultConfig,
          settingsPath: '/path/to/settings.json',
          resumeSession: sessionId,
        }
        const promise = collectEvents(provider.execute('prompt', config))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
        expect(spawnArgs).toContain('--settings')
        expect(spawnArgs).toContain('/path/to/settings.json')
        expect(spawnArgs).toContain('-r')
        expect(spawnArgs).toContain(sessionId)
      })
    })

    // ── General execute() behavior (regression) ──────────────────────────

    describe('general behavior', () => {
      it('should yield done event on successful exit', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const promise = collectEvents(provider.execute('prompt', defaultConfig))

        setImmediate(() => { child.emit('close', 0) })
        const events = await promise

        expect(events.at(-1)?.type).toBe('done')
      })

      it('should yield error event when process exits with non-zero code', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const promise = collectEvents(provider.execute('prompt', defaultConfig))

        setImmediate(() => { child.emit('close', 1) })
        const events = await promise

        const errorEvent = events.find(e => e.type === 'error')
        expect(errorEvent).toBeDefined()
      })

      it('should yield error event when child.pid is undefined', async () => {
        makeMockChild() // no pid
        makeMockRl()
        const provider = new GeminiCliProvider()

        const events = await collectEvents(provider.execute('prompt', defaultConfig))
        expect(events.length).toBe(1)
        expect(events[0]?.type).toBe('error')
      })

      it('should yield text events for each stdout line', async () => {
        const child = makeMockChild(12345)
        const rl = makeMockRl()
        const provider = new GeminiCliProvider()
        const promise = collectEvents(provider.execute('prompt', defaultConfig))

        setImmediate(() => {
          rl.emit('line', 'line one')
          rl.emit('line', 'line two')
          child.emit('close', 0)
        })

        const events = await promise
        const textEvents = events.filter(e => e.type === 'text')
        expect(textEvents).toHaveLength(2)
        expect(textEvents[0]?.data.text).toBe('line one')
        expect(textEvents[1]?.data.text).toBe('line two')
      })

      it('should register and unregister pid with ProcessManager', async () => {
        const child = makeMockChild(9999)
        const rl = makeMockRl()
        const registerSpy = vi.spyOn(processManager, 'register')
        const unregisterSpy = vi.spyOn(processManager, 'unregister')

        const provider = new GeminiCliProvider()
        const promise = collectEvents(provider.execute('prompt', defaultConfig))

        setImmediate(() => { child.emit('close', 0) })
        await promise

        expect(registerSpy).toHaveBeenCalledWith(9999, child)
        expect(unregisterSpy).toHaveBeenCalledWith(9999)
      })
    })
  })
})
