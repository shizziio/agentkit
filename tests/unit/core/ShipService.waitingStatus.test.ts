import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { createConnection, type DrizzleDB } from '@core/db/Connection.js'
import { runMigrations } from '@core/db/RunMigrations.js'
import { projects, epics, stories, tasks } from '@core/db/schema.js'
import type { Story, Task } from '@core/db/schema.js'
import { ShipService } from '@core/ShipService.js'
import { EventBus } from '@core/EventBus.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmittedEvent {
  event: string
  data: Record<string, unknown>
}

function isEmittedEvent(e: unknown): e is EmittedEvent {
  return (
    typeof e === 'object' &&
    e !== null &&
    'event' in e &&
    'data' in e &&
    typeof (e as { event: unknown }).event === 'string'
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: 'test-project' })
    .returning({ id: projects.id })
    .get().id
}

function seedEpic(db: DrizzleDB, projectId: number, epicKey = '21'): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey, title: `Epic ${epicKey}`, orderIndex: 0 })
    .returning({ id: epics.id })
    .get().id
}

function seedStory(
  db: DrizzleDB,
  epicId: number,
  storyKey: string,
  opts: { status?: string; dependsOn?: string[] | null; content?: string } = {},
): number {
  const { status = 'draft', dependsOn = null, content } = opts
  const dependsOnJson = dependsOn && dependsOn.length > 0 ? JSON.stringify(dependsOn) : null
  return db
    .insert(stories)
    .values({
      epicId,
      storyKey,
      title: `Story ${storyKey}`,
      orderIndex: 0,
      status,
      content: content ?? null,
      dependsOn: dependsOnJson,
    })
    .returning({ id: stories.id })
    .get().id
}

function getStory(db: DrizzleDB, storyId: number): Story {
  return db.select().from(stories).where(eq(stories.id, storyId)).get()!
}

function getTasksForStory(db: DrizzleDB, storyId: number): Task[] {
  return db.select().from(tasks).where(eq(tasks.storyId, storyId)).all()
}

function getAllTasks(db: DrizzleDB): Task[] {
  return db.select().from(tasks).all()
}

function makeMockBus(emitted: unknown[]): EventBus {
  return {
    emit: (_event: string, data: unknown) => { emitted.push({ event: _event, data }) },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as EventBus
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ShipService — waiting status (story deps)', () => {
  let db: DrizzleDB
  let service: ShipService
  let projectId: number
  let epicId: number

  beforeEach(() => {
    db = createConnection(':memory:')
    runMigrations(db)
    projectId = seedProject(db)
    epicId = seedEpic(db, projectId, '21')
    service = new ShipService(db)
  })

  // -------------------------------------------------------------------------
  // AC1: story with no deps → in_progress + task (identical to existing behaviour)
  // -------------------------------------------------------------------------
  describe('AC1: ship story with no dependencies', () => {
    it('should set status=in_progress when dependsOn is NULL', () => {
      const storyId = seedStory(db, epicId, '21.1', { dependsOn: null })

      service.shipStories([storyId], 'sm', 'agentkit')

      expect(getStory(db, storyId).status).toBe('in_progress')
    })

    it('should create a task when dependsOn is NULL', () => {
      const storyId = seedStory(db, epicId, '21.1', { dependsOn: null })

      service.shipStories([storyId], 'sm', 'agentkit')

      expect(getTasksForStory(db, storyId)).toHaveLength(1)
    })

    it('should return shippedCount=1 when single story has no deps', () => {
      const storyId = seedStory(db, epicId, '21.1', { dependsOn: null })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(result.shippedCount).toBe(1)
    })

    it('should return waitingCount=0 when no story is waiting', () => {
      const storyId = seedStory(db, epicId, '21.1', { dependsOn: null })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(result.waitingCount).toBe(0)
    })

    it('should return empty waitingStories array when no story is waiting', () => {
      const storyId = seedStory(db, epicId, '21.1', { dependsOn: null })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(result.waitingStories).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // AC2: story whose ALL deps are already done → in_progress + task
  // -------------------------------------------------------------------------
  describe('AC2: ship story — all dependencies met (deps done)', () => {
    it('should set status=in_progress when all deps have status=done', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      service.shipStories([storyId], 'sm', 'agentkit')

      expect(getStory(db, storyId).status).toBe('in_progress')
    })

    it('should create a task when all deps are done', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      service.shipStories([storyId], 'sm', 'agentkit')

      expect(getTasksForStory(db, storyId)).toHaveLength(1)
    })

    it('should return shippedCount=1 when single story with met deps ships', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(result.shippedCount).toBe(1)
      expect(result.waitingCount).toBe(0)
    })

    it('should set status=in_progress when ALL of multiple deps are done', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })
      seedStory(db, epicId, '21.2', { status: 'done' })
      const storyId = seedStory(db, epicId, '21.3', { dependsOn: ['21.1', '21.2'] })

      service.shipStories([storyId], 'sm', 'agentkit')

      expect(getStory(db, storyId).status).toBe('in_progress')
      expect(getTasksForStory(db, storyId)).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC3: story with unmet deps → waiting, NO task
  // -------------------------------------------------------------------------
  describe('AC3: ship story — dependency not done (unmet)', () => {
    it('should set status=waiting when dep story is draft', () => {
      seedStory(db, epicId, '21.1', { status: 'draft' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      service.shipStories([storyId], 'sm', 'agentkit')

      expect(getStory(db, storyId).status).toBe('waiting')
    })

    it('should NOT create a task when dep is unmet', () => {
      seedStory(db, epicId, '21.1', { status: 'draft' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      service.shipStories([storyId], 'sm', 'agentkit')

      expect(getTasksForStory(db, storyId)).toHaveLength(0)
    })

    it('should return shippedCount=0 and waitingCount=1', () => {
      seedStory(db, epicId, '21.1', { status: 'draft' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(result.shippedCount).toBe(0)
      expect(result.waitingCount).toBe(1)
    })

    it('should include unmet dep storyKey in waitingStories', () => {
      seedStory(db, epicId, '21.1', { status: 'draft' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(result.waitingStories).toHaveLength(1)
      expect(result.waitingStories[0]!.storyKey).toBe('21.2')
      expect(result.waitingStories[0]!.unmetDeps).toEqual(['21.1'])
    })

    it('should set status=waiting when dep is in_progress (not done)', () => {
      seedStory(db, epicId, '21.1', { status: 'in_progress' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      service.shipStories([storyId], 'sm', 'agentkit')

      expect(getStory(db, storyId).status).toBe('waiting')
      expect(getTasksForStory(db, storyId)).toHaveLength(0)
    })

    it('should set status=waiting when ANY dep is unmet (partial done)', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })
      seedStory(db, epicId, '21.2', { status: 'draft' })
      const storyId = seedStory(db, epicId, '21.3', { dependsOn: ['21.1', '21.2'] })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(getStory(db, storyId).status).toBe('waiting')
      expect(getTasksForStory(db, storyId)).toHaveLength(0)
      expect(result.waitingStories[0]!.unmetDeps).toEqual(['21.2'])
    })
  })

  // -------------------------------------------------------------------------
  // AC4: ship all — mixed deps (A no deps, B depends A, C depends B)
  // -------------------------------------------------------------------------
  describe('AC4: ship all — mixed dependency chain', () => {
    it('should set A=in_progress, B=waiting, C=waiting', () => {
      const idA = seedStory(db, epicId, '21.1', { dependsOn: null })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })
      const idC = seedStory(db, epicId, '21.3', { dependsOn: ['21.2'] })

      service.shipStories([idA, idB, idC], 'sm', 'agentkit')

      expect(getStory(db, idA).status).toBe('in_progress')
      expect(getStory(db, idB).status).toBe('waiting')
      expect(getStory(db, idC).status).toBe('waiting')
    })

    it('should create task only for A', () => {
      const idA = seedStory(db, epicId, '21.1', { dependsOn: null })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })
      const idC = seedStory(db, epicId, '21.3', { dependsOn: ['21.2'] })

      service.shipStories([idA, idB, idC], 'sm', 'agentkit')

      expect(getTasksForStory(db, idA)).toHaveLength(1)
      expect(getTasksForStory(db, idB)).toHaveLength(0)
      expect(getTasksForStory(db, idC)).toHaveLength(0)
    })

    it('should return shippedCount=1 and waitingCount=2', () => {
      const idA = seedStory(db, epicId, '21.1', { dependsOn: null })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })
      const idC = seedStory(db, epicId, '21.3', { dependsOn: ['21.2'] })

      const result = service.shipStories([idA, idB, idC], 'sm', 'agentkit')

      expect(result.shippedCount).toBe(1)
      expect(result.waitingCount).toBe(2)
    })

    it('should list B and C in waitingStories with correct unmetDeps', () => {
      const idA = seedStory(db, epicId, '21.1', { dependsOn: null })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })
      const idC = seedStory(db, epicId, '21.3', { dependsOn: ['21.2'] })

      const result = service.shipStories([idA, idB, idC], 'sm', 'agentkit')

      const waiting = result.waitingStories
      expect(waiting).toHaveLength(2)
      const waitB = waiting.find(w => w.storyKey === '21.2')!
      const waitC = waiting.find(w => w.storyKey === '21.3')!
      // A is now in_progress (not done), so B waits on it
      expect(waitB.unmetDeps).toEqual(['21.1'])
      // B is waiting (not done), so C waits on it
      expect(waitC.unmetDeps).toEqual(['21.2'])
    })

    it('total tasks inserted equals shippedCount only', () => {
      const idA = seedStory(db, epicId, '21.1', { dependsOn: null })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })
      const idC = seedStory(db, epicId, '21.3', { dependsOn: ['21.2'] })

      service.shipStories([idA, idB, idC], 'sm', 'agentkit')

      expect(getAllTasks(db)).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // AC5: ship B and C where A is already done
  // -------------------------------------------------------------------------
  describe('AC5: ship subset — some deps already done before ship', () => {
    it('should set B=in_progress (A is done) and C=waiting (B just became in_progress)', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })      // A — pre-existing done
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })
      const idC = seedStory(db, epicId, '21.3', { dependsOn: ['21.2'] })

      service.shipStories([idB, idC], 'sm', 'agentkit')

      expect(getStory(db, idB).status).toBe('in_progress')
      expect(getStory(db, idC).status).toBe('waiting')
    })

    it('should create task for B but NOT for C', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })
      const idC = seedStory(db, epicId, '21.3', { dependsOn: ['21.2'] })

      service.shipStories([idB, idC], 'sm', 'agentkit')

      expect(getTasksForStory(db, idB)).toHaveLength(1)
      expect(getTasksForStory(db, idC)).toHaveLength(0)
    })

    it('should return shippedCount=1 and waitingCount=1', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })
      const idC = seedStory(db, epicId, '21.3', { dependsOn: ['21.2'] })

      const result = service.shipStories([idB, idC], 'sm', 'agentkit')

      expect(result.shippedCount).toBe(1)
      expect(result.waitingCount).toBe(1)
    })

    it('should list C in waitingStories with unmetDeps=[21.2]', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })
      const idC = seedStory(db, epicId, '21.3', { dependsOn: ['21.2'] })

      const result = service.shipStories([idB, idC], 'sm', 'agentkit')

      expect(result.waitingStories).toHaveLength(1)
      expect(result.waitingStories[0]!.storyKey).toBe('21.3')
      // B just became in_progress (not done) → C must wait
      expect(result.waitingStories[0]!.unmetDeps).toEqual(['21.2'])
    })
  })

  // -------------------------------------------------------------------------
  // AC6: EventBus task:queued only emitted for shipped stories
  // -------------------------------------------------------------------------
  describe('AC6: EventBus emits task:queued only for shipped stories', () => {
    it('should emit task:queued for shipped story but NOT for waiting story', () => {
      const emitted: unknown[] = []
      const svc = new ShipService(db, makeMockBus(emitted))

      seedStory(db, epicId, '21.1', { status: 'draft' }) // dep — not done
      const idA = seedStory(db, epicId, '21.2', { dependsOn: null })
      const idB = seedStory(db, epicId, '21.3', { dependsOn: ['21.1'] })

      svc.shipStories([idA, idB], 'sm', 'agentkit')

      const queuedEvents = emitted.filter(isEmittedEvent).filter(e => e.event === 'task:queued')
      expect(queuedEvents).toHaveLength(1)
      expect(queuedEvents[0]!.data['storyId']).toBe(idA)
    })

    it('should emit zero task:queued events when all stories are waiting', () => {
      const emitted: unknown[] = []
      const svc = new ShipService(db, makeMockBus(emitted))

      seedStory(db, epicId, '21.1', { status: 'draft' })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      svc.shipStories([idB], 'sm', 'agentkit')

      const queuedEvents = emitted.filter(isEmittedEvent).filter(e => e.event === 'task:queued')
      expect(queuedEvents).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // AC7: ShipResult always has waitingCount and waitingStories
  // -------------------------------------------------------------------------
  describe('AC7: ShipResult always includes waitingCount and waitingStories', () => {
    it('should always have waitingCount field even when 0', () => {
      const storyId = seedStory(db, epicId, '21.1')

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(result).toHaveProperty('waitingCount')
      expect(result.waitingCount).toBe(0)
    })

    it('should always have waitingStories array even when empty', () => {
      const storyId = seedStory(db, epicId, '21.1')

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(result).toHaveProperty('waitingStories')
      expect(Array.isArray(result.waitingStories)).toBe(true)
      expect(result.waitingStories).toHaveLength(0)
    })

    it('should still have shippedCount for backward compatibility', () => {
      const storyId = seedStory(db, epicId, '21.1')

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(result).toHaveProperty('shippedCount')
      expect(result.shippedCount).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('should treat depends_on=[] (empty JSON array) as no deps → ship normally', () => {
      const storyId = seedStory(db, epicId, '21.1', { dependsOn: [] })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(getStory(db, storyId).status).toBe('in_progress')
      expect(getTasksForStory(db, storyId)).toHaveLength(1)
      expect(result.waitingCount).toBe(0)
    })

    it('should treat cross-epic dep as unmet (checkDepsMetInTx only checks same epicId)', () => {
      const otherEpicId = seedEpic(db, projectId, '20')
      // Place dep story in a different epic with status=done
      seedStory(db, otherEpicId, '20.1', { status: 'done' })
      // Story in current epic that depends on cross-epic storyKey
      const storyId = seedStory(db, epicId, '21.1', { dependsOn: ['20.1'] })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      // Cross-epic dep cannot be found in same epicId → treated as unmet
      expect(getStory(db, storyId).status).toBe('waiting')
      expect(getTasksForStory(db, storyId)).toHaveLength(0)
      expect(result.waitingStories[0]!.unmetDeps).toContain('20.1')
    })

    it('should re-evaluate a waiting story and ship if deps are now done', () => {
      seedStory(db, epicId, '21.1', { status: 'done' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'], status: 'waiting' })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(getStory(db, storyId).status).toBe('in_progress')
      expect(getTasksForStory(db, storyId)).toHaveLength(1)
      expect(result.waitingCount).toBe(0)
    })

    it('should keep waiting story waiting if reshipped but dep still unmet', () => {
      seedStory(db, epicId, '21.1', { status: 'draft' })
      const storyId = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'], status: 'waiting' })

      const result = service.shipStories([storyId], 'sm', 'agentkit')

      expect(getStory(db, storyId).status).toBe('waiting')
      expect(getTasksForStory(db, storyId)).toHaveLength(0)
      expect(result.waitingCount).toBe(1)
    })

    it('should treat malformed depends_on JSON as no deps and ship normally', () => {
      // Insert with raw malformed JSON directly — dependsOn is text() so accepts any string
      const inserted = db
        .insert(stories)
        .values({
          epicId,
          storyKey: '21.1',
          title: 'Story 21.1',
          orderIndex: 0,
          status: 'draft',
          dependsOn: '{malformed json}',
        })
        .returning({ id: stories.id })
        .get()

      // Should not throw — treat as no deps
      const result = service.shipStories([inserted.id], 'sm', 'agentkit')

      expect(getStory(db, inserted.id).status).toBe('in_progress')
      expect(getTasksForStory(db, inserted.id)).toHaveLength(1)
      expect(result.waitingCount).toBe(0)
    })

    it('should produce no tasks when all stories in epic have circular-like deps', () => {
      // All waiting — circular scenario: each depends on the other's unresolved status
      const idA = seedStory(db, epicId, '21.1', { dependsOn: ['21.2'] })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: ['21.1'] })

      const result = service.shipStories([idA, idB], 'sm', 'agentkit')

      expect(getTasksForStory(db, idA)).toHaveLength(0)
      expect(getTasksForStory(db, idB)).toHaveLength(0)
      expect(result.shippedCount).toBe(0)
      expect(result.waitingCount).toBe(2)
    })

    it('should evaluate deps using committed-DB state not in-transaction optimistic state', () => {
      // Both A and B in same shipStories call: A depends on B
      // B becomes in_progress during the transaction, but in_progress != done → A waits
      const idA = seedStory(db, epicId, '21.1', { dependsOn: ['21.2'] })
      const idB = seedStory(db, epicId, '21.2', { dependsOn: null })

      // ship B first then A; B becomes in_progress, but A's dep (B) is in_progress not done
      const result = service.shipStories([idB, idA], 'sm', 'agentkit')

      expect(getStory(db, idB).status).toBe('in_progress')
      expect(getStory(db, idA).status).toBe('waiting')
      expect(result.shippedCount).toBe(1) // only B
      expect(result.waitingCount).toBe(1)  // A waits
    })
  })
})
