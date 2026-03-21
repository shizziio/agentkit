import { eq, and, desc } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { tasks } from '@core/db/schema.js'

interface ChainEntry {
  stage: string
  taskId: number
  output: string
}

/**
 * Query by storyId to collect the latest output from each stage.
 * This approach never misses stages (unlike parentId walking which
 * can be cut short by MAX_CHAIN_LENGTH or broken parent chains).
 *
 * Used by Router (forward/reject routing), ResetService (pushNextStage),
 * and DiagnoseService (rerouteGap, rerouteLoopBlocked).
 */
export function buildChainInput(
  db: DrizzleDB,
  currentTaskId: number,
  currentOutput: string | null,
  currentStage: string
): string | null {
  // Get storyId from current task
  const currentTask = db
    .select({ storyId: tasks.storyId })
    .from(tasks)
    .where(eq(tasks.id, currentTaskId))
    .get()
  if (!currentTask) return currentOutput

  // Query all non-superseded tasks with output for this story, newest first
  const storyTasks = db
    .select({
      id: tasks.id,
      stageName: tasks.stageName,
      output: tasks.output,
    })
    .from(tasks)
    .where(and(eq(tasks.storyId, currentTask.storyId), eq(tasks.superseded, 0)))
    .orderBy(desc(tasks.id))
    .all()

  // Collect latest output per stage (first seen = newest due to desc order)
  const seen = new Set<string>()
  const entries: ChainEntry[] = []

  for (const t of storyTasks) {
    if (seen.has(t.stageName) || !t.output) continue
    seen.add(t.stageName)
    entries.push({ stage: t.stageName, taskId: t.id, output: t.output })
  }

  // Override current stage with the output we just produced
  if (currentOutput) {
    const existingIdx = entries.findIndex(e => e.stage === currentStage)
    const entry: ChainEntry = { stage: currentStage, taskId: currentTaskId, output: currentOutput }
    if (existingIdx >= 0) {
      entries[existingIdx] = entry
    } else {
      entries.push(entry)
    }
  }

  // Sort by taskId ascending so chain reads chronologically (sm → tester → review → dev)
  entries.sort((a, b) => a.taskId - b.taskId)

  // If only one entry, return raw output for backward compat (single-stage chains)
  if (entries.length <= 1) {
    return currentOutput
  }

  return JSON.stringify({ chain: entries })
}
