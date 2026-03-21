import { eq } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { tasks, stories, epics } from '@core/db/schema.js'
import { eventBus } from '@core/EventBus.js'
import type { StageConfig } from '@core/ConfigTypes.js'

import { Router } from './Router.js'
import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('CompletionHandler')

export class CompletionHandler {
  private readonly db: DrizzleDB
  private readonly router: Router
  private readonly stageMap: Map<string, StageConfig>

  constructor(db: DrizzleDB, router: Router, stageMap: Map<string, StageConfig>) {
    this.db = db
    this.router = router
    this.stageMap = stageMap
  }

  handleTaskCompletion(taskId: number, storyId: number, stageName: string): void {
    try {
      const stageConfig = this.stageMap.get(stageName)
      if (!stageConfig) return

      const taskRow = this.db
        .select({
          output: tasks.output,
          attempt: tasks.attempt,
          maxAttempts: tasks.maxAttempts,
          team: tasks.team,
        })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()
      if (!taskRow) return

      const output = taskRow.output
      const isRejection = CompletionHandler.isRejectionOutput(output)

      logger.info(
        `Evaluating task#${taskId} [story#${storyId} stage=${stageName} attempt=${taskRow.attempt}/${taskRow.maxAttempts} isRejection=${isRejection}]`,
        {
          outputPreview: output ?? '(empty)',
        }
      )

      if (isRejection && stageConfig.reject_to) {
        const result = this.router.routeRejectedTask(
          {
            id: taskId,
            storyId,
            output,
            attempt: taskRow.attempt,
            maxAttempts: taskRow.maxAttempts,
            team: taskRow.team,
          },
          stageConfig
        )

        if (result === 'blocked') {
          const storyTitle = this.getStoryTitle(storyId)
          eventBus.emit('task:alert', {
            taskId,
            storyId,
            storyTitle,
            stageName,
            issues: CompletionHandler.parseIssues(output),
            routedTo: undefined,
            attempt: taskRow.attempt,
            maxAttempts: taskRow.maxAttempts,
            isBlocked: true,
          })
          eventBus.emit('task:rejected', {
            taskId,
            storyId,
            stageName,
            status: 'rejected',
            attempt: taskRow.attempt,
          })
          this.blockStoryAndTask(storyId, taskId, 'MAX_ATTEMPTS_EXCEEDED')
        } else {
          const storyTitle = this.getStoryTitle(storyId)
          eventBus.emit('task:alert', {
            taskId,
            storyId,
            storyTitle,
            stageName,
            issues: CompletionHandler.parseIssues(output),
            routedTo: stageConfig.reject_to,
            attempt: taskRow.attempt,
            maxAttempts: taskRow.maxAttempts,
            isBlocked: false,
          })
          eventBus.emit('task:routed', {
            taskId,
            storyId,
            stageName: stageConfig.reject_to,
            status: 'routed',
            attempt: taskRow.attempt + 1,
          })
        }
        return
      }

      if (!stageConfig.next) {
        const storyInfo = this.getStoryInfo(storyId)
        this.router.completeStory({ id: taskId, storyId }, storyInfo.storyKey, storyInfo.epicKey)
        return
      }

      const loopInfo = this.router.detectLoop(taskId)
      if (loopInfo.isLoop) {
        const storyTitle = this.getStoryTitle(storyId)
        eventBus.emit('task:alert', {
          taskId,
          storyId,
          storyTitle,
          stageName,
          issues: CompletionHandler.parseIssues(output),
          routedTo: undefined,
          attempt: taskRow.attempt,
          maxAttempts: taskRow.maxAttempts,
          isBlocked: true,
        })
        this.blockStoryAndTask(storyId, taskId, 'LOOP_DETECTED')
        return
      }

      this.router.routeCompletedTask(
        {
          id: taskId,
          storyId,
          output,
          attempt: taskRow.attempt,
          maxAttempts: taskRow.maxAttempts,
          team: taskRow.team,
        },
        stageConfig
      )

      eventBus.emit('task:routed', {
        taskId,
        storyId,
        stageName: stageConfig.next,
        status: 'routed',
      })

      logger.info(`Routing task#${taskId}: ${stageName} → ${stageConfig.next} [story#${storyId}]`)
    } catch (err: unknown) {
      logger.error(
        `Completion handler failed task#${taskId} [story#${storyId} stage=${stageName}]`,
        { error: err instanceof Error ? err.message : String(err) }
      )
    }
  }

  static isRejectionOutput(output: string | null): boolean {
    if (!output) return false
    try {
      const parsed: unknown = JSON.parse(output)
      if (typeof parsed !== 'object' || parsed === null) return false
      // Check `verdict` field (reviewer/tester output schemas)
      if ('verdict' in parsed) {
        const verdict = (parsed as { verdict: unknown }).verdict
        if (
          typeof verdict === 'string' &&
          (verdict === 'CHANGES_REQUESTED' || verdict === 'FAILED')
        )
          return true
      }
      // Check `result` field (legacy / alternative schema)
      if ('result' in parsed) {
        const result = (parsed as { result: unknown }).result
        if (typeof result === 'string' && (result === 'CHANGES_REQUESTED' || result === 'FAILED'))
          return true
      }
      // Check `status` field (dev output schema: BLOCKED = rejection)
      if ('status' in parsed) {
        const status = (parsed as { status: unknown }).status
        if (typeof status === 'string' && status === 'BLOCKED') return true
      }
      return false
    } catch {
      return false
    }
  }

  static parseIssues(output: string | null): string[] {
    if (!output) return []
    try {
      const parsed: unknown = JSON.parse(output)
      if (typeof parsed !== 'object' || parsed === null) return []
      return (parsed as { issues?: string[] }).issues ?? []
    } catch {
      return []
    }
  }

  private getStoryTitle(storyId: number): string {
    const story = this.db
      .select({ title: stories.title })
      .from(stories)
      .where(eq(stories.id, storyId))
      .get()
    return story?.title ?? 'unknown'
  }

  private getStoryInfo(storyId: number): { storyKey: string; epicKey: string } {
    const story = this.db
      .select({ storyKey: stories.storyKey, epicId: stories.epicId })
      .from(stories)
      .where(eq(stories.id, storyId))
      .get()

    if (!story) return { storyKey: 'unknown', epicKey: 'unknown' }

    const epic = this.db
      .select({ epicKey: epics.epicKey })
      .from(epics)
      .where(eq(epics.id, story.epicId))
      .get()

    return {
      storyKey: story.storyKey,
      epicKey: epic?.epicKey ?? 'unknown',
    }
  }

  private blockStoryAndTask(storyId: number, taskId: number, reason: string): void {
    const now = new Date().toISOString()
    this.db.transaction(tx => {
      tx.update(tasks).set({ status: 'blocked', updatedAt: now }).where(eq(tasks.id, taskId)).run()
      tx.update(stories)
        .set({ status: 'blocked', updatedAt: now })
        .where(eq(stories.id, storyId))
        .run()
    })

    const storyInfo = this.getStoryInfo(storyId)
    eventBus.emit('story:blocked', {
      storyId,
      storyKey: storyInfo.storyKey,
      epicKey: storyInfo.epicKey,
      taskId,
      reason,
    })
  }
}
