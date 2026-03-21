import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks } from '@core/db/schema';
import { PipelineService } from '@core/PipelineService';

function seedProject(db: DrizzleDB): number {
  const project = db
    .insert(projects)
    .values({ projectName: 'test-project', team: 'agentkit' } as any)
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
  return story.id;
}

function insertTask(
  db: DrizzleDB,
  storyId: number,
  overrides: Partial<{
    stageName: string;
    status: string;
    attempt: number;
    startedAt: string | null;
  }> = {},
) {
  return db
    .insert(tasks)
    .values({
      storyId,
      stageName: overrides.stageName ?? 'dev',
      status: overrides.status ?? 'queued',
      attempt: overrides.attempt ?? 1,
      startedAt: overrides.startedAt ?? null,
    } as any)
    .returning()
    .get();
}

describe('PipelineService', () => {
  let db: DrizzleDB;
  let service: PipelineService;
  let storyId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    storyId = seedProject(db);
    service = new PipelineService(db);
  });

  it('returns empty result when no running tasks exist', () => {
    insertTask(db, storyId, { status: 'queued' });

    const result = service.recoverOrphanedTasks();

    expect(result.recoveredCount).toBe(0);
    expect(result.recoveredTasks).toEqual([]);
  });

  it('resets single orphaned running task to queued', () => {
    const task = insertTask(db, storyId, {
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    });

    const result = service.recoverOrphanedTasks();

    expect(result.recoveredCount).toBe(1);
    expect(result.recoveredTasks[0].id).toBe(task.id);

    const updated = db.select().from(tasks).where(eq(tasks.id as any, task.id) as any).get();
    expect(updated!.status).toBe('queued');
    expect(updated!.startedAt).toBeNull();
  });

  it('resets multiple orphaned running tasks to queued in one transaction', () => {
    insertTask(db, storyId, { status: 'running', stageName: 'dev' });
    insertTask(db, storyId, { status: 'running', stageName: 'review' });
    insertTask(db, storyId, { status: 'running', stageName: 'tester' });

    const result = service.recoverOrphanedTasks();

    expect(result.recoveredCount).toBe(3);

    const allTasks = db.select().from(tasks).all();
    for (const t of allTasks) {
      expect(t.status).toBe('queued');
    }
  });

  it('does not affect tasks with other statuses (queued, done, failed, blocked)', () => {
    const queued = insertTask(db, storyId, { status: 'queued' });
    const completed = insertTask(db, storyId, { status: 'completed' });
    const failed = insertTask(db, storyId, { status: 'failed' });
    const running = insertTask(db, storyId, { status: 'running' });

    const result = service.recoverOrphanedTasks();

    expect(result.recoveredCount).toBe(1);
    expect(result.recoveredTasks[0].id).toBe(running.id);

    const queuedRow = db.select().from(tasks).where(eq(tasks.id as any, queued.id) as any).get();
    const completedRow = db.select().from(tasks).where(eq(tasks.id as any, completed.id) as any).get();
    const failedRow = db.select().from(tasks).where(eq(tasks.id as any, failed.id) as any).get();

    expect(queuedRow!.status).toBe('queued');
    expect(completedRow!.status).toBe('completed');
    expect(failedRow!.status).toBe('failed');
  });

  it('clears startedAt and updates updatedAt on recovered tasks', () => {
    const task = insertTask(db, storyId, {
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    });

    const beforeRecovery = new Date().toISOString();
    service.recoverOrphanedTasks();

    const updated = db.select().from(tasks).where(eq(tasks.id as any, task.id) as any).get();
    expect(updated!.startedAt).toBeNull();
    expect(updated!.updatedAt).toBeDefined();
    expect(updated!.updatedAt! >= beforeRecovery).toBe(true);
  });

  it('increments version on recovered tasks', () => {
    const task = insertTask(db, storyId, { status: 'running' });
    const originalVersion = task.version;

    service.recoverOrphanedTasks();

    const updated = db.select().from(tasks).where(eq(tasks.id as any, task.id) as any).get();
    expect(updated!.version).toBe(originalVersion + 1);
  });
});
