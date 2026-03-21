import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks } from '@core/db/schema';
import { EventBus } from '@core/EventBus';
import { Pipeline } from '@core/Pipeline';
import type { EventMap } from '@core/EventTypes';

function seedWithRunningTask(db: DrizzleDB): number {
  const project = db
    .insert(projects)
    .values({ projectName: 'test-project', team: 'agentkit' } as any) // id/createdAt/updatedAt are auto-generated — not required in seed
    .returning()
    .get();
  const epic = db
    .insert(epics)
    .values({ projectId: project.id, epicKey: '1', title: 'Epic 1', orderIndex: 0 })
    .returning()
    .get();
  const story = db
    .insert(stories)
    .values({ epicId: epic.id, storyKey: '1.1', title: 'Story 1', orderIndex: 0 })
    .returning()
    .get();
  const task = db
    .insert(tasks)
    .values({
      storyId: story.id,
      stageName: 'dev',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    } as any) // id/attempt/maxAttempts have schema defaults — not required in seed
    .returning()
    .get();
  return task.id;
}

function seedEmpty(db: DrizzleDB): void {
  db.insert(projects)
    .values({ projectName: 'test-project', team: 'agentkit' } as any) // id/createdAt/updatedAt are auto-generated — not required in seed
    .run();
}

describe('Pipeline', () => {
  let db: DrizzleDB;
  let bus: EventBus;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    bus = new EventBus();
  });

  it('start() calls recoverOrphanedTasks and returns result', async () => {
    seedWithRunningTask(db);

    const pipeline = new Pipeline({ db, eventBus: bus, projectId: 1 });
    const result = await pipeline.start();

    expect(result.recoveredCount).toBe(1);
    expect(result.recoveredTasks).toHaveLength(1);
    expect(result.recoveredTasks[0].stageName).toBe('dev');
  });

  it('start() emits pipeline:start event', async () => {
    seedEmpty(db);

    const listener = vi.fn();
    bus.on('pipeline:start', listener);

    const pipeline = new Pipeline({ db, eventBus: bus, projectId: 42 });
    await pipeline.start();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 42 }),
    );
  });

  it('start() emits task:recovered for each recovered task', async () => {
    const taskId = seedWithRunningTask(db);

    const listener = vi.fn();
    bus.on('task:recovered', listener);

    const pipeline = new Pipeline({ db, eventBus: bus, projectId: 1 });
    await pipeline.start();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId,
        stageName: 'dev',
      }),
    );
  });

  it('start() logs warning for each recovered task', async () => {
    const taskId = seedWithRunningTask(db);
    const recoveredListener = vi.fn();
    bus.on('task:recovered', recoveredListener);

    const pipeline = new Pipeline({ db, eventBus: bus, projectId: 1 });
    await pipeline.start();

    expect(recoveredListener).toHaveBeenCalledOnce();
    expect(recoveredListener).toHaveBeenCalledWith(
      expect.objectContaining({ taskId }),
    );
  });

  it('start() works when no orphaned tasks exist', async () => {
    seedEmpty(db);

    const recoveredListener = vi.fn();
    bus.on('task:recovered', recoveredListener);

    const pipeline = new Pipeline({ db, eventBus: bus, projectId: 1 });
    const result = await pipeline.start();

    expect(result.recoveredCount).toBe(0);
    expect(result.recoveredTasks).toEqual([]);
    expect(recoveredListener).not.toHaveBeenCalled();
  });

  it('start() emits pipeline:ready event with recovery result', async () => {
    seedWithRunningTask(db);

    const listener = vi.fn();
    bus.on('pipeline:ready', listener);

    const pipeline = new Pipeline({ db, eventBus: bus, projectId: 1 });
    const result = await pipeline.start();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      projectId: 1,
      recoveryResult: result,
    });
  });

  it('start() emits pipeline:ready with empty recovery when no orphans', async () => {
    seedEmpty(db);

    const listener = vi.fn();
    bus.on('pipeline:ready', listener);

    const pipeline = new Pipeline({ db, eventBus: bus, projectId: 1 });
    await pipeline.start();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      projectId: 1,
      recoveryResult: {
        recoveredCount: 0,
        recoveredTasks: [],
      },
    });
  });
});
