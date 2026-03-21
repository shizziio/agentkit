import { eq, asc } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { tasks, stories, epics, taskLogs } from '@core/db/schema.js'
import { InspectError } from '@core/Errors.js'
import { MAX_CHAIN_LENGTH } from '@config/defaults.js'
import type {
  TaskInspectData,
  AncestorEntry,
  ChildEntry,
  InspectEventLogEntry,
} from '@core/InspectTypes.js'
import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('InspectService')

export class InspectService {
  constructor(private readonly db: DrizzleDB) {}

  getTaskInspect(taskId: number): TaskInspectData {
    try {
    logger.debug('inspect: query', { taskId })
    // Query task JOIN story JOIN epic
    const rows = this.db
      .select({
        task: tasks,
        story: stories,
        epic: epics,
      })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(eq(tasks.id, taskId))
      .all()

    if (rows.length === 0) {
      throw new InspectError(`Task ${taskId} not found`)
    }

    const row = rows[0]
    if (!row) {
      throw new InspectError(`Task ${taskId} not found`)
    }
    const task = row.task
    const story = row.story
    const epic = row.epic

    // Walk parent_id chain upward
    const ancestors: AncestorEntry[] = []
    let chainTruncated = false
    let currentParentId = task.parentId

    while (currentParentId !== null && currentParentId !== undefined) {
      if (ancestors.length >= MAX_CHAIN_LENGTH) {
        chainTruncated = true
        break
      }

      const parentRows = this.db
        .select({
          id: tasks.id,
          stageName: tasks.stageName,
          status: tasks.status,
          attempt: tasks.attempt,
          durationMs: tasks.durationMs,
          parentId: tasks.parentId,
        })
        .from(tasks)
        .where(eq(tasks.id, currentParentId))
        .all()

      if (parentRows.length === 0) break

      const parent = parentRows[0]
      if (!parent) break
      ancestors.unshift({
        id: parent.id,
        stageName: parent.stageName,
        status: parent.status,
        attempt: parent.attempt,
        durationMs: parent.durationMs,
      })

      currentParentId = parent.parentId
    }

    // Query direct children
    const childRows = this.db
      .select({
        id: tasks.id,
        stageName: tasks.stageName,
        status: tasks.status,
        attempt: tasks.attempt,
        durationMs: tasks.durationMs,
      })
      .from(tasks)
      .where(eq(tasks.parentId, taskId))
      .all()

    const children: ChildEntry[] = childRows.map(c => ({
      id: c.id,
      stageName: c.stageName,
      status: c.status,
      attempt: c.attempt,
      durationMs: c.durationMs,
    }))

    // Query task_logs
    const logRows = this.db
      .select({
        sequence: taskLogs.sequence,
        eventType: taskLogs.eventType,
        eventData: taskLogs.eventData,
      })
      .from(taskLogs)
      .where(eq(taskLogs.taskId, taskId))
      .orderBy(asc(taskLogs.sequence))
      .all()

    const eventLog: InspectEventLogEntry[] = logRows.map(l => ({
      sequence: l.sequence,
      eventType: l.eventType,
      eventData: l.eventData,
    }))

    return {
      task: {
        id: task.id,
        stageName: task.stageName,
        status: task.status,
        workerModel: task.workerModel,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        durationMs: task.durationMs,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        inputTokens: task.inputTokens,
        outputTokens: task.outputTokens,
        prompt: task.prompt,
        input: task.input,
        output: task.output,
      },
      story: {
        id: story.id,
        storyKey: story.storyKey,
        title: story.title,
        status: story.status,
      },
      epic: {
        id: epic.id,
        epicKey: epic.epicKey,
        title: epic.title,
      },
      ancestors,
      children,
      eventLog,
      chainTruncated,
    }
    } catch (err: unknown) {
      logger.error('inspect: query failed', { taskId, error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }
}
