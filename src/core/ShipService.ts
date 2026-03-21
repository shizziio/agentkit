import { eq, and, inArray, sql } from 'drizzle-orm';

import type { DrizzleDB } from '@core/db/Connection.js';
import { epics, stories, tasks } from '@core/db/schema.js';
import { QueueError } from '@core/Errors.js';
import type { StoryWithEpic, ShipResult, WaitingStory } from '@core/ShipTypes.js';
import type { EventBus } from '@core/EventBus.js';
import type { PipelineConfig } from '@core/ConfigTypes.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('ShipService');

export class ShipService {
  private db: DrizzleDB;
  private eventBus?: EventBus;

  constructor(db: DrizzleDB, eventBus?: EventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  /**
   * Resolve team and first stage for a story based on its epic's team assignment.
   * Falls back to the provided defaults if epic has no team.
   */
  resolveTeamForStory(
    epicId: number,
    defaultTeam: string,
    defaultFirstStage: string,
    teamConfigs?: Map<string, PipelineConfig>,
  ): { team: string; firstStage: string } {
    const epicRow = this.db
      .select({ team: epics.team })
      .from(epics)
      .where(eq(epics.id, epicId))
      .get();

    const team = epicRow?.team ?? defaultTeam;

    if (teamConfigs) {
      const cfg = teamConfigs.get(team);
      if (cfg) {
        return { team, firstStage: cfg.stages[0]?.name ?? defaultFirstStage };
      }
    }

    return { team, firstStage: defaultFirstStage };
  }

  getStories(projectId: number, epicFilter?: number): StoryWithEpic[] {
    const condition = epicFilter !== undefined
      ? and(eq(epics.projectId, projectId), eq(epics.id, epicFilter))
      : eq(epics.projectId, projectId);

    const rows = this.db
      .select({
        id: stories.id,
        storyKey: stories.storyKey,
        title: stories.title,
        status: stories.status,
        epicId: epics.id,
        epicKey: epics.epicKey,
        epicTitle: epics.title,
        dependsOn: stories.dependsOn,
      })
      .from(stories)
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(condition)
      .all();

    if (rows.length === 0) {
      return [];
    }

    const storyIds = rows.map((r) => r.id);
    const taskedIds = new Set(
      this.db
        .select({ storyId: tasks.storyId })
        .from(tasks)
        .where(inArray(tasks.storyId, storyIds))
        .all()
        .map((r: { storyId: number }) => r.storyId),
    );

    return rows.map((r) => {
      let dependsOn: string[] | null = null;
      if (r.dependsOn) {
        try {
          const parsed = JSON.parse(r.dependsOn) as unknown;
          dependsOn = Array.isArray(parsed) && parsed.length > 0 ? (parsed as string[]) : null;
        } catch {
          dependsOn = null;
        }
      }
      return {
        ...r,
        dependsOn,
        hasExistingTasks: taskedIds.has(r.id),
      };
    });
  }

  private checkEpicDepsMetInTx(
    tx: any,
    projectId: number,
    epicDeps: string[],
  ): { met: boolean; unmet: string[] } {
    const projectEpics = tx
      .select({ epicKey: epics.epicKey, status: epics.status })
      .from(epics)
      .where(eq(epics.projectId, projectId))
      .all();

    const statusMap = new Map<string, string>();
    for (const e of projectEpics) {
      statusMap.set(e.epicKey, e.status);
    }

    const unmet: string[] = [];
    for (const dep of epicDeps) {
      if (statusMap.get(dep) !== 'done') {
        unmet.push(dep);
      }
    }

    return { met: unmet.length === 0, unmet };
  }

  private checkDepsMetInTx(
    tx: any, // Accepts both DrizzleDB and SQLiteTransaction
    epicId: number,
    dependsOn: string[],
  ): { met: boolean; unmet: string[] } {
    const epicStories = tx
      .select({ storyKey: stories.storyKey, status: stories.status })
      .from(stories)
      .where(eq(stories.epicId, epicId))
      .all();

    const statusMap = new Map<string, string>();
    for (const s of epicStories) {
      statusMap.set(s.storyKey, s.status);
    }

    const unmet: string[] = [];
    for (const dep of dependsOn) {
      if (statusMap.get(dep) !== 'done') {
        unmet.push(dep);
      }
    }

    return { met: unmet.length === 0, unmet };
  }

  shipStories(
    storyIds: number[],
    firstStageName: string,
    activeTeam: string,
    options?: { skipDeps?: boolean; skipDepsLevel?: 'epic' | 'story'; teamConfigs?: Map<string, PipelineConfig> },
  ): ShipResult {
    logger.info('ship: starting', { storyIds });

    if (storyIds.length === 0) {
      throw new QueueError('No stories selected to ship');
    }

    if (activeTeam === '') {
      throw new QueueError('activeTeam must not be empty when shipping stories');
    }

    try {
      const shippedIds: number[] = [];
      const waitingList: WaitingStory[] = [];

      this.db.transaction((tx) => {
        const now = new Date().toISOString();
        for (const storyId of storyIds) {
          const story = tx
            .select({
              content: stories.content,
              storyKey: stories.storyKey,
              title: stories.title,
              epicId: stories.epicId,
              dependsOn: stories.dependsOn,
            })
            .from(stories)
            .where(eq(stories.id, storyId))
            .get();

          if (!story) continue;

          const firstStageSkipDeps = options?.skipDeps ?? false;
          const firstStageSkipDepsLevel = options?.skipDepsLevel ?? 'epic';

          // Skip all dep checks if first stage has skipDeps=true
          if (!firstStageSkipDeps) {
            // Check epic-level dependencies (only when skipDepsLevel='epic')
            if (firstStageSkipDepsLevel === 'epic') {
              const epicRow = tx
                .select({ dependsOn: epics.dependsOn, projectId: epics.projectId })
                .from(epics)
                .where(eq(epics.id, story.epicId))
                .get();

              if (epicRow?.dependsOn) {
                let epicDeps: string[] = [];
                try {
                  const parsed = JSON.parse(epicRow.dependsOn) as unknown;
                  if (Array.isArray(parsed) && parsed.length > 0) epicDeps = parsed as string[];
                } catch { /* ignore */ }

                if (epicDeps.length > 0) {
                  const { met: epicDepsMet } = this.checkEpicDepsMetInTx(tx, epicRow.projectId, epicDeps);
                  if (!epicDepsMet) {
                    tx.update(stories)
                      .set({ status: 'waiting', updatedAt: now, version: sql`${stories.version} + 1` })
                      .where(eq(stories.id, storyId))
                      .run();
                    waitingList.push({ storyKey: story.storyKey, unmetDeps: epicDeps.map(k => `epic:${k}`) });
                    continue;
                  }
                }
              }
            }
          }

          // Parse story-level dependsOn JSON
          // Story deps checked when skipDeps=false (for both 'epic' and 'story' levels)
          let deps: string[] | null = null;
          if (!firstStageSkipDeps && story.dependsOn) {
            try {
              const parsed = JSON.parse(story.dependsOn) as unknown;
              if (Array.isArray(parsed) && parsed.length > 0) {
                deps = parsed as string[];
              }
            } catch {
              logger.warn('ship: malformed dependsOn JSON, treating as no deps', { storyId });
            }
          }

          if (deps !== null) {
            const { met, unmet } = this.checkDepsMetInTx(tx, story.epicId, deps);
            if (!met) {
              tx.update(stories)
                .set({ status: 'waiting', updatedAt: now, version: sql`${stories.version} + 1` })
                .where(eq(stories.id, storyId))
                .run();
              waitingList.push({ storyKey: story.storyKey, unmetDeps: unmet });
              continue;
            }
          }

          // Deps met (or no deps) — ship normally
          const input = story.content
            ? `Story ${story.storyKey}: ${story.title}\n\n${story.content}`
            : '';

          // Resolve team and first stage from epic.team when teamConfigs available
          const resolved = options?.teamConfigs
            ? this.resolveTeamForStory(story.epicId, activeTeam, firstStageName, options.teamConfigs)
            : { team: activeTeam, firstStage: firstStageName };

          tx.insert(tasks).values({
            storyId,
            stageName: resolved.firstStage,
            status: 'queued',
            input,
            team: resolved.team,
          }).run();

          tx.update(stories)
            .set({ status: 'in_progress', updatedAt: now, version: sql`${stories.version} + 1` })
            .where(eq(stories.id, storyId))
            .run();

          shippedIds.push(storyId);
          logger.info('ship: injected input', { storyId, contentLength: input.length });
        }
      });

      logger.info('ship: complete', { shipped: shippedIds.length, waiting: waitingList.length });

      // Emit task:queued only for shipped stories (not waiting)
      if (this.eventBus) {
        for (const storyId of shippedIds) {
          const task = this.db
            .select({ id: tasks.id, stageName: tasks.stageName })
            .from(tasks)
            .where(and(eq(tasks.storyId, storyId), eq(tasks.status, 'queued')))
            .get();
          if (task) {
            this.eventBus.emit('task:queued', {
              taskId: task.id,
              storyId,
              stageName: task.stageName,
              status: 'queued',
            });
          }
        }
      }

      return {
        shippedCount: shippedIds.length,
        waitingCount: waitingList.length,
        waitingStories: waitingList,
      };
    } catch (err: unknown) {
      logger.error('ship: failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
