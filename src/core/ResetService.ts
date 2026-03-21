import { eq, ne, and, sql, desc, or, inArray } from 'drizzle-orm';

import { Logger } from '@core/Logger.js';

import type { PipelineConfig } from './ConfigTypes.js';
import type { DrizzleDB } from './db/Connection.js';
import { tasks, stories, epics, taskLogs } from './db/schema.js';
import { batchUpdate } from './db/batchUpdate.js';
import { ResetError } from './Errors.js';
import type { EventBus } from './EventBus.js';
import type { ResetResult, CancelResult, ReopenResult, ResetTarget, IResetService, StoryRow } from './ResetTypes.js';
import { buildChainInput } from '@shared/ChainInputBuilder.js';
import { parseSessionInfo } from '@workers/SessionManager.js';

const log = Logger.getOrNoop('ResetService');

export class ResetService implements IResetService {
  constructor(
    private db: DrizzleDB,
    private eventBus: EventBus,
    private pipelineConfig: PipelineConfig,
  ) {}

  deleteTask(taskId: number): void {
    try {
      this.db.transaction((tx) => {
        // Delete logs first due to foreign key
        tx.delete(taskLogs).where(eq(taskLogs.taskId, taskId)).run();
        tx.delete(tasks).where(eq(tasks.id, taskId)).run();
      });
      log.info('deleteTask: success', { taskId });
    } catch (err) {
      log.error('deleteTask: failed', { taskId, error: String(err) });
      throw new ResetError(`Failed to delete task ${taskId}: ${String(err)}`);
    }
  }

  retryTask(taskId: number): void {
    let storyId = 0;
    let stageName = '';
    try {
      this.db.transaction((tx) => {
        const task = tx
          .select({ 
            storyId: tasks.storyId, 
            stageName: tasks.stageName, 
            team: tasks.team,
            input: tasks.input 
          })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .get();

        if (!task) throw new ResetError('Task not found');
        storyId = task.storyId;
        stageName = task.stageName;

        const now = new Date().toISOString();
        // Supersede original
        tx.update(tasks).set({ superseded: 1, updatedAt: now }).where(eq(tasks.id, taskId)).run();

        // Create new queued task
        tx.insert(tasks)
          .values({
            storyId: task.storyId,
            stageName: task.stageName,
            team: task.team,
            status: 'queued',
            input: task.input,
            attempt: 1,
            superseded: 0,
            createdAt: now,
            updatedAt: now,
            version: 1,
          })
          .run();
      });

      this.eventBus.emit('story:reset', { 
        storyId, 
        storyKey: '', 
        targetStage: stageName, 
        supersededTaskIds: [taskId], 
        newTaskId: 0 
      });
      log.info('retryTask: success', { taskId });
    } catch (err) {
      log.error('retryTask: failed', { taskId, error: String(err) });
      throw new ResetError(`Failed to retry task ${taskId}: ${String(err)}`);
    }
  }

  pushNextStage(taskId: number): void {
    let storyId = 0;
    let nextStageName = '';
    try {
      this.db.transaction((tx) => {
        const task = tx
          .select({ 
            storyId: tasks.storyId, 
            stageName: tasks.stageName, 
            team: tasks.team,
            output: tasks.output
          })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .get();

        if (!task) throw new ResetError('Task not found');
        storyId = task.storyId;

        const now = new Date().toISOString();
        // Mark current as done
        tx.update(tasks)
          .set({ status: 'done', completedAt: now, updatedAt: now })
          .where(eq(tasks.id, taskId))
          .run();

        // Find next stage
        const currentIndex = this.pipelineConfig.stages.findIndex((s) => s.name === task.stageName);
        const nextStage = this.pipelineConfig.stages[currentIndex + 1];

        if (nextStage) {
          nextStageName = nextStage.name;
          const chainInput = buildChainInput(this.db, taskId, task.output ?? null, task.stageName);
          tx.insert(tasks)
            .values({
              storyId: task.storyId,
              stageName: nextStage.name,
              team: task.team,
              status: 'queued',
              input: chainInput,
              attempt: 1,
              superseded: 0,
              createdAt: now,
              updatedAt: now,
              version: 1,
            })
            .run();
          tx.update(stories)
            .set({ priority: sql`${stories.priority} + 1`, updatedAt: now, version: sql`${stories.version} + 1` })
            .where(eq(stories.id, task.storyId))
            .run();
        } else {
          // Final stage done -> story done
          tx.update(stories)
            .set({ status: 'done', updatedAt: now, version: sql`${stories.version} + 1` })
            .where(eq(stories.id, task.storyId))
            .run();
        }
      });

      if (nextStageName) {
        this.eventBus.emit('story:reset', {
          storyId,
          storyKey: '',
          targetStage: nextStageName,
          supersededTaskIds: [],
          newTaskId: 0
        });
      }

      log.info('pushNextStage: success', { taskId });
    } catch (err) {
      log.error('pushNextStage: failed', { taskId, error: String(err) });
      throw new ResetError(`Failed to push next stage for task ${taskId}: ${String(err)}`);
    }
  }

  getResetTargets(storyId: number): ResetTarget[] {
    const activeTasks = this.db
      .select({ stageName: tasks.stageName })
      .from(tasks)
      .where(and(eq(tasks.storyId, storyId), eq(tasks.superseded, 0)))
      .orderBy(desc(tasks.id))
      .limit(1)
      .all();

    const mostRecent = activeTasks[0];
    if (!mostRecent) {
      return [];
    }

    const currentStageName = mostRecent.stageName;
    const currentStage = this.pipelineConfig.stages.find((s) => s.name === currentStageName);
    if (!currentStage || !currentStage.reset_to || currentStage.reset_to.length === 0) {
      return [];
    }

    const targets: ResetTarget[] = [];
    for (const targetName of currentStage.reset_to) {
      const stageConfig = this.pipelineConfig.stages.find((s) => s.name === targetName);
      if (stageConfig) {
        targets.push({
          stageName: stageConfig.name,
          displayName: stageConfig.displayName,
          icon: stageConfig.icon,
        });
      }
    }
    return targets;
  }

  getStoriesWithActiveTasks(projectId: number): StoryRow[] {
    const activeStoryIds = this.db
      .select({ storyId: tasks.storyId })
      .from(tasks)
      .where(or(eq(tasks.status, 'queued'), eq(tasks.status, 'running')))
      .all()
      .map((r) => r.storyId);

    const uniqueIds = [...new Set(activeStoryIds)];
    if (uniqueIds.length === 0) return [];

    return this.db
      .select({
        id: stories.id,
        storyKey: stories.storyKey,
        title: stories.title,
        status: stories.status,
      })
      .from(stories)
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(and(eq(epics.projectId, projectId), inArray(stories.id, uniqueIds)))
      .all();
  }

  getResetableStories(projectId: number): StoryRow[] {
    return this.db
      .select({
        id: stories.id,
        storyKey: stories.storyKey,
        title: stories.title,
        status: stories.status,
      })
      .from(stories)
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(and(eq(epics.projectId, projectId), inArray(stories.status, ['blocked', 'failed'])))
      .all();
  }

  startListening(): void {
    this.eventBus.on('story:request-reset', ({ storyId, targetStage }) => {
      try {
        this.resetStory(storyId, targetStage);
      } catch (err) {
        log.error('story:request-reset listener failed', { storyId, targetStage, error: String(err) });
      }
    });

    this.eventBus.on('story:request-cancel', ({ storyId }) => {
      try {
        this.cancelStory(storyId);
      } catch (err) {
        log.error('story:request-cancel listener failed', { storyId, error: String(err) });
      }
    });
  }

  resetStory(storyId: number, targetStage: string): ResetResult {
    const stageExists = this.pipelineConfig.stages.some((s) => s.name === targetStage);
    if (!stageExists) {
      throw new ResetError(`Target stage '${targetStage}' does not exist in pipeline config`);
    }

    const supersededTaskIds: number[] = [];
    let newTaskId = 0;
    let storyKey = '';

    try {
      this.db.transaction((tx) => {
        const now = new Date().toISOString();

        const story = tx
          .select({ id: stories.id, storyKey: stories.storyKey })
          .from(stories)
          .where(eq(stories.id, storyId))
          .get();

        if (!story) {
          throw new ResetError('Story not found');
        }
        storyKey = story.storyKey;

        const activeTasks = tx
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(
            and(
              eq(tasks.storyId, storyId),
              eq(tasks.superseded, 0),
              ne(tasks.status, 'cancelled'),
            ),
          )
          .all();

        if (activeTasks.some((t) => t.status === 'running')) {
          throw new ResetError('Cannot reset story with a running task');
        }

        for (const task of activeTasks) {
          supersededTaskIds.push(task.id);
        }

        if (supersededTaskIds.length > 0) {
          batchUpdate(tx, supersededTaskIds, { superseded: 1, updatedAt: now });
        }

        const inserted = tx
          .insert(tasks)
          .values({
            storyId,
            stageName: targetStage,
            status: 'queued',
            team: this.pipelineConfig.team,
            attempt: 1,
            superseded: 0,
            createdAt: now,
            updatedAt: now,
            version: 1,
          })
          .returning({ id: tasks.id })
          .get();

        const insertedId = inserted.id;
        if (insertedId == null) throw new ResetError('Failed to retrieve inserted task id');
        newTaskId = insertedId;

        // Clear session for target stage → force new session on retry
        const storyData = tx
          .select({ sessionInfo: stories.sessionInfo })
          .from(stories)
          .where(eq(stories.id, storyId))
          .get();
        const sessionInfo = parseSessionInfo(storyData?.sessionInfo ?? null);
        delete sessionInfo[targetStage];
        const updatedSessionInfo = Object.keys(sessionInfo).length > 0
          ? JSON.stringify(sessionInfo)
          : null;

        tx.update(stories)
          .set({ status: 'in_progress', priority: 0, sessionInfo: updatedSessionInfo, updatedAt: now, version: sql`${stories.version} + 1` })
          .where(eq(stories.id, storyId))
          .run();
      });

      const result: ResetResult = { success: true, storyId, targetStage, supersededTaskIds, newTaskId };
      this.eventBus.emit('story:reset', { storyId, storyKey, targetStage, supersededTaskIds, newTaskId });
      log.info('resetStory: success', { storyId, targetStage, supersededCount: supersededTaskIds.length });
      return result;
    } catch (err) {
      if (err instanceof ResetError) throw err;
      log.error('resetStory: failed', {
        storyId,
        targetStage,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  cancelStory(storyId: number): CancelResult {
    let cancelledTaskIds: number[] = [];
    let storyKey = '';

    try {
      this.db.transaction((tx) => {
        const now = new Date().toISOString();

        const story = tx
          .select({ storyKey: stories.storyKey })
          .from(stories)
          .where(eq(stories.id, storyId))
          .get();

        if (!story) {
          throw new ResetError('Story not found');
        }
        storyKey = story.storyKey;

        const activeTasks = tx
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.storyId, storyId), eq(tasks.superseded, 0)))
          .all();

        if (activeTasks.some((t) => t.status === 'running')) {
          throw new ResetError('Cannot cancel story while a task is running. Wait for it to complete.');
        }

        const queuedIds = activeTasks
          .filter((t) => t.status === 'queued')
          .map((t) => {
            const id = t.id;
            if (id == null) throw new ResetError('Task id missing');
            return id;
          });

        if (queuedIds.length > 0) {
          batchUpdate(tx, queuedIds, { status: 'cancelled', updatedAt: now });
        }

        cancelledTaskIds = queuedIds;

        tx.update(stories)
          .set({ status: 'cancelled', updatedAt: now, version: sql`${stories.version} + 1` })
          .where(eq(stories.id, storyId))
          .run();
      });

      const result: CancelResult = { success: true, storyId, cancelledTaskIds };
      this.eventBus.emit('story:cancelled', { storyId, storyKey, cancelledTaskIds });
      log.info('cancelStory: success', { storyId, cancelledCount: cancelledTaskIds.length });
      return result;
    } catch (err) {
      if (err instanceof ResetError) throw err;
      log.error('cancelStory: failed', {
        storyId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  reopenStory(storyId: number): ReopenResult {
    const firstStage = this.pipelineConfig.stages[0];
    if (!firstStage) {
      throw new ResetError('No stages configured');
    }
    const firstStageName = firstStage.name;

    const supersededTaskIds: number[] = [];
    let newTaskId = 0;
    let storyKey = '';

    try {
      this.db.transaction((tx) => {
        const now = new Date().toISOString();

        const story = tx
          .select({ storyKey: stories.storyKey })
          .from(stories)
          .where(eq(stories.id, storyId))
          .get();

        if (!story) {
          throw new ResetError('Story not found');
        }
        storyKey = story.storyKey;

        const activeTasks = tx
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.storyId, storyId), eq(tasks.superseded, 0)))
          .all();

        if (activeTasks.some((t) => t.status === 'running')) {
          throw new ResetError('Cannot reopen story while a task is running.');
        }

        for (const task of activeTasks) {
          const id = task.id;
          if (id == null) throw new ResetError('Task id missing');
          supersededTaskIds.push(id);
        }

        if (supersededTaskIds.length > 0) {
          batchUpdate(tx, supersededTaskIds, { superseded: 1, updatedAt: now });
        }

        const inserted = tx
          .insert(tasks)
          .values({
            storyId,
            stageName: firstStageName,
            status: 'queued',
            team: this.pipelineConfig.team,
            attempt: 1,
            superseded: 0,
            createdAt: now,
            updatedAt: now,
            version: 1,
          })
          .returning({ id: tasks.id })
          .get();

        const insertedId = inserted.id;
        if (insertedId == null) throw new ResetError('Failed to retrieve inserted task id');
        newTaskId = insertedId;

        // Clear all session_info on reopen → all stages start fresh
        tx.update(stories)
          .set({ status: 'in_progress', priority: 0, sessionInfo: null, updatedAt: now, version: sql`${stories.version} + 1` })
          .where(eq(stories.id, storyId))
          .run();
      });

      const result: ReopenResult = { success: true, storyId, supersededTaskIds, newTaskId };
      this.eventBus.emit('story:reset', {
        storyId,
        storyKey,
        targetStage: firstStageName,
        supersededTaskIds,
        newTaskId,
      });
      log.info('reopenStory: success', { storyId, firstStageName, supersededCount: supersededTaskIds.length });
      return result;
    } catch (err) {
      if (err instanceof ResetError) throw err;
      log.error('reopenStory: failed', {
        storyId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
