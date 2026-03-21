import { eq, and, inArray } from 'drizzle-orm'

import type { DrizzleDB } from './db/Connection.js'
import { epics, stories, tasks, taskLogs } from './db/schema.js'
import { TraceError } from './Errors.js'
import type { EpicNode, StoryNode, TaskNode, TraceTaskLog, TraceSummary } from './TraceTypes.js'
import { Logger } from '@core/Logger.js'
import type { ITraceService } from './TraceTypes.js'

const logger = Logger.getOrNoop('TraceService')

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '-'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatReworkLabel(stageName: string, attempt: number): string {
  if (attempt <= 1) return ''
  const title = stageName.charAt(0).toUpperCase() + stageName.slice(1)
  return `${title} rework #${attempt - 1}`
}

function statusColor(status: string): string {
  switch (status) {
    case 'done':
      return 'green'
    case 'running':
      return 'yellow'
    case 'failed':
      return 'red'
    case 'queued':
      return 'gray'
    case 'blocked':
      return 'magenta'
    case 'draft':
      return 'gray'
    default:
      return 'white'
  }
}

export class TraceService implements ITraceService {
  constructor(private readonly db: DrizzleDB) {}

  getEpics(projectId: number): EpicNode[] {
    try {
      logger.debug('trace: query', { epicKey: projectId })
      const rows = this.db
        .select({
          id: epics.id,
          epicKey: epics.epicKey,
          title: epics.title,
          status: epics.status,
          orderIndex: epics.orderIndex,
        })
        .from(epics)
        .where(eq(epics.projectId, projectId))
        .orderBy(epics.orderIndex)
        .all()

      if (rows.length === 0) return []

      const epicIds = rows.map(e => e.id)
      const allStories = this.db
        .select({ epicId: stories.epicId, status: stories.status })
        .from(stories)
        .where(inArray(stories.epicId, epicIds))
        .all()

      return rows.map(epic => {
        const epicStories = allStories.filter(s => s.epicId === epic.id)
        const storyCount = epicStories.length
        const doneCount = epicStories.filter(s => s.status === 'done').length
        const completionPct = storyCount === 0 ? 0 : Math.round((doneCount / storyCount) * 100)

        return {
          id: epic.id,
          epicKey: epic.epicKey,
          title: epic.title,
          status: epic.status,
          storyCount,
          completionPct,
          orderIndex: epic.orderIndex,
        }
      })
    } catch (err) {
      logger.error('trace: query failed', { error: String(err) })
      throw new TraceError(`Failed to get epics: ${String(err)}`)
    }
  }

  getStoriesForEpic(epicId: number): StoryNode[] {
    try {
      const rows = this.db
        .select({
          id: stories.id,
          epicId: stories.epicId,
          storyKey: stories.storyKey,
          title: stories.title,
          status: stories.status,
          orderIndex: stories.orderIndex,
        })
        .from(stories)
        .where(eq(stories.epicId, epicId))
        .orderBy(stories.orderIndex)
        .all()

      if (rows.length === 0) return []

      const storyIds = rows.map(s => s.id)
      const allTaskDurations = this.db
        .select({ storyId: tasks.storyId, durationMs: tasks.durationMs })
        .from(tasks)
        .where(and(inArray(tasks.storyId, storyIds), eq(tasks.superseded, 0)))
        .all()

      const durationsByStory = new Map<number, (number | null)[]>()
      for (const t of allTaskDurations) {
        const arr = durationsByStory.get(t.storyId) ?? []
        arr.push(t.durationMs)
        durationsByStory.set(t.storyId, arr)
      }

      return rows.map(story => {
        const taskDurations = durationsByStory.get(story.id) ?? []
        const allNull = taskDurations.every(d => d === null)
        const totalDurationMs =
          taskDurations.length === 0 || allNull
            ? null
            : taskDurations.reduce((sum, d) => (sum ?? 0) + (d ?? 0), 0)

        return {
          id: story.id,
          epicId: story.epicId,
          storyKey: story.storyKey,
          title: story.title,
          status: story.status,
          totalDurationMs,
          orderIndex: story.orderIndex,
        }
      })
    } catch (err) {
      logger.error('trace: query failed', { error: String(err) })
      throw new TraceError(`Failed to get stories: ${String(err)}`)
    }
  }

  getTasksForStory(storyId: number, showSuperseded = false, teamFilter?: string): TaskNode[] {
    try {
      const baseWhere = showSuperseded
        ? eq(tasks.storyId, storyId)
        : and(eq(tasks.storyId, storyId), eq(tasks.superseded, 0));
      const whereClause = teamFilter !== undefined
        ? and(baseWhere, eq(tasks.team, teamFilter))
        : baseWhere;

      const rows = this.db
        .select({
          id: tasks.id,
          storyId: tasks.storyId,
          team: tasks.team,
          stageName: tasks.stageName,
          status: tasks.status,
          attempt: tasks.attempt,
          maxAttempts: tasks.maxAttempts,
          workerModel: tasks.workerModel,
          inputTokens: tasks.inputTokens,
          outputTokens: tasks.outputTokens,
          durationMs: tasks.durationMs,
          startedAt: tasks.startedAt,
          completedAt: tasks.completedAt,
          input: tasks.input,
          output: tasks.output,
          sessionName: tasks.sessionName,
          superseded: tasks.superseded,
        })
        .from(tasks)
        .where(whereClause)
        .orderBy(tasks.id)
        .all()

      return rows.map(task => ({
        id: task.id,
        storyId: task.storyId,
        team: task.team,
        stageName: task.stageName,
        status: task.status,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        reworkLabel: task.attempt > 1 ? formatReworkLabel(task.stageName, task.attempt) : null,
        workerModel: task.workerModel,
        inputTokens: task.inputTokens,
        outputTokens: task.outputTokens,
        durationMs: task.durationMs,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        input: task.input,
        output: task.output,
        sessionName: task.sessionName,
        superseded: task.superseded === 1,
      }))
    } catch (err) {
      logger.error('trace: query failed', { error: String(err) })
      throw new TraceError(`Failed to get tasks: ${String(err)}`)
    }
  }

  getTaskLogs(taskId: number): TraceTaskLog[] {
    try {
      return this.db
        .select({
          id: taskLogs.id,
          taskId: taskLogs.taskId,
          sequence: taskLogs.sequence,
          eventType: taskLogs.eventType,
          eventData: taskLogs.eventData,
          createdAt: taskLogs.createdAt,
        })
        .from(taskLogs)
        .where(eq(taskLogs.taskId, taskId))
        .orderBy(taskLogs.sequence)
        .all()
    } catch (err) {
      logger.error('trace: query failed', { error: String(err) })
      throw new TraceError(`Failed to get task logs: ${String(err)}`)
    }
  }

  replayTask(taskId: number): void {
    try {
      this.db.transaction(() => {
        this.db
          .update(tasks)
          .set({
            status: 'queued',
            attempt: 1,
            startedAt: null,
            completedAt: null,
            durationMs: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(tasks.id, taskId))
          .run()
      })
    } catch (err) {
      throw new TraceError(`Failed to replay task: ${String(err)}`)
    }
  }

  markTaskDone(taskId: number): void {
    try {
      this.db.transaction(() => {
        this.db
          .update(tasks)
          .set({
            status: 'done',
            completedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(tasks.id, taskId))
          .run()
      })
    } catch (err) {
      throw new TraceError(`Failed to mark task as done: ${String(err)}`)
    }
  }

  markStoryDone(storyId: number): void {
    try {
      this.db.transaction(() => {
        const now = new Date().toISOString()
        this.db
          .update(stories)
          .set({
            status: 'done',
            updatedAt: now,
          })
          .where(eq(stories.id, storyId))
          .run()

        this.db
          .update(tasks)
          .set({
            status: 'done',
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(tasks.storyId, storyId))
          .run()
      })
    } catch (err) {
      throw new TraceError(`Failed to mark story as done: ${String(err)}`)
    }
  }

  getSummary(projectId: number): TraceSummary {
    try {
      const epicRows = this.db
        .select({ id: epics.id })
        .from(epics)
        .where(eq(epics.projectId, projectId))
        .all()

      const epicIds = epicRows.map(e => e.id)
      if (epicIds.length === 0) {
        return {
          totalEpics: 0,
          totalStories: 0,
          totalTasks: 0,
          completionRate: 0,
          averageDurationPerStage: [],
        }
      }

      const storyRows = this.db
        .select({ id: stories.id, status: stories.status, epicId: stories.epicId })
        .from(stories)
        .where(inArray(stories.epicId, epicIds))
        .all()

      const totalStories = storyRows.length
      const doneStories = storyRows.filter(s => s.status === 'done').length
      const completionRate = totalStories === 0 ? 0 : Math.round((doneStories / totalStories) * 100)

      const storyIds = storyRows.map(s => s.id)
      const taskRows =
        storyIds.length > 0
          ? this.db
              .select({
                stageName: tasks.stageName,
                durationMs: tasks.durationMs,
                storyId: tasks.storyId,
              })
              .from(tasks)
              .where(and(inArray(tasks.storyId, storyIds), eq(tasks.superseded, 0)))
              .all()
          : []

      const totalTasks = taskRows.length

      const stageMap = new Map<string, number[]>()
      for (const task of taskRows) {
        if (task.durationMs !== null && task.durationMs !== undefined) {
          const arr = stageMap.get(task.stageName) ?? []
          arr.push(task.durationMs)
          stageMap.set(task.stageName, arr)
        }
      }

      const averageDurationPerStage = Array.from(stageMap.entries()).map(
        ([stageName, durations]) => ({
          stageName,
          avgMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
        })
      )

      return {
        totalEpics: epicIds.length,
        totalStories,
        totalTasks,
        completionRate,
        averageDurationPerStage,
      }
    } catch (err) {
      throw new TraceError(`Failed to get summary: ${String(err)}`)
    }
  }

  static formatDuration(ms: number | null): string {
    return formatDuration(ms)
  }

  static formatReworkLabel(stageName: string, attempt: number): string {
    return formatReworkLabel(stageName, attempt)
  }

  static statusColor(status: string): string {
    return statusColor(status)
  }
}
