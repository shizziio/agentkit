import { eq } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { tasks } from '@core/db/schema.js'
import type { StageConfig } from '@core/ConfigTypes.js'
import type { BaseProvider } from '@providers/interfaces/BaseProvider.js'
import { processManager } from '@providers/agent/ProcessManager.js'
import { eventBus } from '@core/EventBus.js'
import { QueueError } from '@core/Errors.js'
import { DEFAULT_POLL_INTERVAL, MAX_POLL_INTERVAL, BACKOFF_MULTIPLIER } from '@config/defaults.js'
import { DrainSignal } from '@core/DrainSignal.js'
import { Queue } from '@core/Queue.js'

import type { EventMap } from '@core/EventTypes.js'

import { StageWorker } from './StageWorker.js'
import { Router } from './Router.js'
import { cleanupStaleOutputs } from './OutputFileManager.js'
import { CompletionHandler } from './CompletionHandler.js'
import { TaskLogWriter } from './TaskLogWriter.js'
import type { PipelineOptions, ShutdownState } from './PipelineTypes.js'
import type { StageWorkerConfig } from './StageWorkerTypes.js'
import type { PipelineStatus } from '@core/ConfigTypes.js'
import { Logger } from '@core/Logger.js'
import { DependencyResolver } from '@core/DependencyResolver.js'

const logger = Logger.getOrNoop('WorkerPipeline')

const SHUTDOWN_TIMEOUT_MS = 30_000

interface RegisteredHandler {
  signal: string
  handler: (...args: never[]) => void
}

export class Pipeline {
  private readonly db: DrizzleDB
  private readonly pipelineConfig: PipelineOptions['pipelineConfig']
  private readonly provider: BaseProvider
  private readonly projectRoot: string
  private readonly stageMap: Map<string, StageConfig>
  private readonly completionHandler: CompletionHandler
  private readonly taskLogWriter: TaskLogWriter
  private readonly drainSignal: DrainSignal = new DrainSignal()
  private workers: StageWorker[] = []
  private shutdownState: ShutdownState = 'running'
  private signalHandlers: RegisteredHandler[] = []
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null
  private taskCompletedListener: ((event: EventMap['task:completed']) => void) | null = null
  private terminateEmitted = false
  private depResolver: DependencyResolver | null = null
  private depResolverListener: ((event: EventMap['story:completed']) => void) | null = null
  private depResolverEpicListener: ((event: EventMap['epic:done']) => void) | null = null
  private depResolverInterval: ReturnType<typeof setInterval> | null = null
  /** Frozen team configs for multi-team support. Immutable for the duration of this pipeline run. */
  private readonly frozenTeamConfigs: Map<string, PipelineOptions['pipelineConfig']>
  private readonly teamCompletionHandlers: Map<string, CompletionHandler>

  constructor(options: PipelineOptions) {
    this.db = options.db
    this.pipelineConfig = structuredClone(options.pipelineConfig)
    this.provider = options.provider
    this.projectRoot = options.projectRoot
    this.taskLogWriter = new TaskLogWriter(this.db)

    // Config freeze: deep-clone all team configs at pipeline start
    if (options.teamConfigs && options.teamConfigs.size > 0) {
      this.frozenTeamConfigs = new Map()
      for (const [name, cfg] of options.teamConfigs) {
        this.frozenTeamConfigs.set(name, structuredClone(cfg))
      }
    } else {
      this.frozenTeamConfigs = new Map([[this.pipelineConfig.team, this.pipelineConfig]])
    }

    // Build a combined stage map across all teams (prefixed for uniqueness)
    this.stageMap = new Map()
    this.teamCompletionHandlers = new Map()
    for (const [teamName, cfg] of this.frozenTeamConfigs) {
      const teamStageMap = new Map(cfg.stages.map(s => [s.name, s]))
      for (const [stageName, stageConfig] of teamStageMap) {
        this.stageMap.set(stageName, stageConfig)
      }
      const router = new Router(this.db, teamName, cfg.stages)
      this.teamCompletionHandlers.set(teamName, new CompletionHandler(this.db, router, teamStageMap))
    }

    this.validateConfig()

    // Primary completion handler (for single-team compat in getters)
    const primaryRouter = new Router(this.db, this.pipelineConfig.team, this.pipelineConfig.stages)
    this.completionHandler = new CompletionHandler(this.db, primaryRouter, new Map(this.pipelineConfig.stages.map(s => [s.name, s])))

    // Apply session concurrency limit
    if (options.maxConcurrentSessions) {
      processManager.setMaxConcurrent(options.maxConcurrentSessions)
    }
  }

  async start(): Promise<void> {
    try {
      cleanupStaleOutputs(this.projectRoot)
      const teamSummary = [...this.frozenTeamConfigs.entries()]
        .map(([name, cfg]) => `${name}(${cfg.stages.map(s => s.name).join('→')})`)
        .join(', ')
      logger.info(`Pipeline starting [teams=${teamSummary}]`)

      this.createWorkers()
      this.registerSignalHandlers()

      logger.info(`Pipeline ready [${this.workers.length} workers]`)

      // TODO: pass projectId through PipelineOptions once run command provides it
      eventBus.emit('pipeline:start', {
        projectId: 0,
        timestamp: new Date().toISOString(),
      })

      this.registerTaskCompletionListener()

      this.depResolver = new DependencyResolver(this.db, eventBus)
      this.registerDependencyResolver()

      for (const w of this.workers) {
        w.start()
      }
    } catch (err: unknown) {
      logger.error('workerPipeline: startup failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async stop(): Promise<void> {
    if (this.shutdownState !== 'running') return
    logger.info('Pipeline stopping — awaiting workers...')
    this.shutdownState = 'graceful'

    const stopPromises = this.workers.map(w => w.stop())

    this.shutdownTimer = setTimeout(() => {
      this.forceQuit()
    }, SHUTDOWN_TIMEOUT_MS)

    await Promise.all(stopPromises)
    await this.taskLogWriter.drain()

    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = null
    }

    this.cleanup()

    logger.info('Pipeline stopped')
    // TODO: pass projectId through PipelineOptions once run command provides it
    eventBus.emit('pipeline:stop', {
      projectId: 0,
      timestamp: new Date().toISOString(),
    })
  }

  async drain(): Promise<void> {
    if (this.shutdownState !== 'running') return

    this.drainSignal.activate()

    eventBus.emit('pipeline:draining', {
      projectId: 0,
      timestamp: new Date().toISOString(),
    })

    const stopPromises = this.workers.map(w => w.stop())
    await Promise.all(stopPromises)
    await this.taskLogWriter.drain()

    const queue = new Queue(this.db)
    for (const teamName of this.frozenTeamConfigs.keys()) {
      queue.cancelAllQueued(teamName)
    }

    this.cleanup()
    this.drainSignal.reset()

    eventBus.emit('pipeline:stop', {
      projectId: 0,
      timestamp: new Date().toISOString(),
    })
  }

  async terminate(): Promise<void> {
    if (this.shutdownState !== 'running') return
    logger.info('Pipeline terminating — stopping all workers...')
    this.shutdownState = 'graceful'

    eventBus.emit('pipeline:stopping', {
      projectId: 0,
      timestamp: new Date().toISOString(),
    })

    const stopPromises = this.workers.map(w => w.stop())

    this.shutdownTimer = setTimeout(() => {
      this.forceTerminate()
    }, SHUTDOWN_TIMEOUT_MS)

    await Promise.all(stopPromises)
    await this.taskLogWriter.drain()

    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = null
    }

    this.cleanup()
    this.shutdownState = 'terminated'
    logger.info('Pipeline terminated')

    if (!this.terminateEmitted) {
      this.terminateEmitted = true
      eventBus.emit('pipeline:terminated', {
        projectId: 0,
        timestamp: new Date().toISOString(),
      })
    }
  }

  getShutdownState(): ShutdownState {
    return this.shutdownState
  }

  getWorkerCount(): number {
    return this.workers.length
  }

  isRunning(): boolean {
    return this.shutdownState === 'running' && this.workers.length > 0
  }

  getStatus(): PipelineStatus {
    const stateMap: Record<ShutdownState, PipelineStatus['state']> = {
      running: 'running',
      graceful: 'stopping',
      force: 'stopped',
      terminated: 'stopped',
    }
    return {
      state: this.workers.length === 0 ? 'stopped' : stateMap[this.shutdownState],
      workers: this.workers.map(w => w.getStatus()),
      activeTeam: this.pipelineConfig.team,
    }
  }

  private validateConfig(): void {
    for (const stage of this.pipelineConfig.stages) {
      if (stage.reject_to && !this.stageMap.has(stage.reject_to)) {
        throw new QueueError(
          `Stage "${stage.name}" references unknown reject_to stage: "${stage.reject_to}"`
        )
      }
      if (stage.next && !this.stageMap.has(stage.next)) {
        throw new QueueError(`Stage "${stage.name}" references unknown next stage: "${stage.next}"`)
      }
    }
  }

  private createWorkers(): void {
    for (const [teamName, teamConfig] of this.frozenTeamConfigs) {
      for (const stage of teamConfig.stages) {
        const model = teamConfig.models.resolved[stage.name] ?? 'sonnet'
        const workerCount = stage.workers ?? 1

        for (let i = 0; i < workerCount; i++) {
          const config: StageWorkerConfig = {
            stageName: stage.name,
            workerIndex: i,
            projectRoot: this.projectRoot,
            pollInterval: DEFAULT_POLL_INTERVAL,
            maxPollInterval: MAX_POLL_INTERVAL,
            backoffMultiplier: BACKOFF_MULTIPLIER,
            model,
            timeout: stage.timeout * 1000,
            promptPath: stage.prompt,
            next: stage.next,
            reject_to: stage.reject_to,
            activeTeam: teamName,
            providerEnv: teamConfig.providerEnv,
            settingsPath: teamConfig.settingsPath,
          }

          logger.info(
            `Worker[${i}] created: ${teamName}/${stage.name} [model=${model} timeout=${stage.timeout}s workers=${workerCount}]`
          )

          this.workers.push(
            new StageWorker(config, this.db, this.provider, eventBus, this.taskLogWriter, this.drainSignal)
          )
        }
      }
    }
  }

  private resolveAllTeamDeps(context: string): void {
    if (!this.depResolver) return
    let totalCount = 0
    for (const [teamName, cfg] of this.frozenTeamConfigs) {
      const firstStage = cfg.stages[0]?.name ?? ''
      const count = this.depResolver.resolveWaitingStories(teamName, firstStage)
      totalCount += count
    }
    if (totalCount > 0) {
      logger.info(`DependencyResolver: unblocked ${totalCount} waiting stories ${context}`)
    }
  }

  private registerDependencyResolver(): void {
    this.depResolverListener = () => {
      if (this.shutdownState !== 'running') return
      this.resolveAllTeamDeps('after story:completed')
    }
    eventBus.on('story:completed', this.depResolverListener)

    // Also resolve when an epic completes — unblock stories in dependent epics
    this.depResolverEpicListener = () => {
      if (this.shutdownState !== 'running') return
      this.resolveAllTeamDeps('after epic:done')
    }
    eventBus.on('epic:done', this.depResolverEpicListener)

    this.depResolverInterval = setInterval(() => {
      if (this.shutdownState !== 'running') return
      this.resolveAllTeamDeps('(periodic check)')
    }, 10_000)
  }

  private registerTaskCompletionListener(): void {
    this.taskCompletedListener = event => {
      if (this.drainSignal.isDraining()) {
        logger.info(`Drain active — task#${event.taskId} done, skipping routing`)
        return
      }
      if (this.shutdownState !== 'running') return
      try {
        // Look up task's team and dispatch to correct CompletionHandler
        const taskRow = this.db
          .select({ team: tasks.team })
          .from(tasks)
          .where(eq(tasks.id, event.taskId))
          .get()
        const taskTeam = taskRow?.team ?? this.pipelineConfig.team
        const handler = this.teamCompletionHandlers.get(taskTeam) ?? this.completionHandler
        handler.handleTaskCompletion(event.taskId, event.storyId, event.stageName)
      } catch (err) {
        logger.error(
          `Completion routing failed task#${event.taskId} [story#${event.storyId} stage=${event.stageName}]`,
          {
            error: err instanceof Error ? err.message : String(err),
          }
        )
      }
    }
    eventBus.on('task:completed', this.taskCompletedListener)
  }

  private registerSignalHandlers(): void {
    const sigintHandler = async (): Promise<void> => {
      if (this.shutdownState === 'graceful' || this.shutdownState === 'force') {
        this.forceQuit()
        return
      }
      await this.stop()
      process.exit(0)
    }

    const sigtermHandler = async (): Promise<void> => {
      await this.stop()
      process.exit(0)
    }

    const uncaughtHandler = async (err: Error): Promise<void> => {
      logger.error('workerPipeline: uncaught exception', { error: err.message })
      await this.stop()
      process.exit(1)
    }

    process.on('SIGINT', sigintHandler)
    process.on('SIGTERM', sigtermHandler)
    process.on('uncaughtException', uncaughtHandler)

    // Safe: each handler's signature is a subset of NodeJS signal/error listener types.
    // RegisteredHandler uses (...args: never[]) => void to store heterogeneous handlers
    // in a single array for cleanup via process.removeListener.
    this.signalHandlers.push(
      { signal: 'SIGINT', handler: sigintHandler as (...args: never[]) => void },
      { signal: 'SIGTERM', handler: sigtermHandler as (...args: never[]) => void },
      { signal: 'uncaughtException', handler: uncaughtHandler as (...args: never[]) => void }
    )
  }

  private forceTerminate(): void {
    if (this.shutdownState !== 'graceful') return
    this.shutdownState = 'force'
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = null
    }
    processManager.killAll()
    try {
      this.taskLogWriter.flush()
    } catch {
      /* best effort */
    }
    this.cleanup()
    this.shutdownState = 'terminated'

    if (!this.terminateEmitted) {
      this.terminateEmitted = true
      eventBus.emit('pipeline:terminated', {
        projectId: 0,
        timestamp: new Date().toISOString(),
      })
    }
  }

  private forceQuit(): void {
    this.shutdownState = 'force'
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = null
    }
    processManager.killAll()
    try {
      this.taskLogWriter.flush()
    } catch {
      /* best effort */
    }
    this.cleanup()
    process.exit(1)
  }

  private cleanup(): void {
    for (const { signal, handler } of this.signalHandlers) {
      // safe: process.removeListener requires a broader signature than RegisteredHandler's never[] — see RegisteredHandler comment
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      process.removeListener(signal, handler as (...args: any[]) => void)
    }
    this.signalHandlers = []

    if (this.taskCompletedListener) {
      eventBus.off('task:completed', this.taskCompletedListener)
      this.taskCompletedListener = null
    }

    if (this.depResolverListener) {
      eventBus.off('story:completed', this.depResolverListener)
      this.depResolverListener = null
    }

    if (this.depResolverEpicListener) {
      eventBus.off('epic:done', this.depResolverEpicListener)
      this.depResolverEpicListener = null
    }

    if (this.depResolverInterval) {
      clearInterval(this.depResolverInterval)
      this.depResolverInterval = null
    }
  }
}
