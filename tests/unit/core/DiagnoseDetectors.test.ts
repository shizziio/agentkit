import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'

import { createConnection, type DrizzleDB } from '@core/db/Connection'
import { runMigrations } from '@core/db/RunMigrations'
import { projects, epics, stories, tasks } from '@core/db/schema'
import { detectLoop, findFailedAndBlockedIssues } from '@core/DiagnoseDetectors'
import { MAX_CHAIN_LENGTH } from '@config/defaults'

// ─── helpers ──────────────────────────────────────────────────────────────────

function setup(): { db: DrizzleDB; storyId: number } {
  const db = createConnection(':memory:')
  runMigrations(db)
  const projectId = db
    .insert(projects)
    .values({ projectName: 'test' })
    .returning({ id: projects.id })
    .get()!.id
  const epicId = db
    .insert(epics)
    .values({ projectId, epicKey: '1', title: 'Epic', orderIndex: 0 })
    .returning({ id: epics.id })
    .get()!.id
  const storyId = db
    .insert(stories)
    .values({ epicId, storyKey: '1.1', title: 'Story', orderIndex: 0 })
    .returning({ id: stories.id })
    .get()!.id
  return { db, storyId }
}

function insertTask(
  db: DrizzleDB,
  storyId: number,
  stageName: string,
  status: string,
  opts: { parentId?: number | null; superseded?: number } = {},
): number {
  return db
    .insert(tasks)
    .values({
      storyId,
      stageName,
      status,
      parentId: opts.parentId ?? null,
      superseded: opts.superseded ?? 0,
    })
    .returning({ id: tasks.id })
    .get()!.id
}

// ─── detectLoop ───────────────────────────────────────────────────────────────

describe('detectLoop', () => {
  it('returns false for a single-task chain (no parent)', () => {
    const { db, storyId } = setup()
    const taskId = insertTask(db, storyId, 'sm', 'blocked')
    expect(detectLoop(db, taskId)).toBe(false)
  })

  it('returns false for a short non-repeating chain', () => {
    const { db, storyId } = setup()
    const t1 = insertTask(db, storyId, 'sm', 'done')
    const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1 })
    const t3 = insertTask(db, storyId, 'review', 'blocked', { parentId: t2 })
    expect(detectLoop(db, t3)).toBe(false)
  })

  it('returns true when a stage appears > 3 times (MAX_STAGE_REPEATS) in non-superseded chain', () => {
    const { db, storyId } = setup()
    // sm → dev → sm → dev → sm → dev → sm (sm=4 times)
    const t1 = insertTask(db, storyId, 'sm', 'done')
    const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1 })
    const t3 = insertTask(db, storyId, 'sm', 'done', { parentId: t2 })
    const t4 = insertTask(db, storyId, 'dev', 'done', { parentId: t3 })
    const t5 = insertTask(db, storyId, 'sm', 'done', { parentId: t4 })
    const t6 = insertTask(db, storyId, 'dev', 'done', { parentId: t5 })
    const t7 = insertTask(db, storyId, 'sm', 'blocked', { parentId: t6 })
    expect(detectLoop(db, t7)).toBe(true)
  })

  it('returns true when chainLength >= MAX_CHAIN_LENGTH', () => {
    const { db, storyId } = setup()
    const stages = ['sm', 'dev', 'review', 'tester']
    let parentId: number | null = null
    let lastId = 0
    for (let i = 0; i < MAX_CHAIN_LENGTH; i++) {
      const stageName = stages[i % stages.length]!
      const status = i === MAX_CHAIN_LENGTH - 1 ? 'blocked' : 'done'
      lastId = insertTask(db, storyId, stageName, status, { parentId })
      parentId = lastId
    }
    expect(detectLoop(db, lastId)).toBe(true)
  })

  it('does not count superseded tasks toward stage repeat threshold', () => {
    const { db, storyId } = setup()
    // 6 superseded reset cycles of sm+dev = 12 superseded tasks
    let parentId: number | null = null
    for (let i = 0; i < 6; i++) {
      const t1 = insertTask(db, storyId, 'sm', 'done', { parentId, superseded: 1 })
      const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1, superseded: 1 })
      parentId = t2
    }
    // active chain: just one blocked sm task
    const active = insertTask(db, storyId, 'sm', 'blocked', { parentId })
    expect(detectLoop(db, active)).toBe(false)
  })

  it('returns false when task id does not exist in DB', () => {
    const { db } = setup()
    expect(detectLoop(db, 99999)).toBe(false)
  })

  it('handles exactly MAX_STAGE_REPEATS (3) without triggering loop', () => {
    const { db, storyId } = setup()
    // sm appears exactly 3 times — should NOT trigger (threshold is >3)
    const t1 = insertTask(db, storyId, 'sm', 'done')
    const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1 })
    const t3 = insertTask(db, storyId, 'sm', 'done', { parentId: t2 })
    const t4 = insertTask(db, storyId, 'dev', 'done', { parentId: t3 })
    const t5 = insertTask(db, storyId, 'sm', 'blocked', { parentId: t4 })
    // sm appears 3 times total — exactly at limit, not over
    expect(detectLoop(db, t5)).toBe(false)
  })
})

// ─── findFailedAndBlockedIssues ───────────────────────────────────────────────

describe('findFailedAndBlockedIssues', () => {
  it('returns a failed task', () => {
    const { db, storyId } = setup()
    const taskId = insertTask(db, storyId, 'dev', 'failed')
    const issues = findFailedAndBlockedIssues(db)

    expect(issues).toHaveLength(1)
    expect(issues[0]!.type).toBe('failed')
    expect(issues[0]!.taskId).toBe(taskId)
    expect(issues[0]!.stageName).toBe('dev')
    expect(issues[0]!.suggestedAction).toBe('reset_to_queued')
  })

  it('returns a non-loop blocked task', () => {
    const { db, storyId } = setup()
    const taskId = insertTask(db, storyId, 'review', 'blocked')
    const issues = findFailedAndBlockedIssues(db)

    expect(issues).toHaveLength(1)
    expect(issues[0]!.type).toBe('blocked')
    expect(issues[0]!.taskId).toBe(taskId)
  })

  it('excludes superseded=1 failed tasks', () => {
    const { db, storyId } = setup()
    insertTask(db, storyId, 'dev', 'failed', { superseded: 1 })
    expect(findFailedAndBlockedIssues(db)).toHaveLength(0)
  })

  it('excludes superseded=1 blocked tasks', () => {
    const { db, storyId } = setup()
    insertTask(db, storyId, 'dev', 'blocked', { superseded: 1 })
    expect(findFailedAndBlockedIssues(db)).toHaveLength(0)
  })

  it('excludes loop-blocked tasks', () => {
    const { db, storyId } = setup()
    // Build sm→dev loop chain, sm appears 4 times
    const t1 = insertTask(db, storyId, 'sm', 'done')
    const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1 })
    const t3 = insertTask(db, storyId, 'sm', 'done', { parentId: t2 })
    const t4 = insertTask(db, storyId, 'dev', 'done', { parentId: t3 })
    const t5 = insertTask(db, storyId, 'sm', 'done', { parentId: t4 })
    const t6 = insertTask(db, storyId, 'dev', 'done', { parentId: t5 })
    const t7 = insertTask(db, storyId, 'sm', 'blocked', { parentId: t6 })

    const issues = findFailedAndBlockedIssues(db)
    expect(issues.find(i => i.taskId === t7)).toBeUndefined()
  })

  it('returns both failed and non-loop blocked tasks when both exist', () => {
    const { db, storyId } = setup()
    insertTask(db, storyId, 'dev', 'failed')
    insertTask(db, storyId, 'review', 'blocked')
    const issues = findFailedAndBlockedIssues(db)

    expect(issues).toHaveLength(2)
    expect(issues.some(i => i.type === 'failed')).toBe(true)
    expect(issues.some(i => i.type === 'blocked')).toBe(true)
  })

  it('returns empty when no failed or blocked tasks', () => {
    const { db, storyId } = setup()
    insertTask(db, storyId, 'sm', 'done')
    insertTask(db, storyId, 'dev', 'running')
    expect(findFailedAndBlockedIssues(db)).toHaveLength(0)
  })

  it('includes storyTitle from joined stories table', () => {
    const { db } = setup()
    // Create a second story with a distinct title in the same epic
    const projectId = db
      .insert(projects)
      .values({ projectName: 'p2' })
      .returning({ id: projects.id })
      .get()!.id
    const epicId = db
      .insert(epics)
      .values({ projectId, epicKey: '2', title: 'E2', orderIndex: 0 })
      .returning({ id: epics.id })
      .get()!.id
    const storyId2 = db
      .insert(stories)
      .values({ epicId, storyKey: '2.1', title: 'Titled Story', orderIndex: 0 })
      .returning({ id: stories.id })
      .get()!.id
    insertTask(db, storyId2, 'tester', 'failed')

    const issues = findFailedAndBlockedIssues(db)
    const issue = issues.find(i => i.storyTitle === 'Titled Story')
    expect(issue).toBeDefined()
  })
})
