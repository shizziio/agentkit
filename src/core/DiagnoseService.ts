import { eq, and, sql } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { tasks, stories } from '@core/db/schema.js'
import type { PipelineConfig, StageConfig } from '@core/ConfigTypes.js'
import { Logger } from '@core/Logger.js'
import type { DiagnoseIssue, DiagnoseResult, AutoFixResult, IDiagnoseService } from './DiagnoseTypes.js'
import { detectLoop, findFailedAndBlockedIssues as queryFailedAndBlocked } from './DiagnoseDetectors.js'
import { buildChainInput } from '@shared/ChainInputBuilder.js'

const logger = Logger.getOrNoop('DiagnoseService')

const DEFAULT_STAGE_TIMEOUT_MS = 300_000 // 5 minutes fallback

export class DiagnoseService implements IDiagnoseService {
  private readonly db: DrizzleDB

  private readonly pipelineConfig: PipelineConfig
  private readonly stageTimeoutMap: Map<string, number>

  constructor(db: DrizzleDB, pipelineConfig: PipelineConfig) {
    this.db = db
    this.pipelineConfig = pipelineConfig
    this.stageTimeoutMap = new Map(pipelineConfig.stages.map(s => [s.name, s.timeout * 1000]))
  }

  private buildStageMap(): Record<string, StageConfig> {
    const map: Record<string, StageConfig> = {}
    for (const stage of this.pipelineConfig.stages) {
      map[stage.name] = stage
    }
    return map
  }

  findRunningIssues(): DiagnoseIssue[] {
    const rows = this.db
      .select({
        taskId: tasks.id,
        storyId: tasks.storyId,
        storyTitle: stories.title,
        stageName: tasks.stageName,
        status: tasks.status,
        startedAt: tasks.startedAt,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .where(and(eq(tasks.status, 'running'), eq(tasks.superseded, 0)))
      .all()

    const issues: DiagnoseIssue[] = rows.map(row => {
      const startTime = row.startedAt ?? row.createdAt
      const elapsedMs = Date.now() - new Date(startTime).getTime()
      const stageTimeout = this.stageTimeoutMap.get(row.stageName) ?? DEFAULT_STAGE_TIMEOUT_MS

      const isStuck = elapsedMs > 2 * stageTimeout
      return {
        taskId: row.taskId,
        storyId: row.storyId,
        storyTitle: row.storyTitle,
        stageName: row.stageName,
        status: row.status,
        elapsedMs,
        type: isStuck ? ('stuck' as const) : ('orphaned' as const),
        suggestedAction: 'reset_to_queued',
      }
    })

    return issues.sort((a, b) => b.elapsedMs - a.elapsedMs)
  }

  findQueueGapIssues(): DiagnoseIssue[] {
    const rows = this.db
      .select({
        taskId: tasks.id,
        storyId: tasks.storyId,
        storyTitle: stories.title,
        stageName: tasks.stageName,
        status: tasks.status,
        output: tasks.output,
        durationMs: tasks.durationMs,
        createdAt: tasks.createdAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .where(and(eq(tasks.status, 'done'), eq(tasks.superseded, 0)))
      .all()

    const stageMap = this.buildStageMap()
    const issues: DiagnoseIssue[] = []
    // Deduplicate: only one gap report per (storyId, nextStage) pair
    const processedPairs = new Set<string>()

    for (const row of rows) {
      const nextStage = stageMap[row.stageName]?.next
      if (!nextStage) continue

      const pairKey = `${row.storyId}:${nextStage}`
      if (processedPairs.has(pairKey)) continue
      processedPairs.add(pairKey)

      const existingNextTask = this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.storyId, row.storyId), eq(tasks.stageName, nextStage), eq(tasks.superseded, 0)))
        .get()

      if (!existingNextTask) {
        issues.push({
          taskId: row.taskId,
          storyId: row.storyId,
          storyTitle: row.storyTitle,
          stageName: row.stageName,
          status: row.status,
          elapsedMs: row.durationMs ?? 0,
          type: 'queue_gap',
          suggestedAction: 'reroute',
          gapNextStage: nextStage,
          completedOutput: row.output,
        })
      }
    }

    return issues
  }

  findLoopBlockedIssues(): DiagnoseIssue[] {
    const rows = this.db
      .select({
        taskId: tasks.id,
        storyId: tasks.storyId,
        storyTitle: stories.title,
        stageName: tasks.stageName,
        status: tasks.status,
        output: tasks.output,
        updatedAt: tasks.updatedAt,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .where(and(eq(tasks.status, 'blocked'), eq(tasks.superseded, 0)))
      .all()

    const stageMap = this.buildStageMap()
    const issues: DiagnoseIssue[] = []

    for (const row of rows) {
      if (detectLoop(this.db, row.taskId)) {
        const elapsed = Date.now() - new Date(row.updatedAt ?? row.createdAt).getTime()
        const nextStage = stageMap[row.stageName]?.next
        issues.push({
          taskId: row.taskId,
          storyId: row.storyId,
          storyTitle: row.storyTitle,
          stageName: row.stageName,
          status: row.status,
          elapsedMs: elapsed,
          type: 'loop_blocked',
          suggestedAction: nextStage ? 'reroute' : 'ignore',
          gapNextStage: nextStage,
          completedOutput: row.output,
        })
      }
    }

    return issues
  }

  findFailedAndBlockedIssues(): DiagnoseIssue[] {
    return queryFailedAndBlocked(this.db)
  }

  diagnose(): DiagnoseResult {
    try {
      const runningIssues = this.findRunningIssues()
      const queueGapIssues = this.findQueueGapIssues()
      const loopBlockedIssues = this.findLoopBlockedIssues()
      const failedBlockedIssues = this.findFailedAndBlockedIssues()

      const issues = [...runningIssues, ...queueGapIssues, ...loopBlockedIssues, ...failedBlockedIssues]

      const summary = {
        stuckCount: runningIssues.filter(i => i.type === 'stuck').length,
        orphanedCount: runningIssues.filter(i => i.type === 'orphaned').length,
        queueGapCount: queueGapIssues.length,
        loopBlockedCount: loopBlockedIssues.length,
        failedCount: failedBlockedIssues.filter(i => i.type === 'failed').length,
        blockedCount: failedBlockedIssues.filter(i => i.type === 'blocked').length,
      }

      logger.debug('diagnose: run complete', { issueCount: issues.length })

      if (summary.stuckCount > 0) {
        logger.warn('diagnose: stuck tasks detected', { count: summary.stuckCount })
      }
      if (summary.orphanedCount > 0) {
        logger.debug('diagnose: tasks actively running', { count: summary.orphanedCount })
      }
      if (summary.failedCount > 0) {
        logger.warn('diagnose: failed tasks detected', { count: summary.failedCount })
      }
      if (summary.blockedCount > 0) {
        logger.warn('diagnose: blocked tasks detected', { count: summary.blockedCount })
      }

      for (const i of issues) {
        logger.debug('diagnose: issue found', { type: i.type, taskId: i.taskId })
      }

      return { issues, summary }
    } catch (err: unknown) {
      logger.error('diagnose: run failed', { error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  /**
   * Reset a task to queued status.
   * Note: if agentkit run is active, the worker may race with this reset;
   * the next dequeue cycle will pick up the reset task safely.
   */
  resetTask(taskId: number): void {
    const now = new Date().toISOString()
    this.db.transaction(tx => {
      tx.update(tasks)
        .set({
          status: 'queued',
          startedAt: null,
          updatedAt: now,
          version: sql`${tasks.version} + 1`,
        })
        .where(eq(tasks.id, taskId))
        .run()
    })
  }

  rerouteGap(issue: DiagnoseIssue): void {
    const nextStage = issue.gapNextStage
    if (!nextStage) return

    const chainInput = buildChainInput(this.db, issue.taskId, issue.completedOutput ?? null, issue.stageName)

    this.db.transaction(tx => {
      tx.insert(tasks)
        .values({
          storyId: issue.storyId,
          parentId: issue.taskId,
          stageName: nextStage,
          status: 'queued',
          input: chainInput,
          attempt: 1,
          maxAttempts: 3,
          team: this.pipelineConfig.team,
        })
        .run()
    })
  }

  rerouteLoopBlocked(issue: DiagnoseIssue): void {
    const nextStage = issue.gapNextStage
    if (!nextStage) return

    const chainInput = buildChainInput(this.db, issue.taskId, issue.completedOutput ?? null, issue.stageName)
    const now = new Date().toISOString()
    this.db.transaction(tx => {
      tx.insert(tasks)
        .values({
          storyId: issue.storyId,
          parentId: issue.taskId,
          stageName: nextStage,
          status: 'queued',
          input: chainInput,
          attempt: 1,
          maxAttempts: 3,
          team: this.pipelineConfig.team,
        })
        .run()

      tx.update(stories)
        .set({ status: 'queued', updatedAt: now })
        .where(eq(stories.id, issue.storyId))
        .run()
    })
  }

  skipTask(taskId: number): void {
    const now = new Date().toISOString()
    this.db.transaction(tx => {
      const taskRow = tx
        .select({ storyId: tasks.storyId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()

      if (!taskRow) return

      tx.update(tasks)
        .set({
          status: 'blocked',
          updatedAt: now,
          version: sql`${tasks.version} + 1`,
        })
        .where(eq(tasks.id, taskId))
        .run()

      tx.update(stories)
        .set({ status: 'blocked', updatedAt: now })
        .where(eq(stories.id, taskRow.storyId))
        .run()
    })
  }

  autoFix(result: DiagnoseResult): AutoFixResult {
    let resetCount = 0
    let reroutedCount = 0
    let skippedCount = 0
    let markedDoneCount = 0

    for (const issue of result.issues) {
      if (issue.type === 'stuck' || issue.type === 'orphaned' || issue.type === 'failed' || issue.type === 'blocked') {
        this.resetTask(issue.taskId)
        resetCount++
      } else if (issue.type === 'queue_gap') {
        this.rerouteGap(issue)
        reroutedCount++
      }
      // loop_blocked: no action in autoFix
    }

    return { resetCount, reroutedCount, skippedCount, markedDoneCount }
  }

  markTaskDone(taskId: number): void {
    const now = new Date().toISOString()
    this.db.transaction(tx => {
      const taskRow = tx
        .select({ storyId: tasks.storyId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()

      if (!taskRow) return

      tx.update(tasks)
        .set({
          status: 'done',
          output: 'Resolved manually via Diagnosis',
          durationMs: 0,
          completedAt: now,
          updatedAt: now,
          version: sql`${tasks.version} + 1`,
        })
        .where(eq(tasks.id, taskId))
        .run()
    })
  }

}
