import { eq, desc } from 'drizzle-orm'

import type { DrizzleDB } from '@core/db/Connection.js'
import { taskLogs } from '@core/db/schema.js'
import { LOG_BATCH_SIZE, LOG_FLUSH_INTERVAL } from '@config/defaults.js'

import type { StreamEvent } from '@core/EventTypes.js'
import type { TaskLogEntry } from './TaskLogWriterTypes.js'
import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('TaskLogWriter')

/**
 * Buffers stream events and batch-inserts them into the task_logs table.
 *
 * INVARIANT: task_logs are NEVER deleted when a task is reset during crash recovery.
 * Previous run logs are preserved across retries. New runs append logs with
 * continuing sequence numbers (queried from max existing sequence for that taskId).
 */
export class TaskLogWriter {
  private readonly db: DrizzleDB
  private buffer: TaskLogEntry[] = []
  private sequenceCounters: Map<number, number> = new Map()
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(db: DrizzleDB) {
    this.db = db
  }

  /**
   * Start the periodic flush timer. Called lazily on first write.
   */
  private ensureTimer(): void {
    if (this.flushTimer !== null) return
    this.flushTimer = setInterval(() => {
      this.flush()
    }, LOG_FLUSH_INTERVAL)
    // Unref so the timer doesn't keep the process alive
    if (typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      this.flushTimer.unref()
    }
  }

  /**
   * Get the next sequence number for a given taskId.
   * On first call for a taskId, queries the DB for the max existing sequence
   * to support crash recovery (preserving previous run logs).
   */
  private getNextSequence(taskId: number): number {
    const current = this.sequenceCounters.get(taskId)
    if (current !== undefined) {
      const next = current + 1
      this.sequenceCounters.set(taskId, next)
      return next
    }

    // Query max existing sequence for this taskId
    let maxSeq = 0
    try {
      const row = this.db
        .select({ sequence: taskLogs.sequence })
        .from(taskLogs)
        .where(eq(taskLogs.taskId, taskId))
        .orderBy(desc(taskLogs.sequence))
        .limit(1)
        .get()
      if (row) {
        maxSeq = row.sequence
      }
    } catch {
      // DB error — start from 0
    }

    const next = maxSeq + 1
    this.sequenceCounters.set(taskId, next)
    return next
  }

  /**
   * Buffer a stream event for later persistence.
   * Triggers an immediate flush if buffer reaches LOG_BATCH_SIZE.
   */
  write(taskId: number, event: StreamEvent): void {
    this.ensureTimer()

    const sequence = this.getNextSequence(taskId)
    this.buffer.push({
      taskId,
      sequence,
      eventType: event.type,
      eventData: JSON.stringify(event.data),
    })

    if (this.buffer.length >= LOG_BATCH_SIZE) {
      this.flush()
    }
  }

  /**
   * Flush all buffered entries to the database in a single transaction.
   * No-op if buffer is empty.
   */
  flush(): void {
    if (this.buffer.length === 0) return

    const entries = this.buffer
    this.buffer = []

    if (entries.length > 100) {
      logger.warn('taskLogWriter: buffer full', { bufferSize: entries.length })
    }

    logger.debug('taskLogWriter: batch write', { count: entries.length })

    try {
      this.db.transaction(tx => {
        for (const entry of entries) {
          tx.insert(taskLogs)
            .values({
              taskId: entry.taskId,
              sequence: entry.sequence,
              eventType: entry.eventType,
              eventData: entry.eventData,
            })
            .run()
        }
      })
    } catch (err: unknown) {
      logger.error('taskLogWriter: write failed', { error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  /**
   * Flush remaining buffered events and clear the interval timer.
   * Safe to call multiple times — idempotent.
   */
  async drain(): Promise<void> {
    this.flush()
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}
