import { eq, inArray } from 'drizzle-orm'
import type { DrizzleDB } from '@core/db/Connection.js'
import { epics, stories, tasks } from '@core/db/schema.js'
import { EventBus } from '@core/EventBus.js'
import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('DependencyResolver')

export interface ValidationResult {
  valid: boolean
  cycles: string[][]
  missingKeys: string[]
}

interface WaitingStoryRow {
  id: number
  storyKey: string
  epicId: number
  dependsOn: string | null
  waitingStage: string | null
  priority: number
  version: number
}

export class DependencyResolver {
  private readonly db: DrizzleDB
  private readonly bus: EventBus

  constructor(db: DrizzleDB, bus: EventBus) {
    this.db = db
    this.bus = bus
  }

  /**
   * Check if all epic-level dependencies for the epic containing this story are met.
   * Returns true if the epic has no deps or all dep epics have status='done'.
   */
  private checkEpicDepsForStory(epicId: number): boolean {
    const epic = this.db
      .select({ dependsOn: epics.dependsOn, projectId: epics.projectId })
      .from(epics)
      .where(eq(epics.id, epicId))
      .get()

    if (!epic?.dependsOn) return true

    let epicDeps: string[] = []
    try {
      const parsed = JSON.parse(epic.dependsOn) as unknown
      if (Array.isArray(parsed)) epicDeps = parsed as string[]
    } catch {
      return true
    }

    if (epicDeps.length === 0) return true

    // Check each dep epic is 'done'
    const projectEpics = this.db
      .select({ epicKey: epics.epicKey, status: epics.status })
      .from(epics)
      .where(eq(epics.projectId, epic.projectId))
      .all()

    const epicStatusMap = new Map<string, string>()
    for (const e of projectEpics) {
      epicStatusMap.set(e.epicKey, e.status)
    }

    return epicDeps.every(depKey => epicStatusMap.get(depKey) === 'done')
  }

  /**
   * Resolve the team for a story from its epic's team column.
   * Falls back to the provided activeTeam if epic has no team set.
   */
  private resolveStoryTeam(epicId: number, fallbackTeam: string): string {
    const epic = this.db
      .select({ team: epics.team })
      .from(epics)
      .where(eq(epics.id, epicId))
      .get()
    return epic?.team ?? fallbackTeam
  }

  resolveWaitingStories(activeTeam: string, firstStageName: string): number {
    try {
      // Fetch all waiting stories in a single query
      const waitingStories = this.db
        .select({
          id: stories.id,
          storyKey: stories.storyKey,
          epicId: stories.epicId,
          dependsOn: stories.dependsOn,
          waitingStage: stories.waitingStage,
          priority: stories.priority,
          version: stories.version,
        })
        .from(stories)
        .where(eq(stories.status, 'waiting'))
        .all() as WaitingStoryRow[]

      if (waitingStories.length === 0) return 0

      // Collect all epicIds referenced by waiting stories
      const epicIds = [...new Set(waitingStories.map(s => s.epicId))]

      // Fetch all done story keys per epic in one query (no N+1)
      // Fetch all stories in those epics with their status (no N+1)
      const allStoriesByEpic = new Map<number, Map<string, string>>()
      for (const epicId of epicIds) {
        allStoriesByEpic.set(epicId, new Map())
      }

      const epicStories = this.db
        .select({ storyKey: stories.storyKey, epicId: stories.epicId, status: stories.status })
        .from(stories)
        .where(inArray(stories.epicId, epicIds))
        .all() as Array<{ storyKey: string; epicId: number; status: string }>

      for (const row of epicStories) {
        const epicMap = allStoriesByEpic.get(row.epicId)
        if (epicMap) epicMap.set(row.storyKey, row.status)
      }

      let count = 0

      for (const story of waitingStories) {
        // Parse depends_on
        let deps: string[]
        if (story.dependsOn === null || story.dependsOn === undefined || story.dependsOn === '') {
          deps = []
        } else {
          try {
            const parsed = JSON.parse(story.dependsOn) as unknown
            if (!Array.isArray(parsed)) {
              logger.warn(`DependencyResolver: depends_on is not an array for story ${story.storyKey}, skipping`)
              continue
            }
            deps = parsed as string[]
          } catch {
            logger.warn(`DependencyResolver: malformed depends_on JSON for story ${story.storyKey}, skipping`)
            continue
          }
        }

        // Determine which stage to resume at
        const targetStage = story.waitingStage ?? firstStageName

        if (story.waitingStage !== null) {
          // Story is waiting mid-pipeline (e.g., before dev stage)
          // Only check epic-level deps (the reason it was blocked at route time)
          if (!this.checkEpicDepsForStory(story.epicId)) continue
        } else {
          // Story waiting from ship time — check story-level deps within same epic
          const epicStatusMap = allStoriesByEpic.get(story.epicId)
          const allStoryDepsDone = deps.every(depKey => {
            const depStatus = epicStatusMap?.get(depKey)
            return depStatus === 'done'
          })

          if (!allStoryDepsDone) continue

          // Also check epic-level deps
          if (!this.checkEpicDepsForStory(story.epicId)) continue
        }

        // All deps satisfied — transition story in a transaction
        try {
          const storyTeam = this.resolveStoryTeam(story.epicId, activeTeam)
          this.db.transaction(tx => {
            const now = new Date().toISOString()
            tx.update(stories)
              .set({
                status: 'in_progress',
                waitingStage: null,
                updatedAt: now,
                version: story.version + 1,
              })
              .where(eq(stories.id, story.id))
              .run()

            tx.insert(tasks)
              .values({
                storyId: story.id,
                team: storyTeam,
                stageName: targetStage,
                status: 'queued',
                superseded: 0,
                attempt: 1,
              })
              .run()
          })

          this.bus.emit('queue:enqueued', { stage: targetStage, storyId: story.id })
          logger.info(`DependencyResolver: unblocked story ${story.storyKey} (id=${story.id}) → in_progress`)
          count++
        } catch (txErr: unknown) {
          logger.error(`DependencyResolver: transaction failed for story ${story.storyKey}`, {
            error: txErr instanceof Error ? txErr.message : String(txErr),
          })
        }
      }

      return count
    } catch (err: unknown) {
      logger.error('DependencyResolver: resolveWaitingStories failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      return 0
    }
  }

  validateDependencyGraph(epicKey: string): ValidationResult {
    // Find the epic by key
    const epic = this.db
      .select({ id: epics.id })
      .from(epics)
      .where(eq(epics.epicKey, epicKey))
      .get()

    if (!epic) {
      return { valid: true, cycles: [], missingKeys: [] }
    }

    // Load all stories in the epic
    const epicStories = this.db
      .select({ storyKey: stories.storyKey, dependsOn: stories.dependsOn })
      .from(stories)
      .where(eq(stories.epicId, epic.id))
      .all() as Array<{ storyKey: string; dependsOn: string | null }>

    const allKeys = new Set(epicStories.map(s => s.storyKey))

    // Build adjacency list and collect missing keys
    const adjacency = new Map<string, string[]>()
    const missingKeys: string[] = []

    for (const story of epicStories) {
      let deps: string[] = []
      if (story.dependsOn) {
        try {
          const parsed = JSON.parse(story.dependsOn) as unknown
          if (Array.isArray(parsed)) deps = parsed as string[]
        } catch {
          // ignore malformed JSON in validation
        }
      }
      adjacency.set(story.storyKey, deps)

      for (const dep of deps) {
        if (!allKeys.has(dep) && !missingKeys.includes(dep)) {
          missingKeys.push(dep)
        }
      }
    }

    // DFS cycle detection
    const cycles: string[][] = []
    const visited = new Set<string>()
    const inStack = new Set<string>()
    const stackPath: string[] = []

    const dfs = (node: string): void => {
      if (inStack.has(node)) {
        // Found a cycle — extract the cycle from the current path
        const cycleStart = stackPath.indexOf(node)
        if (cycleStart !== -1) {
          cycles.push([...stackPath.slice(cycleStart), node])
        }
        return
      }
      if (visited.has(node)) return

      visited.add(node)
      inStack.add(node)
      stackPath.push(node)

      const deps = adjacency.get(node) ?? []
      for (const dep of deps) {
        if (allKeys.has(dep)) {
          dfs(dep)
        }
      }

      stackPath.pop()
      inStack.delete(node)
    }

    for (const key of allKeys) {
      dfs(key)
    }

    const valid = cycles.length === 0 && missingKeys.length === 0
    return { valid, cycles, missingKeys }
  }
}
