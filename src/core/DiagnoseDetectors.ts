import { eq, and, inArray } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { tasks, stories } from '@core/db/schema.js'
import { MAX_CHAIN_LENGTH } from '@config/defaults.js'

import type { DiagnoseIssue } from './DiagnoseTypes.js'

const MAX_STAGE_REPEATS = 3

export function detectLoop(db: DrizzleDB, taskId: number): boolean {
  const stageCounts: Record<string, number> = {}
  let currentId: number | null | undefined = taskId
  // chainLength counts only non-superseded tasks for MAX_CHAIN_LENGTH business check
  let chainLength = 0
  // iterations is a raw traversal counter used as safety guard to prevent infinite loops
  let iterations = 0

  while (currentId != null && iterations < MAX_CHAIN_LENGTH * 10) {
    const task = db
      .select({ id: tasks.id, parentId: tasks.parentId, stageName: tasks.stageName, superseded: tasks.superseded })
      .from(tasks)
      .where(eq(tasks.id, currentId))
      .get()

    if (!task) break

    if (task.superseded === 0) {
      stageCounts[task.stageName] = (stageCounts[task.stageName] ?? 0) + 1
      if ((stageCounts[task.stageName] ?? 0) > MAX_STAGE_REPEATS) return true
      chainLength++
    }

    currentId = task.parentId
    iterations++
  }

  if (chainLength >= MAX_CHAIN_LENGTH) return true

  return false
}

export function findFailedAndBlockedIssues(db: DrizzleDB): DiagnoseIssue[] {
  const rows = db
    .select({
      taskId: tasks.id,
      storyId: tasks.storyId,
      storyTitle: stories.title,
      stageName: tasks.stageName,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .innerJoin(stories, eq(tasks.storyId, stories.id))
    .where(and(inArray(tasks.status, ['failed', 'blocked']), eq(tasks.superseded, 0)))
    .all()

  const issues: DiagnoseIssue[] = []

  for (const row of rows) {
    // Skip blocked tasks that are loop-blocked — already reported by findLoopBlockedIssues
    if (row.status === 'blocked' && detectLoop(db, row.taskId)) continue

    const elapsedMs = Date.now() - new Date(row.updatedAt ?? row.createdAt).getTime()
    issues.push({
      taskId: row.taskId,
      storyId: row.storyId,
      storyTitle: row.storyTitle,
      stageName: row.stageName,
      status: row.status,
      elapsedMs,
      // safe: query filters inArray(tasks.status, ['failed','blocked']) above
      type: row.status as 'failed' | 'blocked',
      suggestedAction: 'reset_to_queued',
    })
  }

  return issues
}
