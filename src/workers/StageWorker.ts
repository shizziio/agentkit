import { eq } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { tasks, stories } from '@core/db/schema.js'
import { EventBus } from '@core/EventBus.js'
import type { StreamEvent as ProviderStreamEvent } from '@core/EventTypes.js'
import { AgentKitError } from '@core/Errors.js'
import { Queue } from '@core/Queue.js'
import type { DequeueResult } from '@core/QueueTypes.js'
import type { BaseProvider, ProviderConfig } from '@providers/interfaces/BaseProvider.js'
import { Logger } from '@core/Logger.js'
import { DrainSignal } from '@core/DrainSignal.js'

import { loadPrompt, injectInput, buildResumePrompt } from './PromptLoader.js'
import { generateSessionName, isResumable, parseSessionInfo } from './SessionManager.js'
import type { SessionIdResolver } from '@providers/interfaces/BaseProvider.js'
import { getOutputPath, ensureOutputDir, deleteOutputFile } from './OutputFileManager.js'
import { resolveOutput, updateTaskFailed } from './OutputResolver.js'
import { processManager } from '@providers/agent/ProcessManager.js'
import type { TaskLogWriter } from './TaskLogWriter.js'
import type { StageWorkerConfig, StageWorkerStatus } from './StageWorkerTypes.js'
import type { WorkerStatus } from '@core/ConfigTypes.js'

const logger = Logger.getOrNoop('StageWorker')

export class StageWorker {
  private readonly queue: Queue
  private readonly config: StageWorkerConfig
  private readonly db: DrizzleDB
  private readonly provider: BaseProvider
  private readonly eventBus: EventBus
  private readonly taskLogWriter: TaskLogWriter
  private readonly drainSignal: DrainSignal
  private readonly sessionResolver: SessionIdResolver | null
  private currentPollInterval: number
  private status: StageWorkerStatus = 'idle'
  private currentTaskId: number | null = null
  private startedAt: Date | null = null
  private abortController: AbortController = new AbortController()
  private runningPromise: Promise<void> | null = null

  constructor(
    config: StageWorkerConfig,
    db: DrizzleDB,
    provider: BaseProvider,
    eventBus: EventBus,
    taskLogWriter: TaskLogWriter,
    drainSignal: DrainSignal = new DrainSignal()
  ) {
    this.config = config
    this.db = db
    this.provider = provider
    this.eventBus = eventBus
    this.taskLogWriter = taskLogWriter
    this.drainSignal = drainSignal
    this.queue = new Queue(db)
    this.sessionResolver = provider.createSessionResolver?.(db, config.projectRoot) ?? null
    this.currentPollInterval = config.pollInterval
  }

  getStatus(): WorkerStatus {
    const statusValue = this.status === 'idle' ? 'stopped' : this.status
    return {
      stageName: this.config.stageName,
      workerIndex: this.config.workerIndex,
      status: statusValue,
      currentTaskId: this.currentTaskId,
      uptime: this.startedAt ? Date.now() - this.startedAt.getTime() : 0,
    }
  }

  getCurrentTaskId(): number | null {
    return this.currentTaskId
  }

  start(): void {
    if (this.status === 'running') return
    this.status = 'running'
    this.startedAt = new Date()
    this.abortController = new AbortController()
    this.currentPollInterval = this.config.pollInterval
    this.runningPromise = this.pollLoop()
  }

  async stop(): Promise<void> {
    if (this.status !== 'running') return
    this.status = 'stopping'
    this.abortController.abort()
    if (this.runningPromise) {
      await this.runningPromise
    }
    await this.taskLogWriter.drain()
    this.status = 'stopped'
  }

  private async pollLoop(): Promise<void> {
    while (this.status === 'running') {
      try {
        if (this.drainSignal.isDraining()) {
          logger.info(`Worker [${this.config.stageName}] draining — exiting`)
          break
        }

        // Check session concurrency limit before dequeuing
        if (!processManager.canAcquire(this.config.activeTeam)) {
          this.currentPollInterval = Math.min(
            this.currentPollInterval * this.config.backoffMultiplier,
            this.config.maxPollInterval
          )
          await this.delay(this.currentPollInterval)
          continue
        }

        const task = this.queue.dequeue(this.config.stageName, this.config.activeTeam)

        if (task === null) {
          this.currentPollInterval = Math.min(
            this.currentPollInterval * this.config.backoffMultiplier,
            this.config.maxPollInterval
          )
          await this.delay(this.currentPollInterval)
          continue
        }

        this.currentPollInterval = this.config.pollInterval
        await this.processTask(task)

        if (this.drainSignal.isDraining()) {
          logger.info(`Worker [${this.config.stageName}] drained after task#${task.id}`)
          break
        }
      } catch (err) {
        logger.error('stageWorker: execution failed', {
          error: err instanceof Error ? err.message : String(err),
        })
        await this.delay(this.currentPollInterval)
      }
    }
  }

  private async processTask(task: DequeueResult): Promise<void> {
    const startTime = Date.now()
    this.currentTaskId = task.id
    const outputPath = getOutputPath(this.config.projectRoot, task.id)
    ensureOutputDir(this.config.projectRoot)

    this.eventBus.emit('task:started', {
      taskId: task.id,
      storyId: task.storyId,
      stageName: this.config.stageName,
      status: 'running',
      attempt: task.attempt,
    })
    logger.info(
      `Claimed task#${task.id} [story#${task.storyId} stage=${this.config.stageName} attempt=${task.attempt}/${task.maxAttempts} model=${this.config.model}]`,
      {
        inputPreview: task.input ? task.input : '(empty)',
      }
    )

    let collectedText = '',
      rawStdout = '',
      rawStderr = ''
    const collectedEvents: Array<{ type: string; data: Record<string, unknown> }> = []

    try {
      // Session continuity: detect resume vs new session
      const story = this.db
        .select({ title: stories.title, content: stories.content, sessionInfo: stories.sessionInfo })
        .from(stories)
        .where(eq(stories.id, task.storyId))
        .get()

      const sessionInfo = parseSessionInfo(story?.sessionInfo ?? null)
      const existingSession = sessionInfo[this.config.stageName] ?? null
      const supportsSession = this.provider.capabilities.sessionSupport
      const resume = isResumable(task.attempt, supportsSession, existingSession)

      let sessionName: string | undefined
      let resumeSession: string | undefined
      let fullPrompt: string

      if (resume) {
        // Resolve session name → provider session ID for --resume
        const resolvedId = this.sessionResolver?.resolve(existingSession!) ?? null
        if (resolvedId) {
          resumeSession = resolvedId
          logger.info(
            `🔄 Resuming session task#${task.id} [stage=${this.config.stageName} name=${existingSession} uuid=${resolvedId}]`
          )
        } else {
          // UUID not found — fall back to full prompt as new session
          logger.warn(
            `Session UUID not found for "${existingSession}" — falling back to new session task#${task.id}`
          )
          const projectName = this.config.activeTeam
          const storyKey = this.getStoryKey(task.storyId)
          sessionName = generateSessionName(projectName, storyKey, this.config.stageName)
          resumeSession = undefined
        }
        fullPrompt = resume && resumeSession
          ? buildResumePrompt(story?.title ?? '', task.input ?? null, outputPath)
          : this.preparePrompt(task.id, task.storyId, task.input ?? '', outputPath, story)
      } else if (supportsSession) {
        // New session
        const projectName = this.config.activeTeam
        const storyKey = this.getStoryKey(task.storyId)
        sessionName = generateSessionName(projectName, storyKey, this.config.stageName)
        resumeSession = undefined
        fullPrompt = this.preparePrompt(task.id, task.storyId, task.input ?? '', outputPath, story)
        logger.info(
          `🆕 New session task#${task.id} [stage=${this.config.stageName} session=${sessionName}]`
        )
      } else {
        // No session support — use full prompt as before
        fullPrompt = this.preparePrompt(task.id, task.storyId, task.input ?? '', outputPath, story)
      }

      // Save session name to task record — only for new-session cases.
      // When resuming (resumeSession is a UUID), we do NOT overwrite tasks.sessionName
      // so Router.ts does not replace stories.sessionInfo[stageName] with the UUID.
      if (sessionName) {
        const now = new Date().toISOString()
        this.db.transaction(tx => {
          tx.update(tasks)
            .set({ sessionName: sessionName!, updatedAt: now })
            .where(eq(tasks.id, task.id))
            .run()
        })
      }

      const providerConfig: ProviderConfig = {
        taskId: task.id,
        stageName: this.config.stageName,
        model: this.config.model,
        timeout: this.config.timeout,
        permissions: 'dangerously-skip',
        providerEnv: this.config.providerEnv,
        settingsPath: this.config.settingsPath,
        sessionName,
        resumeSession,
      }

      let inputTokens: number | undefined, outputTokens: number | undefined

      try {
        for await (const event of this.provider.execute(fullPrompt, providerConfig)) {
          if (event.type === 'raw_trace') {
            rawStdout = event.data.stdout ?? ''
            rawStderr = event.data.stderr ?? ''
            continue
          }

          this.reEmitStreamEvent(event)
          this.taskLogWriter.write(task.id, event)

          if (event.type === 'text' && event.data.text) {
            collectedText += event.data.text + '\n'
          }
          if (event.type === 'done') {
            if (event.data.inputTokens !== undefined) inputTokens = event.data.inputTokens
            if (event.data.outputTokens !== undefined) outputTokens = event.data.outputTokens
          }
          collectedEvents.push({ type: event.type, data: event.data as Record<string, unknown> }) // StreamEvent.data is a plain object with optional string/number fields — safe to treat as Record<string, unknown> for debug storage
        }
      } finally {
        await this.taskLogWriter.drain()
      }

      // Index session ID after provider process completes (for future resume)
      if (sessionName && supportsSession && this.sessionResolver) {
        this.sessionResolver.scanNewSessions()
      }

      const durationMs = Date.now() - startTime

      const resolution = resolveOutput(outputPath, collectedText, inputTokens, outputTokens)
      if (resolution.kind === 'done') {
        if (resolution.source === 'file') deleteOutputFile(outputPath)
        this.updateTaskDone(
          task.id,
          resolution.output,
          durationMs,
          resolution.inputTokens,
          resolution.outputTokens
        )
        this.eventBus.emit('task:completed', {
          taskId: task.id,
          storyId: task.storyId,
          stageName: this.config.stageName,
          status: 'completed',
          durationMs,
        })
        logger.info(
          `Completed task#${task.id} [story#${task.storyId} stage=${this.config.stageName} ${durationMs}ms]`,
          {
            source: resolution.source,
            outputLen: resolution.output.length,
            outputPreview: resolution.output,
          }
        )
      } else {
        logger.error(
          `FAILED task#${task.id} [story#${task.storyId} stage=${this.config.stageName} ${durationMs}ms error=${resolution.error}]`,
          {
            rawPreview: resolution.rawText,
            stderr: rawStderr,
            eventTypes: [...new Set(collectedEvents.map(e => e.type))],
          }
        )
        this.taskLogWriter.flush() // drain() completes buffered writes; flush() forces immediate sync before the DB failure record is written
        updateTaskFailed(
          this.db,
          task.id,
          resolution.rawText,
          resolution.error,
          durationMs,
          rawStdout,
          rawStderr,
          collectedEvents
        )
        this.eventBus.emit('task:failed', {
          taskId: task.id,
          storyId: task.storyId,
          stageName: this.config.stageName,
          status: 'failed',
          durationMs,
          error: resolution.error,
        })
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMessage =
        err instanceof AgentKitError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unexpected worker error'

      this.taskLogWriter.flush() // drain() completes buffered writes; flush() forces immediate sync before the DB failure record is written
      updateTaskFailed(
        this.db,
        task.id,
        collectedText,
        errorMessage,
        durationMs,
        rawStdout,
        rawStderr,
        collectedEvents
      )
      this.eventBus.emit('task:failed', {
        taskId: task.id,
        storyId: task.storyId,
        stageName: this.config.stageName,
        status: 'failed',
        durationMs,
        error: errorMessage,
      })
      logger.error(
        `Execution error task#${task.id} [story#${task.storyId} stage=${this.config.stageName}]`,
        { error: errorMessage }
      )
    } finally {
      this.currentTaskId = null
    }
  }

  private reEmitStreamEvent(event: ProviderStreamEvent): void {
    const eventKey = `stream:${event.type}` as const
    if (
      eventKey === 'stream:thinking' ||
      eventKey === 'stream:text' ||
      eventKey === 'stream:tool_use' ||
      eventKey === 'stream:tool_result' ||
      eventKey === 'stream:error' ||
      eventKey === 'stream:done'
    ) {
      this.eventBus.emit(eventKey, event)
    }
  }

  private updateTaskDone(
    taskId: number,
    output: string,
    durationMs: number,
    inputTokens?: number,
    outputTokens?: number
  ): void {
    const now = new Date().toISOString()
    this.db.transaction(tx => {
      tx.update(tasks)
        .set({
          status: 'done',
          output,
          completedAt: now,
          durationMs,
          inputTokens: inputTokens ?? null,
          outputTokens: outputTokens ?? null,
          workerModel: this.config.model,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run()
    })
  }

  private getStoryKey(storyId: number): string {
    const row = this.db
      .select({ storyKey: stories.storyKey })
      .from(stories)
      .where(eq(stories.id, storyId))
      .get()
    return row?.storyKey ?? `story-${storyId}`
  }

  private preparePrompt(
    taskId: number,
    storyId: number,
    input: string,
    outputPath: string,
    story?: { title: string; content: string | null } | undefined,
  ): string {
    if (!story) {
      story = this.db
        .select({ title: stories.title, content: stories.content })
        .from(stories)
        .where(eq(stories.id, storyId))
        .get() ?? undefined
    }
    if (!story) {
      logger.warn(
        `Story#${storyId} not found for task#${taskId} — prompt will have no story context`
      )
    }
    const prompt = injectInput(loadPrompt(this.config.promptPath, this.config.projectRoot), {
      input,
      taskId,
      storyTitle: story?.title,
      storyContent: story?.content ?? undefined,
      outputFile: outputPath,
    })
    logger.info(`Prompt built — calling ${this.provider.name} task#${taskId}`, {
      stage: this.config.stageName,
      model: this.config.model,
      storyTitle: story?.title ?? '(unknown)',
      promptLen: prompt.length,
      inputLen: input.length,
      storyContentLen: story?.content?.length ?? 0,
      promptPreview: prompt,
    })
    const now = new Date().toISOString()
    this.db.transaction(tx => {
      tx.update(tasks).set({ prompt, updatedAt: now }).where(eq(tasks.id, taskId)).run()
    })
    return prompt
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const timer = setTimeout(resolve, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        resolve()
      }
      if (this.abortController.signal.aborted) {
        clearTimeout(timer)
        resolve()
        return
      }
      this.abortController.signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
