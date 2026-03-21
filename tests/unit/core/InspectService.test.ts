import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks, taskLogs } from '@core/db/schema';
import { InspectService } from '@core/InspectService';
import { InspectError } from '@core/Errors';
import { MAX_CHAIN_LENGTH } from '@config/defaults';

describe('InspectService', () => {
  let db: DrizzleDB;
  let service: InspectService;
  let projectId: number;
  let epicId: number;
  let storyId: number;
  let parentTaskId: number;
  let taskId: number;
  let childTaskId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    service = new InspectService(db);

    // Seed project
    const proj = db
      .insert(projects)
      .values({ projectName: 'test-project', team: 'agentkit' } as any)
      .returning({ id: projects.id })
      .get();
    projectId = proj.id;

    // Seed epic
    const epic = db
      .insert(epics)
      .values({ projectId, epicKey: 'E1', title: 'Epic One', orderIndex: 0 })
      .returning({ id: epics.id })
      .get();
    epicId = epic.id;

    // Seed story
    const story = db
      .insert(stories)
      .values({ epicId, storyKey: 'S1.1', title: 'Story One', orderIndex: 0 })
      .returning({ id: stories.id })
      .get();
    storyId = story.id;

    // Seed parent task
    const parentTask = db
      .insert(tasks)
      .values({ storyId, stageName: 'sm', status: 'done', attempt: 1, maxAttempts: 3 } as any)
      .returning({ id: tasks.id })
      .get();
    parentTaskId = parentTask.id;

    // Seed main task (child of parent)
    const task = db
      .insert(tasks)
      .values({ storyId, stageName: 'dev', status: 'running', attempt: 1, maxAttempts: 3, parentId: parentTaskId } as any)
      .returning({ id: tasks.id })
      .get();
    taskId = task.id;

    // Seed child task
    const childTask = db
      .insert(tasks)
      .values({ storyId, stageName: 'review', status: 'queued', attempt: 1, maxAttempts: 3, parentId: taskId } as any)
      .returning({ id: tasks.id })
      .get();
    childTaskId = childTask.id;

    // Seed task_logs
    db.insert(taskLogs).values([
      { taskId, sequence: 1, eventType: 'text', eventData: 'hello world' },
      { taskId, sequence: 2, eventType: 'done', eventData: '{}' },
    ]).run();
  });

  it('returns correct TaskInspectData for a known task', () => {
    const result = service.getTaskInspect(taskId);

    expect(result.task.id).toBe(taskId);
    expect(result.task.stageName).toBe('dev');
    expect(result.task.status).toBe('running');
    expect(result.story.storyKey).toBe('S1.1');
    expect(result.story.title).toBe('Story One');
    expect(result.epic.epicKey).toBe('E1');
    expect(result.epic.title).toBe('Epic One');
  });

  it('builds ancestor chain root-first', () => {
    const result = service.getTaskInspect(taskId);
    expect(result.ancestors).toHaveLength(1);
    expect(result.ancestors[0].id).toBe(parentTaskId);
    expect(result.ancestors[0].stageName).toBe('sm');
  });

  it('lists direct children', () => {
    const result = service.getTaskInspect(taskId);
    expect(result.children).toHaveLength(1);
    expect(result.children[0].id).toBe(childTaskId);
    expect(result.children[0].stageName).toBe('review');
  });

  it('returns event log ordered by sequence', () => {
    const result = service.getTaskInspect(taskId);
    expect(result.eventLog).toHaveLength(2);
    expect(result.eventLog[0].sequence).toBe(1);
    expect(result.eventLog[0].eventType).toBe('text');
    expect(result.eventLog[1].sequence).toBe(2);
    expect(result.eventLog[1].eventType).toBe('done');
  });

  it('has no ancestors for root task', () => {
    const result = service.getTaskInspect(parentTaskId);
    expect(result.ancestors).toHaveLength(0);
    expect(result.chainTruncated).toBe(false);
  });

  it('throws InspectError when task not found', () => {
    expect(() => service.getTaskInspect(99999)).toThrow(InspectError);
  });

  it('sets chainTruncated=true and caps ancestors at MAX_CHAIN_LENGTH when chain is longer', () => {
    // Build a chain of MAX_CHAIN_LENGTH + 2 tasks (root ... deep leaf)
    let prevId: number | null = null;
    const chainIds: number[] = [];

    for (let i = 0; i < MAX_CHAIN_LENGTH + 2; i++) {
      const inserted = db
        .insert(tasks)
        .values({
          storyId,
          stageName: `stage-${i}`,
          status: 'done',
          attempt: 1,
          maxAttempts: 3,
          ...(prevId !== null ? { parentId: prevId } : {}),
        })
        .returning({ id: tasks.id })
        .get();
      chainIds.push(inserted.id);
      prevId = inserted.id;
    }

    // The last task in the chain is the leaf; its ancestors should be capped
    const leafId = chainIds[chainIds.length - 1];
    const result = service.getTaskInspect(leafId);

    expect(result.chainTruncated).toBe(true);
    expect(result.ancestors.length).toBe(MAX_CHAIN_LENGTH);
  });

  it('returns empty event log when task has no logs', () => {
    const result = service.getTaskInspect(parentTaskId);
    expect(result.eventLog).toHaveLength(0);
  });

  it('handles multiple children correctly', () => {
    // Create additional children
    const child2 = db
      .insert(tasks)
      .values({ storyId, stageName: 'design', status: 'queued', attempt: 1, maxAttempts: 3, parentId: taskId } as any)
      .returning({ id: tasks.id })
      .get();

    const child3 = db
      .insert(tasks)
      .values({ storyId, stageName: 'qa', status: 'queued', attempt: 1, maxAttempts: 3, parentId: taskId } as any)
      .returning({ id: tasks.id })
      .get();

    const result = service.getTaskInspect(taskId);
    expect(result.children).toHaveLength(3);
    expect(result.children.map((c) => c.id)).toEqual(expect.arrayContaining([childTaskId, child2.id, child3.id]));
  });

  it('builds correct ancestor chain with multiple levels', () => {
    // Create grandparent task
    const grandparentTask = db
      .insert(tasks)
      .values({ storyId, stageName: 'init', status: 'done', attempt: 1, maxAttempts: 3 } as any)
      .returning({ id: tasks.id })
      .get();

    // Update parent to have grandparent as parent
    db.update(tasks)
      .set({ parentId: grandparentTask.id })
      .where(eq(tasks.id as any, parentTaskId) as any)
      .run();

    const result = service.getTaskInspect(taskId);
    expect(result.ancestors).toHaveLength(2);
    expect(result.ancestors[0].id).toBe(grandparentTask.id);
    expect(result.ancestors[0].stageName).toBe('init');
    expect(result.ancestors[1].id).toBe(parentTaskId);
    expect(result.ancestors[1].stageName).toBe('sm');
  });

  it('includes all required fields in task data', () => {
    const result = service.getTaskInspect(taskId);
    const taskData = result.task;

    expect(taskData.id).toBe(taskId);
    expect(taskData.stageName).toBeDefined();
    expect(taskData.status).toBeDefined();
    expect(taskData.attempt).toBeDefined();
    expect(taskData.maxAttempts).toBeDefined();
    expect(taskData.durationMs).toBeDefined();
    expect(taskData.startedAt).toBeDefined();
    expect(taskData.completedAt).toBeDefined();
    expect(taskData.inputTokens).toBeDefined();
    expect(taskData.outputTokens).toBeDefined();
    expect(taskData.prompt).toBeDefined();
    expect(taskData.input).toBeDefined();
    expect(taskData.output).toBeDefined();
    expect(taskData.workerModel).toBeDefined();
  });

  it('includes all required fields in story and epic data', () => {
    const result = service.getTaskInspect(taskId);

    expect(result.story.id).toBeDefined();
    expect(result.story.storyKey).toBe('S1.1');
    expect(result.story.title).toBe('Story One');
    expect(result.story.status).toBeDefined();

    expect(result.epic.id).toBeDefined();
    expect(result.epic.epicKey).toBe('E1');
    expect(result.epic.title).toBe('Epic One');
  });

  it('returns data with correct types and structures', () => {
    const result = service.getTaskInspect(taskId);

    expect(typeof result.task.id).toBe('number');
    expect(typeof result.task.stageName).toBe('string');
    expect(Array.isArray(result.ancestors)).toBe(true);
    expect(Array.isArray(result.children)).toBe(true);
    expect(Array.isArray(result.eventLog)).toBe(true);
    expect(typeof result.chainTruncated).toBe('boolean');
  });
});
