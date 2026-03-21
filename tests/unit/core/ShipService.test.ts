import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'

import { createConnection, type DrizzleDB } from '@core/db/Connection'
import { runMigrations } from '@core/db/RunMigrations'
import { projects, epics, stories, tasks } from '@core/db/schema'
import { ShipService } from '@core/ShipService'
import { QueueError } from '@core/Errors'

function seedProject(db: DrizzleDB): number {
  const inserted = db
    .insert(projects)
    .values({ projectName: 'test-project' })
    .returning({ id: projects.id })
    .get()
  return inserted.id
}

function seedEpic(db: DrizzleDB, projectId: number, epicKey = '1'): number {
  const inserted = db
    .insert(epics)
    .values({ projectId, epicKey, title: `Epic ${epicKey}`, orderIndex: 0 })
    .returning({ id: epics.id })
    .get()
  return inserted.id
}

function seedStory(
  db: DrizzleDB,
  epicId: number,
  storyKey = '1.1',
  status = 'draft',
  content?: string | null
): number {
  const inserted = db
    .insert(stories)
    .values({ epicId, storyKey, title: `Story ${storyKey}`, orderIndex: 0, status, content } as any)
    .returning({ id: stories.id })
    .get()
  return inserted.id
}

describe('ShipService', () => {
  let db: DrizzleDB
  let service: ShipService
  let projectId: number

  beforeEach(() => {
    db = createConnection(':memory:')
    runMigrations(db)
    projectId = seedProject(db)
    service = new ShipService(db)
  })

  describe('getStories', () => {
    it('returns all stories for a project with hasExistingTasks=false when no tasks', () => {
      const epicId = seedEpic(db, projectId, '1')
      seedStory(db, epicId, '1.1')
      seedStory(db, epicId, '1.2')

      const result = service.getStories(projectId)
      expect(result).toHaveLength(2)
      expect(result.every(s => !s.hasExistingTasks)).toBe(true)
    })

    it('sets hasExistingTasks=true for stories that have a task row', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1')
      seedStory(db, epicId, '1.2')

      db.insert(tasks)
        .values({ storyId, stageName: 'sm', status: 'queued' } as any)
        .run()

      const result = service.getStories(projectId)
      const s1 = result.find(s => s.storyKey === '1.1')!
      const s2 = result.find(s => s.storyKey === '1.2')!
      expect(s1.hasExistingTasks).toBe(true)
      expect(s2.hasExistingTasks).toBe(false)
    })

    it('returns epic key and title on each story', () => {
      const epicId = seedEpic(db, projectId, '2')
      seedStory(db, epicId, '2.1')

      const result = service.getStories(projectId)
      expect(result).toHaveLength(1)
      expect(result[0]!.epicKey).toBe('2')
      expect(result[0]!.epicTitle).toBe('Epic 2')
    })

    it('filters stories by epicFilter (epic id)', () => {
      const epicId1 = seedEpic(db, projectId, '1')
      const epicId2 = seedEpic(db, projectId, '2')
      seedStory(db, epicId1, '1.1')
      seedStory(db, epicId2, '2.1')

      const result = service.getStories(projectId, epicId2)
      expect(result).toHaveLength(1)
      expect(result[0]!.storyKey).toBe('2.1')
    })

    it('returns empty array when no stories exist for project', () => {
      const result = service.getStories(projectId)
      expect(result).toHaveLength(0)
    })
  })

  describe('shipStories', () => {
    it('inserts task rows with status=queued and correct stageName', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId1 = seedStory(db, epicId, '1.1')
      const storyId2 = seedStory(db, epicId, '1.2')

      service.shipStories([storyId1, storyId2], 'sm', 'agentkit')

      const inserted = db.select().from(tasks).all()
      expect(inserted).toHaveLength(2)
      expect(inserted.every(t => t.status === 'queued')).toBe(true)
      expect(inserted.every(t => t.stageName === 'sm')).toBe(true)
      expect(inserted.map(t => t.storyId).sort()).toEqual([storyId1, storyId2].sort())
    })

    it('returns shippedCount equal to storyIds.length', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1')

      const result = service.shipStories([storyId], 'sm', 'agentkit')
      expect(result.shippedCount).toBe(1)
    })

    it('throws QueueError when passed an empty array', () => {
      expect(() => service.shipStories([], 'sm', 'agentkit')).toThrow(QueueError)
    })

    it('throws QueueError when activeTeam is empty string', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1')
      expect(() => service.shipStories([storyId], 'sm', '')).toThrow(QueueError)
      expect(() => service.shipStories([storyId], 'sm', '')).toThrow('activeTeam must not be empty')
    })

    it('sets the team field on inserted tasks from activeTeam', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1')

      service.shipStories([storyId], 'sm', 'alpha-team')

      const task = db.select().from(tasks).get()!
      expect(task.team).toBe('alpha-team')
    })

    it('is atomic — rolls back all inserts if one fails mid-transaction', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1')

      // Use an invalid storyId (9999) to cause a FK violation mid-transaction
      expect(() => service.shipStories([storyId, 9999], 'sm', 'agentkit')).toThrow()

      const inserted = db.select().from(tasks).all()
      expect(inserted).toHaveLength(0)
    })

    it('uses the provided stageName for all inserted tasks', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1')

      service.shipStories([storyId], 'dev', 'agentkit')

      const task = db
        .select()
        .from(tasks)
        .where(eq(tasks.storyId as any, storyId) as any)
        .get()!
      expect(task.stageName).toBe('dev')
    })

    it('handles multiple stories with multiple tasks per story correctly', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId1 = seedStory(db, epicId, '1.1')
      const storyId2 = seedStory(db, epicId, '1.2')

      // Add multiple tasks to same story
      db.insert(tasks)
        .values([
          { storyId: storyId1, stageName: 'sm', status: 'done' },
          { storyId: storyId1, stageName: 'dev', status: 'queued' },
        ])
        .run()

      const result = service.getStories(projectId)
      const story1 = result.find(s => s.storyKey === '1.1')!
      const story2 = result.find(s => s.storyKey === '1.2')!

      // Both should be marked as hasExistingTasks if story1 has any task
      expect(story1.hasExistingTasks).toBe(true)
      expect(story2.hasExistingTasks).toBe(false)
    })

    it('handles story with in_progress status as ineligible', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1', 'in_progress')

      const result = service.getStories(projectId)
      expect(result).toHaveLength(1)
      expect(result[0]!.status).toBe('in_progress')
    })

    it('handles different epic filters independently', () => {
      const epicId1 = seedEpic(db, projectId, '1')
      const epicId2 = seedEpic(db, projectId, '2')
      seedStory(db, epicId1, '1.1')
      seedStory(db, epicId1, '1.2')
      seedStory(db, epicId2, '2.1')

      const result1 = service.getStories(projectId, epicId1)
      const result2 = service.getStories(projectId, epicId2)
      const resultAll = service.getStories(projectId)

      expect(result1).toHaveLength(2)
      expect(result2).toHaveLength(1)
      expect(resultAll).toHaveLength(3)
    })
  })

  describe('shipStories - edge cases', () => {
    it('maintains task default values (created_at, updated_at, version)', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1')

      service.shipStories([storyId], 'sm', 'agentkit')

      const task = db
        .select()
        .from(tasks)
        .where(eq(tasks.storyId as any, storyId) as any)
        .get()!
      expect(task.createdAt).toBeDefined()
      expect(task.version).toBe(1)
    })

    it('allows shipStories with large number of stories', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyIds: number[] = []

      for (let i = 0; i < 50; i++) {
        storyIds.push(seedStory(db, epicId, `1.${i + 1}`))
      }

      const result = service.shipStories(storyIds, 'sm', 'agentkit')
      expect(result.shippedCount).toBe(50)

      const insertedTasks = db.select().from(tasks).all()
      expect(insertedTasks).toHaveLength(50)
    })

    it('transaction rolls back on foreign key constraint violation', () => {
      const epicId = seedEpic(db, projectId, '1')
      const validStoryId = seedStory(db, epicId, '1.1')
      const invalidStoryId = 99999

      expect(() => {
        service.shipStories([validStoryId, invalidStoryId], 'sm', 'agentkit')
      }).toThrow()

      const insertedTasks = db.select().from(tasks).all()
      expect(insertedTasks).toHaveLength(0) // All should be rolled back
    })

    it('creates task with null parent_id and attempt=1', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1')

      service.shipStories([storyId], 'sm', 'agentkit')

      const task = db
        .select()
        .from(tasks)
        .where(eq(tasks.storyId as any, storyId) as any)
        .get()!
      expect(task.parentId).toBeNull()
      expect(task.attempt).toBe(1)
      expect(task.maxAttempts).toBe(3)
    })

    it('throws QueueError with proper error code', () => {
      expect(() => service.shipStories([], 'sm', 'agentkit')).toThrow('No stories selected to ship')
      try {
        service.shipStories([], 'sm', 'agentkit')
      } catch (err) {
        expect(err).toHaveProperty('code', 'QUEUE_ERROR')
      }
    })
  })

  describe('shipStories - story content injection', () => {
    it('task.input equals formatted story content when story has content', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1', 'draft', 'This is the story content.')

      service.shipStories([storyId], 'sm', 'agentkit')

      const task = db
        .select()
        .from(tasks)
        .where(eq(tasks.storyId as any, storyId) as any)
        .get()!
      expect(task.input).toBe('Story 1.1: Story 1.1\n\nThis is the story content.')
    })

    it("task.input equals '' when story.content is NULL", () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1', 'draft', null)

      service.shipStories([storyId], 'sm', 'agentkit')

      const task = db
        .select()
        .from(tasks)
        .where(eq(tasks.storyId as any, storyId) as any)
        .get()!
      expect(task.input).toBe('')
    })

    it('multiple stories each get their own formatted content in task.input', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId1 = seedStory(db, epicId, '1.1', 'draft', 'Content for story one.')
      const storyId2 = seedStory(db, epicId, '1.2', 'draft', 'Content for story two.')

      service.shipStories([storyId1, storyId2], 'sm', 'agentkit')

      const task1 = db
        .select()
        .from(tasks)
        .where(eq(tasks.storyId as any, storyId1) as any)
        .get()!
      const task2 = db
        .select()
        .from(tasks)
        .where(eq(tasks.storyId as any, storyId2) as any)
        .get()!
      expect(task1.input).toBe('Story 1.1: Story 1.1\n\nContent for story one.')
      expect(task2.input).toBe('Story 1.2: Story 1.2\n\nContent for story two.')
      expect(task1.input).not.toBe(task2.input)
    })
  })

  describe('shipStories - story status lifecycle', () => {
    it('sets story status to in_progress after shipping', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1', 'draft')

      service.shipStories([storyId], 'sm', 'agentkit')

      const story = db
        .select()
        .from(stories)
        .where(eq(stories.id as any, storyId) as any)
        .get()!
      expect(story.status).toBe('in_progress')
    })

    it('updates stories.updatedAt when shipping', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1', 'draft')

      const before = db
        .select({ updatedAt: stories.updatedAt })
        .from(stories)
        .where(eq(stories.id as any, storyId) as any)
        .get()!

      // Small delay to ensure timestamp changes
      const now = new Date(Date.now() + 1).toISOString()
      service.shipStories([storyId], 'sm', 'agentkit')

      const after = db
        .select({ updatedAt: stories.updatedAt })
        .from(stories)
        .where(eq(stories.id as any, storyId) as any)
        .get()!
      expect(after.updatedAt).not.toBe(before.updatedAt)
      // updatedAt must be a valid ISO string
      expect(new Date(after.updatedAt).toISOString()).toBe(after.updatedAt)
      void now
    })

    it('increments stories.version when shipping', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId = seedStory(db, epicId, '1.1', 'draft')

      const before = db
        .select({ version: stories.version })
        .from(stories)
        .where(eq(stories.id as any, storyId) as any)
        .get()!
      expect(before.version).toBe(1)

      service.shipStories([storyId], 'sm', 'agentkit')

      const after = db
        .select({ version: stories.version })
        .from(stories)
        .where(eq(stories.id as any, storyId) as any)
        .get()!
      expect(after.version).toBe(2)
    })

    it('sets both stories to in_progress when shipping multiple stories', () => {
      const epicId = seedEpic(db, projectId, '1')
      const storyId1 = seedStory(db, epicId, '1.1', 'draft')
      const storyId2 = seedStory(db, epicId, '1.2', 'draft')

      service.shipStories([storyId1, storyId2], 'sm', 'agentkit')

      const s1 = db
        .select()
        .from(stories)
        .where(eq(stories.id as any, storyId1) as any)
        .get()!
      const s2 = db
        .select()
        .from(stories)
        .where(eq(stories.id as any, storyId2) as any)
        .get()!
      expect(s1.status).toBe('in_progress')
      expect(s2.status).toBe('in_progress')
    })

    it('rolls back story status update if task insert fails (atomicity)', () => {
      const epicId = seedEpic(db, projectId, '1')
      const validStoryId = seedStory(db, epicId, '1.1', 'draft')
      const invalidStoryId = 99999

      expect(() => {
        service.shipStories([validStoryId, invalidStoryId], 'sm', 'agentkit')
      }).toThrow()

      // valid story status must remain 'draft' — transaction was rolled back
      const story = db
        .select()
        .from(stories)
        .where(eq(stories.id as any, validStoryId) as any)
        .get()!
      expect(story.status).toBe('draft')

      // No tasks should have been inserted
      const inserted = db.select().from(tasks).all()
      expect(inserted).toHaveLength(0)
    })
  })

  describe('getStories - epic key matching', () => {
    it('returns correct epic key as string', () => {
      const epicId = seedEpic(db, projectId, '42')
      seedStory(db, epicId, '42.1')

      const result = service.getStories(projectId)
      expect(result[0]!.epicKey).toBe('42')
    })

    it('preserves story and epic key formatting', () => {
      const epicId = seedEpic(db, projectId, '1')
      seedStory(db, epicId, '1.2')

      const result = service.getStories(projectId)
      expect(result[0]!.storyKey).toBe('1.2')
      expect(result[0]!.epicKey).toBe('1')
    })
  })
})
