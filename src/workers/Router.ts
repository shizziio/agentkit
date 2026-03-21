import { eq, and, ne, sql } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { tasks, stories, epics } from '@core/db/schema.js'
import { eventBus } from '@core/EventBus.js'
import { StateManager } from '@core/StateManager.js'
import { MAX_CHAIN_LENGTH } from '@config/defaults.js'
import type { StageConfig } from '@core/ConfigTypes.js'
import { Logger } from '@core/Logger.js'

import type { TaskChainInfo } from './PipelineTypes.js'
import { buildChainInput } from '@shared/ChainInputBuilder.js'
import { parseSessionInfo } from './SessionManager.js'

const logger = Logger.getOrNoop('Router')

const MAX_STAGE_REPEATS = 5

export class Router {
  private readonly db: DrizzleDB
  private stateManager: StateManager
  private stageMap: Map<string, StageConfig>

  constructor(db: DrizzleDB, activeTeam: string, stageConfigs?: StageConfig[]) {
    this.db = db
    this.stateManager = new StateManager(db, activeTeam)
    this.stageMap = new Map()
    if (stageConfigs) {
      for (const sc of stageConfigs) {
        this.stageMap.set(sc.name, sc)
      }
    }
  }

  routeCompletedTask(
    task: {
      id: number
      storyId: number
      output: string | null
      attempt: number
      maxAttempts: number
      team: string
    },
    stageConfig: StageConfig
  ): void {
    try {
      const nextStage = stageConfig.next
      if (!nextStage) return

      // Check if the next stage has deps that need to be met
      const nextStageConfig = this.stageMap.get(nextStage)
      const nextSkipDeps = nextStageConfig?.skipDeps ?? false
      const nextSkipDepsLevel = nextStageConfig?.skipDepsLevel ?? 'epic'

      if (!nextSkipDeps) {
        const blocked = this.checkStageDeps(task.storyId, nextSkipDepsLevel)
        if (blocked) {
          // Deps not met — set story to waiting at this stage
          const now = new Date().toISOString()
          this.db.transaction(tx => {
            tx.update(tasks).set({ status: 'done', updatedAt: now }).where(eq(tasks.id, task.id)).run()
            tx.update(stories)
              .set({
                status: 'waiting',
                waitingStage: nextStage,
                updatedAt: now,
                version: sql`${stories.version} + 1`,
              })
              .where(eq(stories.id, task.storyId))
              .run()
            this.persistSessionInfo(tx, task.storyId, task.id, stageConfig.name)
          })
          logger.info(`Story#${task.storyId} waiting for deps before stage ${nextStage} [${nextSkipDepsLevel}-level]`)
          return
        }
      }

      const chainInput = buildChainInput(this.db, task.id, task.output, stageConfig.name)

      this.db.transaction(tx => {
        const now = new Date().toISOString()
        tx.update(tasks).set({ status: 'done', updatedAt: now }).where(eq(tasks.id, task.id)).run()

        tx.insert(tasks)
          .values({
            storyId: task.storyId,
            parentId: task.id,
            stageName: nextStage,
            status: 'queued',
            input: chainInput,
            attempt: 1,
            maxAttempts: task.maxAttempts,
            team: task.team,
          })
          .run()

        tx.update(stories)
          .set({
            priority: sql`${stories.priority} + 1`,
            updatedAt: now,
          })
          .where(eq(stories.id, task.storyId))
          .run()

        this.persistSessionInfo(tx, task.storyId, task.id, stageConfig.name)
      })

      logger.info(`Routed task#${task.id}: ${stageConfig.name} → ${nextStage} [story#${task.storyId} outputLen=${task.output?.length ?? 0}]`)
    } catch (err: unknown) {
      logger.error(`Routing failed task#${task.id} [story#${task.storyId}]`, { error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  routeRejectedTask(
    task: {
      id: number
      storyId: number
      output: string | null
      attempt: number
      maxAttempts: number
      team: string
    },
    stageConfig: StageConfig
  ): 'routed' | 'blocked' {
    try {
      const rejectTo = stageConfig.reject_to
      if (!rejectTo) {
        logger.warn(`No reject_to route for task#${task.id} [stage=${stageConfig.name}] — will block`)
        return 'blocked'
      }

      if (task.attempt >= task.maxAttempts) {
        // Task and story blocking handled atomically by CompletionHandler.blockStoryAndTask
        return 'blocked'
      }

      const chainInput = buildChainInput(this.db, task.id, task.output, stageConfig.name)

      this.db.transaction(tx => {
        const now = new Date().toISOString()
        tx.update(tasks)
          .set({ status: 'rejected', updatedAt: now })
          .where(eq(tasks.id, task.id))
          .run()

        tx.insert(tasks)
          .values({
            storyId: task.storyId,
            parentId: task.id,
            stageName: rejectTo,
            status: 'queued',
            input: chainInput,
            attempt: task.attempt + 1,
            maxAttempts: task.maxAttempts,
            team: task.team,
          })
          .run()

        // Persist session name from rejected task so future re-entry can resume
        this.persistSessionInfo(tx, task.storyId, task.id, stageConfig.name)
      })

      logger.info(`Rejected task#${task.id}: ${stageConfig.name} → ${rejectTo} [story#${task.storyId} attempt=${task.attempt + 1}/${task.maxAttempts}]`)
      return 'routed'
    } catch (err: unknown) {
      logger.error(`Routing failed task#${task.id} [story#${task.storyId}]`, { error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  /**
   * Check if stage-level deps are met for a story.
   * Returns true if BLOCKED (deps not met), false if clear to proceed.
   */
  private checkStageDeps(storyId: number, skipDepsLevel: 'epic' | 'story'): boolean {
    const storyRow = this.db
      .select({ epicId: stories.epicId, dependsOn: stories.dependsOn })
      .from(stories)
      .where(eq(stories.id, storyId))
      .get()
    if (!storyRow) return false

    if (skipDepsLevel === 'story') {
      // Check story-level deps within same epic
      if (!storyRow.dependsOn) return false
      let deps: string[] = []
      try {
        const parsed = JSON.parse(storyRow.dependsOn) as unknown
        if (Array.isArray(parsed)) deps = parsed as string[]
      } catch { return false }
      if (deps.length === 0) return false

      const epicStories = this.db
        .select({ storyKey: stories.storyKey, status: stories.status })
        .from(stories)
        .where(eq(stories.epicId, storyRow.epicId))
        .all()
      const statusMap = new Map(epicStories.map(s => [s.storyKey, s.status]))
      return deps.some(dep => statusMap.get(dep) !== 'done')
    }

    // skipDepsLevel === 'epic' — check epic-level deps
    const epic = this.db
      .select({ dependsOn: epics.dependsOn, projectId: epics.projectId })
      .from(epics)
      .where(eq(epics.id, storyRow.epicId))
      .get()
    if (!epic?.dependsOn) return false

    let epicDeps: string[] = []
    try {
      const parsed = JSON.parse(epic.dependsOn) as unknown
      if (Array.isArray(parsed)) epicDeps = parsed as string[]
    } catch { return false }
    if (epicDeps.length === 0) return false

    const projectEpics = this.db
      .select({ epicKey: epics.epicKey, status: epics.status })
      .from(epics)
      .where(eq(epics.projectId, epic.projectId))
      .all()
    const epicStatusMap = new Map(projectEpics.map(e => [e.epicKey, e.status]))
    return epicDeps.some(dep => epicStatusMap.get(dep) !== 'done')
  }

  /**
   * Persist the session name from a completed task into the story's session_info JSON.
   * Called within the same transaction as task routing for atomicity.
   */
  private persistSessionInfo(
    tx: Parameters<Parameters<DrizzleDB['transaction']>[0]>[0],
    storyId: number,
    taskId: number,
    stageName: string,
  ): void {
    // Get session name from the task
    const task = tx
      .select({ sessionName: tasks.sessionName })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get()

    if (!task?.sessionName) return

    // Read current session_info
    const story = tx
      .select({ sessionInfo: stories.sessionInfo })
      .from(stories)
      .where(eq(stories.id, storyId))
      .get()

    const info = parseSessionInfo(story?.sessionInfo ?? null)
    info[stageName] = task.sessionName

    tx.update(stories)
      .set({
        sessionInfo: JSON.stringify(info),
        updatedAt: sql`strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
      })
      .where(eq(stories.id, storyId))
      .run()
  }

  detectLoop(taskId: number): TaskChainInfo {
    const chain = this.stateManager.getTaskChain(taskId)
    // Exclude superseded tasks (manual resets) AND rejected tasks (normal rejection cycles).
    // Rejected tasks are part of the retry mechanism, not a forward-progress loop.
    // Loop detection should only fire when the same stage appears multiple times
    // in the approved/completed forward path (e.g. a config cycle: A.next→B, B.next→A).
    // Only count forward-progress tasks (done/running). Rejected tasks are normal retry
    // cycle artifacts and should not contribute to loop detection — otherwise a story that
    // goes through many reject→redo cycles would be falsely blocked even on final approval.
    const forwardChain = chain.filter(
      item => !item.superseded && (item.status === 'done' || item.status === 'running')
    )
    const stageCounts: Record<string, number> = {}

    for (const item of forwardChain) {
      stageCounts[item.stageName] = (stageCounts[item.stageName] ?? 0) + 1
    }

    if (forwardChain.length >= MAX_CHAIN_LENGTH) {
      const info = {
        chainLength: chain.length,
        stageCounts,
        isLoop: true,
        reason: `Forward chain length ${forwardChain.length} >= MAX_CHAIN_LENGTH (${MAX_CHAIN_LENGTH})`,
      }
      logger.warn(`Loop detected task#${taskId}: forward chain=${forwardChain.length} >= MAX(${MAX_CHAIN_LENGTH})`, { stageCounts })
      return info
    }

    for (const [stage, count] of Object.entries(stageCounts)) {
      if (count > MAX_STAGE_REPEATS) {
        const info = {
          chainLength: chain.length,
          stageCounts,
          isLoop: true,
          reason: `Stage "${stage}" appears ${count} times in forward chain (> ${MAX_STAGE_REPEATS})`,
        }
        logger.warn(`Loop detected task#${taskId}: stage '${stage}' repeated ${count}x in forward chain > MAX(${MAX_STAGE_REPEATS})`, { stageCounts })
        return info
      }
    }

    return { chainLength: chain.length, stageCounts, isLoop: false }
  }

  completeStory(task: { id: number; storyId: number }, storyKey: string, epicKey: string): void {
    const now = new Date().toISOString()

    this.db.transaction(tx => {
      tx.update(tasks).set({ status: 'done', updatedAt: now }).where(eq(tasks.id, task.id)).run()

      tx.update(stories)
        .set({ status: 'done', updatedAt: now })
        .where(eq(stories.id, task.storyId))
        .run()
    })

    // Query after transaction for accurate data
    const storyRow = this.db
      .select({ title: stories.title })
      .from(stories)
      .where(eq(stories.id, task.storyId))
      .get()
    const storyTitle = storyRow?.title ?? storyKey

    const allTasks = this.db
      .select({
        stageName: tasks.stageName,
        durationMs: tasks.durationMs,
        status: tasks.status,
        superseded: tasks.superseded,
      })
      .from(tasks)
      .where(eq(tasks.storyId, task.storyId))
      .all()

    const relevantTasks = allTasks.filter(
      t => (t.status === 'done' || t.status === 'rejected') && t.superseded === 0
    )

    const stageMap = new Map<string, number>()
    let totalDurationMs = 0
    const totalAttempts = relevantTasks.length

    for (const t of relevantTasks) {
      const dur = t.durationMs ?? 0
      stageMap.set(t.stageName, (stageMap.get(t.stageName) ?? 0) + dur)
      totalDurationMs += dur
    }

    const stageDurations = Array.from(stageMap.entries()).map(([stageName, durationMs]) => ({
      stageName,
      durationMs,
    }))

    eventBus.emit('story:completed', {
      storyId: task.storyId,
      storyKey,
      epicKey,
      durationMs: totalDurationMs,
      storyTitle,
      stageDurations,
      totalAttempts,
    })

    // Auto-mark epic as done if all its stories are now done
    this.tryAutoCompleteEpic(task.storyId, epicKey)
  }

  /**
   * Check if all stories in the epic are done. If so, auto-mark epic as done
   * and emit epic:done event to trigger DependencyResolver for downstream epics.
   */
  private tryAutoCompleteEpic(storyId: number, epicKey: string): void {
    try {
      const story = this.db
        .select({ epicId: stories.epicId })
        .from(stories)
        .where(eq(stories.id, storyId))
        .get()
      if (!story) return

      const undone = this.db
        .select({ id: stories.id })
        .from(stories)
        .where(and(eq(stories.epicId, story.epicId), ne(stories.status, 'done')))
        .all()

      if (undone.length > 0) return

      // All stories done — mark epic as done
      const epicRow = this.db
        .select({ id: epics.id, status: epics.status })
        .from(epics)
        .where(eq(epics.id, story.epicId))
        .get()

      if (!epicRow || epicRow.status === 'done') return

      const now = new Date().toISOString()
      this.db.transaction(tx => {
        tx.update(epics)
          .set({ status: 'done', updatedAt: now, version: sql`${epics.version} + 1` })
          .where(eq(epics.id, story.epicId))
          .run()
      })

      eventBus.emit('epic:done', { epicId: story.epicId, epicKey })
      logger.info(`Auto-completed epic ${epicKey} (all stories done)`)
    } catch (err: unknown) {
      logger.error(`tryAutoCompleteEpic failed for epic ${epicKey}`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
