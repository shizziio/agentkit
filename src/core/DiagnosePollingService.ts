import type { DiagnoseService } from './DiagnoseService.js'
import type { EventBus } from './EventBus.js'
import type { LoggerLike } from './Logger.js'

const POLL_INTERVAL_MS = 30_000

export class DiagnosePollingService {
  private pollInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly diagnoseService: DiagnoseService,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerLike
  ) {}

  start(): void {
    if (this.pollInterval !== null) {
      return
    }
    this.runPoll()
    this.pollInterval = setInterval(() => {
      this.runPoll()
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.pollInterval === null) {
      return
    }
    clearInterval(this.pollInterval)
    this.pollInterval = null
  }

  private runPoll(): void {
    const timestamp = new Date().toISOString()
    try {
      const result = this.diagnoseService.diagnose()
      this.eventBus.emit('diagnose:result', { result, timestamp })
    } catch (err) {
      this.logger.error('Poll failed', { error: String(err) })
      this.eventBus.emit('diagnose:result', {
        result: {
          issues: [],
          summary: {
            stuckCount: 0,
            orphanedCount: 0,
            queueGapCount: 0,
            loopBlockedCount: 0,
            failedCount: 0,
            blockedCount: 0,
          },
        },
        timestamp,
        error: String(err),
      })
    }
  }
}
