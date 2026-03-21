import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks } from '@core/db/schema';
import { DiagnoseService } from '@core/DiagnoseService';
import type { PipelineConfig } from '@core/ConfigTypes';

// ─── helpers ───────────────────────────────────────────────────────────────

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: 'test-project' })
    .returning({ id: projects.id })
    .get()!.id;
}

function seedEpic(db: DrizzleDB, projectId: number): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey: '1', title: 'Epic 1', orderIndex: 0 })
    .returning({ id: epics.id })
    .get()!.id;
}

function seedStory(db: DrizzleDB, epicId: number, title = 'Story 1'): number {
  return db
    .insert(stories)
    .values({ epicId, storyKey: `1.${Math.random()}`, title, orderIndex: 0 })
    .returning({ id: stories.id })
    .get()!.id;
}

function insertTask(
  db: DrizzleDB,
  storyId: number,
  stageName: string,
  status: string,
  opts: {
    startedAt?: string;
    createdAt?: string;
    parentId?: number | null;
    output?: string | null;
    durationMs?: number;
    superseded?: number;
  } = {},
): number {
  const now = new Date().toISOString();
  return db
    .insert(tasks)
    .values({
      storyId,
      stageName,
      status,
      startedAt: opts.startedAt ?? (status === 'running' ? now : null),
      parentId: opts.parentId ?? null,
      output: opts.output ?? null,
      durationMs: opts.durationMs ?? null,
      superseded: opts.superseded ?? 0,
    })
    .returning({ id: tasks.id })
    .get()!.id;
}

function makePipelineConfig(stages: Array<{ name: string; next?: string; timeout?: number }>): PipelineConfig {
  return {
    team: 'agentkit',
    displayName: 'Software',
    provider: 'claude-cli',
    project: { name: 'test' },
    stages: stages.map((s) => ({
      name: s.name,
      displayName: s.name,
      icon: '*',
      prompt: 'p',
      timeout: s.timeout ?? 300, // seconds
      workers: 1,
      retries: 3,
      next: s.next,
    })),
    models: {
      allowed: ['sonnet'],
      resolved: stages.reduce((acc, s) => ({ ...acc, [s.name]: 'sonnet' }), {}),
    },
  };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('DiagnoseService', () => {
  let db: DrizzleDB;
  let projectId: number;
  let epicId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    projectId = seedProject(db);
    epicId = seedEpic(db, projectId);
  });

  // ── findRunningIssues ──────────────────────────────────────────────────

  describe('findRunningIssues', () => {
    it('classifies a task as stuck when elapsedMs > 2 * stageTimeout', () => {
      const storyId = seedStory(db, epicId);
      // Stage timeout = 1 second (1000ms), 2x = 2000ms
      // Set startedAt to 10 seconds ago → elapsedMs ≈ 10000 > 2000
      const startedAt = new Date(Date.now() - 10_000).toISOString();
      insertTask(db, storyId, 'sm', 'running', { startedAt });

      const config = makePipelineConfig([{ name: 'sm', timeout: 1 }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findRunningIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]!.type).toBe('stuck');
      expect(issues[0]!.suggestedAction).toBe('reset_to_queued');
    });

    it('classifies a task as orphaned when elapsedMs <= 2 * stageTimeout', () => {
      const storyId = seedStory(db, epicId);
      // Stage timeout = 3600 seconds (1 hour), 2x = 7200s
      // startedAt = now → elapsedMs ≈ 0 < 7200000
      const startedAt = new Date().toISOString();
      insertTask(db, storyId, 'sm', 'running', { startedAt });

      const config = makePipelineConfig([{ name: 'sm', timeout: 3600 }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findRunningIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]!.type).toBe('orphaned');
      expect(issues[0]!.suggestedAction).toBe('reset_to_queued');
    });

    it('falls back to default timeout (5 min) for unknown stage names', () => {
      const storyId = seedStory(db, epicId);
      // Unknown stage 'unknown_stage', startedAt = 11 minutes ago
      // Default timeout = 300s = 300000ms, 2x = 600000ms
      // 11 minutes = 660000ms > 600000ms → stuck
      const startedAt = new Date(Date.now() - 660_000).toISOString();
      insertTask(db, storyId, 'unknown_stage', 'running', { startedAt });

      const config = makePipelineConfig([{ name: 'sm', timeout: 300 }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findRunningIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]!.type).toBe('stuck');
    });

    it('falls back to default timeout and classifies orphaned for unknown stage < 10 min ago', () => {
      const storyId = seedStory(db, epicId);
      // Unknown stage, startedAt = 4 minutes ago
      // Default 2x timeout = 600000ms, 4 min = 240000ms < 600000ms → orphaned
      const startedAt = new Date(Date.now() - 240_000).toISOString();
      insertTask(db, storyId, 'unknown_stage', 'running', { startedAt });

      const config = makePipelineConfig([{ name: 'sm', timeout: 300 }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findRunningIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]!.type).toBe('orphaned');
    });

    it('falls back to createdAt when startedAt is null', () => {
      const storyId = seedStory(db, epicId);
      // Insert task with status running but explicitly null startedAt
      // createdAt defaults to now in DB, so elapsed ≈ 0 → orphaned with 5-min default timeout
      db.insert(tasks).values({ storyId, stageName: 'sm', status: 'running', startedAt: null }).run();

      const config = makePipelineConfig([{ name: 'sm', timeout: 1 }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findRunningIssues();

      expect(issues).toHaveLength(1);
      // elapsed from createdAt which is roughly now → elapsedMs < 2*1000ms = 2000ms
      // So it's orphaned (not stuck)
      expect(issues[0]!.type).toBe('orphaned');
    });

    it('returns empty when no running tasks', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'sm', 'done');

      const config = makePipelineConfig([{ name: 'sm', timeout: 300 }]);
      const service = new DiagnoseService(db, config);
      expect(service.findRunningIssues()).toHaveLength(0);
    });

    it('returns issues sorted by elapsedMs descending', () => {
      const storyId1 = seedStory(db, epicId, 'Story A');
      const storyId2 = seedStory(db, epicId, 'Story B');
      insertTask(db, storyId1, 'sm', 'running', {
        startedAt: new Date(Date.now() - 5_000).toISOString(),
      });
      insertTask(db, storyId2, 'sm', 'running', {
        startedAt: new Date(Date.now() - 30_000).toISOString(),
      });

      const config = makePipelineConfig([{ name: 'sm', timeout: 300 }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findRunningIssues();

      expect(issues).toHaveLength(2);
      expect(issues[0]!.elapsedMs).toBeGreaterThan(issues[1]!.elapsedMs);
    });

    it('includes storyTitle in each issue', () => {
      const storyId = seedStory(db, epicId, 'My Story Title');
      insertTask(db, storyId, 'sm', 'running');

      const config = makePipelineConfig([{ name: 'sm', timeout: 300 }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findRunningIssues();

      expect(issues[0]!.storyTitle).toBe('My Story Title');
    });
  });

  // ── findQueueGapIssues ─────────────────────────────────────────────────

  describe('findQueueGapIssues', () => {
    it('detects a gap when done task at stage with next, but no next-stage task exists', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'sm', 'done', { output: '{"result":"ok"}' });

      const config = makePipelineConfig([
        { name: 'sm', next: 'dev' },
        { name: 'dev' },
      ]);
      const service = new DiagnoseService(db, config);
      const issues = service.findQueueGapIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]!.type).toBe('queue_gap');
      expect(issues[0]!.gapNextStage).toBe('dev');
      expect(issues[0]!.suggestedAction).toBe('reroute');
      expect(issues[0]!.completedOutput).toBe('{"result":"ok"}');
    });

    it('does NOT flag a gap when the next-stage task already exists', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'sm', 'done');
      insertTask(db, storyId, 'dev', 'queued');

      const config = makePipelineConfig([
        { name: 'sm', next: 'dev' },
        { name: 'dev' },
      ]);
      const service = new DiagnoseService(db, config);
      expect(service.findQueueGapIssues()).toHaveLength(0);
    });

    it('does NOT flag a gap for the final stage (no next defined)', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'tester', 'done');

      const config = makePipelineConfig([{ name: 'tester' }]);
      const service = new DiagnoseService(db, config);
      expect(service.findQueueGapIssues()).toHaveLength(0);
    });

    it('deduplicates: multiple done tasks at same stage/story only produce one gap', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'sm', 'done');
      insertTask(db, storyId, 'sm', 'done');

      const config = makePipelineConfig([
        { name: 'sm', next: 'dev' },
        { name: 'dev' },
      ]);
      const service = new DiagnoseService(db, config);
      const issues = service.findQueueGapIssues();
      expect(issues).toHaveLength(1);
    });

    it('handles null output for done task being re-routed', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'sm', 'done', { output: null });

      const config = makePipelineConfig([
        { name: 'sm', next: 'dev' },
        { name: 'dev' },
      ]);
      const service = new DiagnoseService(db, config);
      const issues = service.findQueueGapIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]!.completedOutput).toBeNull();
    });

    it('returns empty when no done tasks exist', () => {
      const config = makePipelineConfig([{ name: 'sm', next: 'dev' }, { name: 'dev' }]);
      const service = new DiagnoseService(db, config);
      expect(service.findQueueGapIssues()).toHaveLength(0);
    });
  });

  // ── findLoopBlockedIssues ──────────────────────────────────────────────

  describe('findLoopBlockedIssues', () => {
    it('detects loop when a stage appears > MAX_STAGE_REPEATS (3) times in chain', () => {
      const storyId = seedStory(db, epicId);
      // Build chain: sm → dev → sm → dev → sm → dev → sm (7 tasks, sm=4 times)
      const t1 = insertTask(db, storyId, 'sm', 'done');
      const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1 });
      const t3 = insertTask(db, storyId, 'sm', 'done', { parentId: t2 });
      const t4 = insertTask(db, storyId, 'dev', 'done', { parentId: t3 });
      const t5 = insertTask(db, storyId, 'sm', 'done', { parentId: t4 });
      const t6 = insertTask(db, storyId, 'dev', 'done', { parentId: t5 });
      const t7 = insertTask(db, storyId, 'sm', 'blocked', { parentId: t6 });

      // Update t7 to blocked
      db.update(tasks).set({ status: 'blocked' }).where(eq(tasks.id, t7) as any).run();

      const config = makePipelineConfig([{ name: 'sm', next: 'dev' }, { name: 'dev', next: 'sm' }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findLoopBlockedIssues();

      expect(issues.some((i) => i.taskId === t7)).toBe(true);
      const issue = issues.find((i) => i.taskId === t7)!;
      expect(issue.type).toBe('loop_blocked');
      expect(issue.suggestedAction).toBe('reroute'); // next stage exists
      expect(issue.gapNextStage).toBe('dev');
    });

    it('detects loop when chain length >= MAX_CHAIN_LENGTH (10)', () => {
      const storyId = seedStory(db, epicId);
      // Build a chain of 10 tasks through alternating stages
      let parentId: number | null = null;
      const stages = ['sm', 'dev', 'review', 'tester'];
      let lastId = 0;
      for (let i = 0; i < 10; i++) {
        const stageName = stages[i % stages.length]!;
        const status = i === 9 ? 'blocked' : 'done';
        lastId = insertTask(db, storyId, stageName, status, { parentId });
        parentId = lastId;
      }

      const config = makePipelineConfig([
        { name: 'sm', next: 'dev' },
        { name: 'dev', next: 'review' },
        { name: 'review', next: 'tester' },
        { name: 'tester' },
      ]);
      const service = new DiagnoseService(db, config);
      const issues = service.findLoopBlockedIssues();

      expect(issues.some((i) => i.taskId === lastId)).toBe(true);
    });

    it('does NOT flag a single-task chain (no parent) as loop', () => {
      const storyId = seedStory(db, epicId);
      const taskId = insertTask(db, storyId, 'sm', 'blocked');
      db.update(tasks).set({ status: 'blocked' }).where(eq(tasks.id, taskId) as any).run();

      const config = makePipelineConfig([{ name: 'sm' }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findLoopBlockedIssues();

      expect(issues.find((i) => i.taskId === taskId)).toBeUndefined();
    });

    it('does NOT flag a non-looping blocked task (short chain, no repeats)', () => {
      const storyId = seedStory(db, epicId);
      const t1 = insertTask(db, storyId, 'sm', 'done');
      const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1 });
      const t3 = insertTask(db, storyId, 'review', 'blocked', { parentId: t2 });
      db.update(tasks).set({ status: 'blocked' }).where(eq(tasks.id, t3) as any).run();

      const config = makePipelineConfig([
        { name: 'sm', next: 'dev' },
        { name: 'dev', next: 'review' },
        { name: 'review' },
      ]);
      const service = new DiagnoseService(db, config);
      const issues = service.findLoopBlockedIssues();

      expect(issues.find((i) => i.taskId === t3)).toBeUndefined();
    });

    it('returns empty when no blocked tasks exist', () => {
      const config = makePipelineConfig([{ name: 'sm' }]);
      const service = new DiagnoseService(db, config);
      expect(service.findLoopBlockedIssues()).toHaveLength(0);
    });
  });

  // ── resetTask ──────────────────────────────────────────────────────────

  describe('resetTask', () => {
    it('sets task status to queued and clears startedAt', () => {
      const storyId = seedStory(db, epicId);
      const taskId = insertTask(db, storyId, 'sm', 'running', {
        startedAt: new Date().toISOString(),
      });

      const config = makePipelineConfig([{ name: 'sm' }]);
      const service = new DiagnoseService(db, config);
      service.resetTask(taskId);

      const task = db.select().from(tasks).where(eq(tasks.id, taskId) as any).get()!;
      expect(task.status).toBe('queued');
      expect(task.startedAt).toBeNull();
    });

    it('increments version', () => {
      const storyId = seedStory(db, epicId);
      const taskId = insertTask(db, storyId, 'sm', 'running');
      const before = db.select().from(tasks).where(eq(tasks.id, taskId) as any).get()!;

      const config = makePipelineConfig([{ name: 'sm' }]);
      const service = new DiagnoseService(db, config);
      service.resetTask(taskId);

      const after = db.select().from(tasks).where(eq(tasks.id, taskId) as any).get()!;
      expect(after.version).toBe(before.version + 1);
    });
  });

  // ── rerouteGap ─────────────────────────────────────────────────────────

  describe('rerouteGap', () => {
    it('inserts a new task at gapNextStage with correct storyId, parentId, and input', () => {
      const storyId = seedStory(db, epicId);
      const parentTaskId = insertTask(db, storyId, 'sm', 'done', {
        output: '{"data":"result"}',
      });

      const config = makePipelineConfig([{ name: 'sm', next: 'dev' }, { name: 'dev' }]);
      const service = new DiagnoseService(db, config);
      service.rerouteGap({
        taskId: parentTaskId,
        storyId,
        storyTitle: 'Test Story',
        stageName: 'sm',
        status: 'done',
        elapsedMs: 0,
        type: 'queue_gap',
        suggestedAction: 'reroute',
        gapNextStage: 'dev',
        completedOutput: '{"data":"result"}',
      });

      const newTask = db
        .select()
        .from(tasks)
        .where(eq(tasks.stageName, 'dev') as any)
        .get();

      expect(newTask).toBeDefined();
      expect(newTask!.storyId).toBe(storyId);
      expect(newTask!.parentId).toBe(parentTaskId);
      expect(newTask!.input).toBe('{"data":"result"}');
      expect(newTask!.status).toBe('queued');
      expect(newTask!.attempt).toBe(1);
      expect(newTask!.maxAttempts).toBe(3);
    });

    it('inserts with null input when completedOutput is null', () => {
      const storyId = seedStory(db, epicId);
      const parentTaskId = insertTask(db, storyId, 'sm', 'done');

      const config = makePipelineConfig([{ name: 'sm', next: 'dev' }, { name: 'dev' }]);
      const service = new DiagnoseService(db, config);
      service.rerouteGap({
        taskId: parentTaskId,
        storyId,
        storyTitle: 'Test',
        stageName: 'sm',
        status: 'done',
        elapsedMs: 0,
        type: 'queue_gap',
        suggestedAction: 'reroute',
        gapNextStage: 'dev',
        completedOutput: null,
      });

      const newTask = db.select().from(tasks).where(eq(tasks.stageName, 'dev') as any).get();
      expect(newTask!.input).toBeNull();
    });
  });

  // ── skipTask ───────────────────────────────────────────────────────────

  describe('skipTask', () => {
    it('marks task as blocked', () => {
      const storyId = seedStory(db, epicId);
      const taskId = insertTask(db, storyId, 'sm', 'running');

      const config = makePipelineConfig([{ name: 'sm' }]);
      const service = new DiagnoseService(db, config);
      service.skipTask(taskId);

      const task = db.select().from(tasks).where(eq(tasks.id, taskId) as any).get()!;
      expect(task.status).toBe('blocked');
    });

    it('marks parent story as blocked', () => {
      const storyId = seedStory(db, epicId);
      const taskId = insertTask(db, storyId, 'sm', 'running');

      const config = makePipelineConfig([{ name: 'sm' }]);
      const service = new DiagnoseService(db, config);
      service.skipTask(taskId);

      const story = db.select().from(stories).where(eq(stories.id as any, storyId) as any).get()!;
      expect(story.status).toBe('blocked');
    });

    it('increments task version', () => {
      const storyId = seedStory(db, epicId);
      const taskId = insertTask(db, storyId, 'sm', 'running');
      const before = db.select().from(tasks).where(eq(tasks.id, taskId) as any).get()!;

      const config = makePipelineConfig([{ name: 'sm' }]);
      const service = new DiagnoseService(db, config);
      service.skipTask(taskId);

      const after = db.select().from(tasks).where(eq(tasks.id, taskId) as any).get()!;
      expect(after.version).toBe(before.version + 1);
    });
  });

  // ── autoFix ────────────────────────────────────────────────────────────

  describe('autoFix', () => {
    it('resets stuck and orphaned tasks', () => {
      const storyId = seedStory(db, epicId);
      const stuckTask = insertTask(db, storyId, 'sm', 'running', {
        startedAt: new Date(Date.now() - 10_000).toISOString(),
      });
      const orphanedTask = insertTask(db, storyId, 'dev', 'running', {
        startedAt: new Date().toISOString(),
      });

      const config = makePipelineConfig([
        { name: 'sm', timeout: 1 }, // 1s, so 10s ago is stuck
        { name: 'dev', timeout: 3600 }, // 1h, so now is orphaned
      ]);
      const service = new DiagnoseService(db, config);
      const result = service.diagnose();
      const fixed = service.autoFix(result);

      expect(fixed.resetCount).toBeGreaterThanOrEqual(1);

      const stuck = db.select().from(tasks).where(eq(tasks.id, stuckTask) as any).get()!;
      const orphaned = db.select().from(tasks).where(eq(tasks.id, orphanedTask) as any).get()!;
      expect(stuck.status).toBe('queued');
      expect(orphaned.status).toBe('queued');
    });

    it('re-routes queue gaps', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'sm', 'done', { output: 'out' });

      const config = makePipelineConfig([
        { name: 'sm', next: 'dev' },
        { name: 'dev' },
      ]);
      const service = new DiagnoseService(db, config);
      const result = service.diagnose();
      const fixed = service.autoFix(result);

      expect(fixed.reroutedCount).toBe(1);
      const devTask = db.select().from(tasks).where(eq(tasks.stageName, 'dev') as any).get();
      expect(devTask).toBeDefined();
      expect(devTask!.status).toBe('queued');
    });

    it('ignores loop_blocked tasks (no action taken)', () => {
      const storyId = seedStory(db, epicId);
      const t1 = insertTask(db, storyId, 'sm', 'done');
      const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1 });
      const t3 = insertTask(db, storyId, 'sm', 'done', { parentId: t2 });
      const t4 = insertTask(db, storyId, 'dev', 'done', { parentId: t3 });
      const t5 = insertTask(db, storyId, 'sm', 'done', { parentId: t4 });
      const t6 = insertTask(db, storyId, 'dev', 'done', { parentId: t5 });
      const t7 = insertTask(db, storyId, 'sm', 'blocked', { parentId: t6 });
      db.update(tasks).set({ status: 'blocked' }).where(eq(tasks.id, t7) as any).run();

      const config = makePipelineConfig([
        { name: 'sm', next: 'dev' },
        { name: 'dev', next: 'sm' },
      ]);
      const service = new DiagnoseService(db, config);
      const result = service.diagnose();
      const fixed = service.autoFix(result);

      expect(fixed.skippedCount).toBe(0);
      // loop_blocked task remains blocked
      const task = db.select().from(tasks).where(eq(tasks.id, t7) as any).get()!;
      expect(task.status).toBe('blocked');
    });

    it('returns zero counts when no issues', () => {
      const config = makePipelineConfig([{ name: 'sm' }]);
      const service = new DiagnoseService(db, config);
      const result = service.diagnose();
      const fixed = service.autoFix(result);

      expect(fixed).toEqual({ resetCount: 0, reroutedCount: 0, skippedCount: 0, markedDoneCount: 0 });
    });
  });

  // ── diagnose ───────────────────────────────────────────────────────────

  describe('diagnose', () => {
    it('returns correct summary counts', () => {
      const storyId = seedStory(db, epicId);
      // stuck
      insertTask(db, storyId, 'sm', 'running', {
        startedAt: new Date(Date.now() - 20_000).toISOString(),
      });
      // queue gap
      insertTask(db, storyId, 'review', 'done');

      const config = makePipelineConfig([
        { name: 'sm', timeout: 1 },
        { name: 'dev', next: 'review' },
        { name: 'review', next: 'tester' },
        { name: 'tester' },
      ]);
      const service = new DiagnoseService(db, config);
      const result = service.diagnose();

      expect(result.summary.stuckCount).toBe(1);
      expect(result.summary.queueGapCount).toBe(1);
    });
  });

  // ── findFailedAndBlockedIssues ─────────────────────────────────────────

  describe('findFailedAndBlockedIssues', () => {
    it('detects a task with status=failed, superseded=0', () => {
      const storyId = seedStory(db, epicId, 'Failed Story');
      const taskId = insertTask(db, storyId, 'dev', 'failed');

      const config = makePipelineConfig([{ name: 'dev' }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findFailedAndBlockedIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]!.type).toBe('failed');
      expect(issues[0]!.taskId).toBe(taskId);
      expect(issues[0]!.storyTitle).toBe('Failed Story');
      expect(issues[0]!.stageName).toBe('dev');
      expect(issues[0]!.suggestedAction).toBe('reset_to_queued');
    });

    it('detects a task with status=blocked, superseded=0 that is NOT loop-blocked', () => {
      const storyId = seedStory(db, epicId, 'Blocked Story');
      // Single blocked task — no loop (single task chain)
      const taskId = insertTask(db, storyId, 'review', 'blocked');

      const config = makePipelineConfig([{ name: 'review' }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findFailedAndBlockedIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]!.type).toBe('blocked');
      expect(issues[0]!.taskId).toBe(taskId);
    });

    it('does NOT return tasks with superseded=1 and status=failed', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'dev', 'failed', { superseded: 1 });

      const config = makePipelineConfig([{ name: 'dev' }]);
      const service = new DiagnoseService(db, config);
      expect(service.findFailedAndBlockedIssues()).toHaveLength(0);
    });

    it('does NOT return tasks with superseded=1 and status=blocked', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'dev', 'blocked', { superseded: 1 });

      const config = makePipelineConfig([{ name: 'dev' }]);
      const service = new DiagnoseService(db, config);
      expect(service.findFailedAndBlockedIssues()).toHaveLength(0);
    });

    it('does NOT return blocked tasks that are loop-blocked', () => {
      const storyId = seedStory(db, epicId);
      // Build a loop chain: sm → dev → sm → dev → sm → dev → sm (sm appears 4 times)
      const t1 = insertTask(db, storyId, 'sm', 'done');
      const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1 });
      const t3 = insertTask(db, storyId, 'sm', 'done', { parentId: t2 });
      const t4 = insertTask(db, storyId, 'dev', 'done', { parentId: t3 });
      const t5 = insertTask(db, storyId, 'sm', 'done', { parentId: t4 });
      const t6 = insertTask(db, storyId, 'dev', 'done', { parentId: t5 });
      const t7 = insertTask(db, storyId, 'sm', 'blocked', { parentId: t6 });

      const config = makePipelineConfig([
        { name: 'sm', next: 'dev' },
        { name: 'dev', next: 'sm' },
      ]);
      const service = new DiagnoseService(db, config);
      const issues = service.findFailedAndBlockedIssues();

      // Loop-blocked task should NOT appear in findFailedAndBlockedIssues
      expect(issues.find(i => i.taskId === t7)).toBeUndefined();
    });

    it('diagnose() summary includes failedCount and blockedCount with correct values', () => {
      const storyId = seedStory(db, epicId);
      insertTask(db, storyId, 'dev', 'failed');
      insertTask(db, storyId, 'review', 'blocked'); // non-loop blocked

      const config = makePipelineConfig([
        { name: 'dev' },
        { name: 'review' },
      ]);
      const service = new DiagnoseService(db, config);
      const result = service.diagnose();

      expect(result.summary.failedCount).toBe(1);
      expect(result.summary.blockedCount).toBe(1);
    });

    it('failedCount and blockedCount are 0 when no failed/blocked tasks', () => {
      const config = makePipelineConfig([{ name: 'sm' }]);
      const service = new DiagnoseService(db, config);
      const result = service.diagnose();

      expect(result.summary.failedCount).toBe(0);
      expect(result.summary.blockedCount).toBe(0);
    });
  });

  // ── superseded filtering ────────────────────────────────────────────────

  describe('superseded filtering', () => {
    it('findRunningIssues does not report superseded running tasks', () => {
      const storyId = seedStory(db, epicId);
      // superseded running task - should not appear
      db.insert(tasks).values({
        storyId,
        stageName: 'dev',
        status: 'running',
        superseded: 1,
        startedAt: new Date(Date.now() - 1_000_000).toISOString(),
      }).run();
      // non-superseded running task - should appear
      insertTask(db, storyId, 'sm', 'running', {
        startedAt: new Date(Date.now() - 1_000_000).toISOString(),
      });

      const config = makePipelineConfig([{ name: 'sm', timeout: 1 }, { name: 'dev', timeout: 1 }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findRunningIssues();

      const devSupersededIssues = issues.filter(i => i.stageName === 'dev' && i.storyId === storyId);
      expect(devSupersededIssues).toHaveLength(0);
      expect(issues.some(i => i.stageName === 'sm')).toBe(true);
    });

    it('findQueueGapIssues does not report gap from superseded done task', () => {
      const storyId = seedStory(db, epicId);
      // superseded done task - gap should NOT be reported from it
      db.insert(tasks).values({
        storyId,
        stageName: 'dev',
        status: 'done',
        superseded: 1,
      }).run();

      const config = makePipelineConfig([
        { name: 'dev', next: 'review' },
        { name: 'review' },
      ]);
      const service = new DiagnoseService(db, config);
      const issues = service.findQueueGapIssues();

      expect(issues).toHaveLength(0);
    });

    it('findQueueGapIssues still reports gap when next-stage task is superseded', () => {
      const storyId = seedStory(db, epicId);
      // active done task at dev
      insertTask(db, storyId, 'dev', 'done');
      // superseded next-stage task - should NOT fill the gap
      db.insert(tasks).values({
        storyId,
        stageName: 'review',
        status: 'queued',
        superseded: 1,
      }).run();

      const config = makePipelineConfig([
        { name: 'dev', next: 'review' },
        { name: 'review' },
      ]);
      const service = new DiagnoseService(db, config);
      const issues = service.findQueueGapIssues();

      expect(issues.some(i => i.type === 'queue_gap' && i.stageName === 'dev')).toBe(true);
    });

    it('findLoopBlockedIssues does not report superseded blocked tasks', () => {
      const storyId = seedStory(db, epicId);
      // superseded blocked task - should not appear
      db.insert(tasks).values({
        storyId,
        stageName: 'dev',
        status: 'blocked',
        superseded: 1,
      }).run();

      const config = makePipelineConfig([{ name: 'dev' }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findLoopBlockedIssues();

      expect(issues).toHaveLength(0);
    });

    it('detectLoop: story with many resets (chainLength > MAX_CHAIN_LENGTH but all old tasks superseded) is NOT flagged as loop_blocked', () => {
      const storyId = seedStory(db, epicId);
      // Simulate 6 resets on a 2-stage flow: each reset leaves 2 superseded tasks
      // Total: 12 superseded tasks + 1 active blocked = 13 chain items, activeChain = 1
      let parentId: number | null = null;
      for (let i = 0; i < 6; i++) {
        const t1 = insertTask(db, storyId, 'sm', 'done', { parentId, superseded: 1 });
        const t2 = insertTask(db, storyId, 'dev', 'done', { parentId: t1, superseded: 1 });
        parentId = t2;
      }
      const activeTask = insertTask(db, storyId, 'sm', 'blocked', { parentId });

      const config = makePipelineConfig([{ name: 'sm', next: 'dev' }, { name: 'dev', next: 'sm' }]);
      const service = new DiagnoseService(db, config);
      const issues = service.findLoopBlockedIssues();

      // Active chain has only 1 task — should NOT be a loop
      expect(issues.find(i => i.taskId === activeTask)).toBeUndefined();
    });
  });
});
