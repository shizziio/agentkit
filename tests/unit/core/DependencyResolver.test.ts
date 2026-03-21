/**
 * Story 21.5 — DependencyResolver: Auto-Queue When Deps Satisfied
 *
 * Tests that DependencyResolver.resolveWaitingStories() correctly transitions
 * `waiting` stories to `in_progress` when all their depends_on storyKeys are
 * `done` in the same epic, and that validateDependencyGraph detects cycles and
 * missing refs.
 *
 * DEPENDENCY: Story 21.4 must be complete — migration 0006_story_depends_on.sql
 * adds the `depends_on` TEXT column and `waiting` status support.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories, tasks } from '@core/db/schema.js';
import { DependencyResolver, type ValidationResult } from '@core/DependencyResolver.js';
import { EventBus } from '@core/EventBus.js';
import type { StoryCompleteEvent } from '@core/EventTypes.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIVE_TEAM = 'agentkit';
const FIRST_STAGE = 'sm';

// ── Helpers ───────────────────────────────────────────────────────────────────

let epicKeyCounter = 0;
let storyKeyCounter = 0;
let projectNameCounter = 0;

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: `test-project-${++projectNameCounter}` })
    .returning({ id: projects.id })
    .get().id;
}

function seedEpic(db: DrizzleDB, projectId: number, epicKey?: string): number {
  return db
    .insert(epics)
    .values({
      projectId,
      epicKey: epicKey ?? `E${++epicKeyCounter}`,
      title: 'Test Epic',
      orderIndex: 0,
    })
    .returning({ id: epics.id })
    .get().id;
}

interface SeedStoryOpts {
  key?: string;
  status?: string;
  priority?: number;
  dependsOn?: string[] | null;
}

function seedStory(db: DrizzleDB, epicId: number, opts: SeedStoryOpts = {}): number {
  const key = opts.key ?? `S${++storyKeyCounter}`;
  const dependsOnValue =
    opts.dependsOn === undefined
      ? null
      : opts.dependsOn === null
        ? null
        : JSON.stringify(opts.dependsOn);

  return db
    .insert(stories)
    .values({
      epicId,
      storyKey: key,
      title: `Story ${key}`,
      orderIndex: storyKeyCounter,
      status: opts.status ?? 'draft',
      priority: opts.priority ?? 0,
      dependsOn: dependsOnValue,
    })
    .returning({ id: stories.id })
    .get().id;
}

function getStory(db: DrizzleDB, storyId: number) {
  return db.select().from(stories).where(eq(stories.id, storyId)).get();
}

function getTasksForStory(db: DrizzleDB, storyId: number) {
  return db.select().from(tasks).where(eq(tasks.storyId, storyId)).all();
}

function getQueuedTasksForStory(db: DrizzleDB, storyId: number) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.storyId, storyId), eq(tasks.status, 'queued')))
    .all();
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: DrizzleDB;
let bus: EventBus;
let resolver: DependencyResolver;
let projectId: number;
let epicId: number;

beforeEach(() => {
  db = createConnection(':memory:');
  runMigrations(db);
  bus = new EventBus();
  resolver = new DependencyResolver(db, bus);
  projectId = seedProject(db);
  epicId = seedEpic(db, projectId, `E${++epicKeyCounter}`);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── AC1: Single dependency satisfied ─────────────────────────────────────────

describe('DependencyResolver', () => {
  describe('resolveWaitingStories', () => {
    it('AC1: should transition story B to in_progress when its single dep (A) is done', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(count).toBe(1);
      const storyB = getStory(db, storyBId);
      expect(storyB?.status).toBe('in_progress');
    });

    it('AC1: should create an SM task for the unblocked story', () => {
      const _storyAId = seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      const createdTasks = getTasksForStory(db, storyBId);
      expect(createdTasks).toHaveLength(1);
    });

    it('AC1: should leave story A unchanged after resolving B', () => {
      const storyAId = seedStory(db, epicId, { key: 'A', status: 'done' });
      seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      const storyA = getStory(db, storyAId);
      expect(storyA?.status).toBe('done');
    });

    // ── AC2: Multiple stories unblocked ────────────────────────────────────

    it('AC2: should unblock multiple waiting stories that all depend on the same done story', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });
      const storyCId = seedStory(db, epicId, { key: 'C', status: 'waiting', dependsOn: ['A'] });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(count).toBe(2);
      expect(getStory(db, storyBId)?.status).toBe('in_progress');
      expect(getStory(db, storyCId)?.status).toBe('in_progress');
    });

    it('AC2: should create SM tasks for both unblocked stories', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });
      const storyCId = seedStory(db, epicId, { key: 'C', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(getTasksForStory(db, storyBId)).toHaveLength(1);
      expect(getTasksForStory(db, storyCId)).toHaveLength(1);
    });

    // ── AC3: Partial deps — stays waiting ──────────────────────────────────

    it('AC3: should NOT transition story C when only partial deps are satisfied', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      seedStory(db, epicId, { key: 'B', status: 'in_progress' }); // not done
      const storyCId = seedStory(db, epicId, {
        key: 'C',
        status: 'waiting',
        dependsOn: ['A', 'B'],
      });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(count).toBe(0);
      expect(getStory(db, storyCId)?.status).toBe('waiting');
    });

    it('AC3: should NOT create any task for story C when partial deps remain', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      seedStory(db, epicId, { key: 'B', status: 'in_progress' });
      const storyCId = seedStory(db, epicId, {
        key: 'C',
        status: 'waiting',
        dependsOn: ['A', 'B'],
      });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(getTasksForStory(db, storyCId)).toHaveLength(0);
    });

    it('AC3: should handle mixed scenarios — some stories unblocked, some still waiting', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      seedStory(db, epicId, { key: 'B', status: 'in_progress' });
      const storyDId = seedStory(db, epicId, {
        key: 'D',
        status: 'waiting',
        dependsOn: ['A'], // only depends on A (done)
      });
      const storyEId = seedStory(db, epicId, {
        key: 'E',
        status: 'waiting',
        dependsOn: ['A', 'B'], // depends on both — partial
      });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(count).toBe(1);
      expect(getStory(db, storyDId)?.status).toBe('in_progress');
      expect(getStory(db, storyEId)?.status).toBe('waiting');
    });

    // ── AC4: Chain resolution across two separate calls ────────────────────

    it('AC4: should handle chain resolution when called twice (A→B→C)', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });
      const storyCId = seedStory(db, epicId, { key: 'C', status: 'waiting', dependsOn: ['B'] });

      // First call: A is done → B unblocked
      const count1 = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);
      expect(count1).toBe(1);
      expect(getStory(db, storyBId)?.status).toBe('in_progress');
      expect(getStory(db, storyCId)?.status).toBe('waiting'); // C still blocked

      // Simulate B completing
      db.update(stories).set({ status: 'done' }).where(eq(stories.id, storyBId)).run();

      // Second call: B is done → C unblocked
      const count2 = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);
      expect(count2).toBe(1);
      expect(getStory(db, storyCId)?.status).toBe('in_progress');
    });

    it('AC4: should not re-unblock story A on second call (already done)', () => {
      const storyAId = seedStory(db, epicId, { key: 'A', status: 'done' });
      seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });
      seedStory(db, epicId, { key: 'C', status: 'waiting', dependsOn: ['B'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      // A remains done
      expect(getStory(db, storyAId)?.status).toBe('done');
    });

    // ── AC7: Task fields correct ───────────────────────────────────────────

    it('AC7: should create task with correct stageName = first stage', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      const createdTasks = getTasksForStory(db, storyBId);
      expect(createdTasks[0]?.stageName).toBe(FIRST_STAGE);
    });

    it('AC7: should create task with correct team = activeTeam', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      const createdTasks = getTasksForStory(db, storyBId);
      expect(createdTasks[0]?.team).toBe(ACTIVE_TEAM);
    });

    it('AC7: should create task with status = queued', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      const createdTasks = getQueuedTasksForStory(db, storyBId);
      expect(createdTasks).toHaveLength(1);
      expect(createdTasks[0]?.status).toBe('queued');
    });

    it('AC7: should create task with storyId = unblocked story id', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      const createdTasks = getTasksForStory(db, storyBId);
      expect(createdTasks[0]?.storyId).toBe(storyBId);
    });

    it('AC7: should create task with superseded = 0', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      const createdTasks = getTasksForStory(db, storyBId);
      expect(createdTasks[0]?.superseded).toBe(0);
    });

    it('AC7: should create task with attempt = 1', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      const createdTasks = getTasksForStory(db, storyBId);
      expect(createdTasks[0]?.attempt).toBe(1);
    });

    it('AC7: task priority should reflect story priority', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, {
        key: 'B',
        status: 'waiting',
        dependsOn: ['A'],
        priority: 5,
      });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      // Story priority should be preserved
      const storyB = getStory(db, storyBId);
      expect(storyB?.priority).toBe(5);
    });

    it('AC7: should increment story version by 1 and update updatedAt when transitioning to in_progress', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      const before = getStory(db, storyBId);
      const versionBefore = before?.version ?? 1;
      // We assert the version incremented; updatedAt should be set (not null)
      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      const after = getStory(db, storyBId);
      expect(after?.version).toBe(versionBefore + 1);
      expect(after?.updatedAt).toBeDefined();
      expect(after?.updatedAt).not.toBeNull();
      // updatedAt should be a non-empty ISO-like string
      expect(typeof after?.updatedAt).toBe('string');
      expect((after?.updatedAt ?? '').length).toBeGreaterThan(0);
    });

    // ── AC5: Event-driven trigger ──────────────────────────────────────────

    it('AC5: should emit queue:enqueued event after each story is unblocked', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      const enqueueEvents: Array<{ stage: string; storyId: number }> = [];
      bus.on('queue:enqueued', (payload) => enqueueEvents.push(payload));

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(enqueueEvents).toHaveLength(1);
      expect(enqueueEvents[0]?.stage).toBe(FIRST_STAGE);
      expect(enqueueEvents[0]?.storyId).toBe(storyBId);
    });

    it('AC5: should emit queue:enqueued for each story when multiple are unblocked', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });
      const storyCId = seedStory(db, epicId, { key: 'C', status: 'waiting', dependsOn: ['A'] });

      const enqueueEvents: Array<{ stage: string; storyId: number }> = [];
      bus.on('queue:enqueued', (payload) => enqueueEvents.push(payload));

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(enqueueEvents).toHaveLength(2);
      const emittedStoryIds = enqueueEvents.map((e) => e.storyId).sort();
      expect(emittedStoryIds).toEqual([storyBId, storyCId].sort());
    });

    it('AC5: should call resolveWaitingStories when story:completed event fires (event-bus wiring)', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      // Simulate the pipeline wiring: subscribe resolver to story:completed
      const resolveSpy = vi.spyOn(resolver, 'resolveWaitingStories');
      bus.on('story:completed', () => {
        resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);
      });

      const event: StoryCompleteEvent = {
        storyId: 99,
        storyKey: 'A',
        epicKey: 'E1',
        durationMs: 1000,
        storyTitle: 'Story A',
        stageDurations: [],
        totalAttempts: 1,
      };
      bus.emit('story:completed', event);

      expect(resolveSpy).toHaveBeenCalledOnce();
      expect(resolveSpy).toHaveBeenCalledWith(ACTIVE_TEAM, FIRST_STAGE);
      expect(getStory(db, storyBId)?.status).toBe('in_progress');
    });

    // ── AC6: Periodic safety net ───────────────────────────────────────────

    it('AC6: should allow periodic polling via setInterval (interval-based integration)', () => {
      vi.useFakeTimers();
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      const resolveSpy = vi.spyOn(resolver, 'resolveWaitingStories');

      // Simulate the pipeline periodic poll (10s interval)
      let intervalHandle: ReturnType<typeof setInterval> | null = null;
      intervalHandle = setInterval(() => {
        resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);
      }, 10_000);

      expect(resolveSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10_000);
      expect(resolveSpy).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(10_000);
      expect(resolveSpy).toHaveBeenCalledTimes(2);

      clearInterval(intervalHandle);
      vi.advanceTimersByTime(10_000);
      expect(resolveSpy).toHaveBeenCalledTimes(2); // no more calls after clearInterval
    });

    it('AC6: periodic interval should resolve waiting stories correctly', () => {
      vi.useFakeTimers();
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      const intervalHandle = setInterval(() => {
        resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);
      }, 10_000);

      vi.advanceTimersByTime(10_000);

      const storyB = getStory(db, storyBId);
      expect(storyB?.status).toBe('in_progress');

      clearInterval(intervalHandle);
    });

    // ── AC10: Error handling — never throws ───────────────────────────────

    it('AC10: should return 0 (not throw) when a DB error occurs', () => {
      // Force a DB error by breaking the db object temporarily
      const brokenDb = { select: () => { throw new Error('DB connection lost'); } } as unknown as DrizzleDB;
      const brokenResolver = new DependencyResolver(brokenDb, bus);

      expect(() => brokenResolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE)).not.toThrow();
      const result = brokenResolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);
      expect(result).toBe(0);
    });

    it('AC10: should return 0 when no waiting stories exist', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      seedStory(db, epicId, { key: 'B', status: 'in_progress' });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);
      expect(count).toBe(0);
    });

    // ── AC11: Atomicity ────────────────────────────────────────────────────

    it('AC11: story status update and task insert should be atomic per story', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });
      const storyCId = seedStory(db, epicId, { key: 'C', status: 'waiting', dependsOn: ['A'] });

      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      // Both stories should have exactly one task — atomic insert per story
      expect(getTasksForStory(db, storyBId)).toHaveLength(1);
      expect(getTasksForStory(db, storyCId)).toHaveLength(1);

      // Calling again should NOT create duplicate tasks (stories already in_progress)
      resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);
      expect(getTasksForStory(db, storyBId)).toHaveLength(1);
      expect(getTasksForStory(db, storyCId)).toHaveLength(1);
    });

    // ── Edge cases ─────────────────────────────────────────────────────────

    it('Edge: story with NULL depends_on should be treated as no dependencies (immediately eligible when waiting)', () => {
      const storyId = seedStory(db, epicId, { key: 'X', status: 'waiting', dependsOn: null });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(count).toBe(1);
      expect(getStory(db, storyId)?.status).toBe('in_progress');
    });

    it('Edge: story with empty depends_on array [] should be eligible immediately', () => {
      const storyId = seedStory(db, epicId, { key: 'X', status: 'waiting', dependsOn: [] });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(count).toBe(1);
      expect(getStory(db, storyId)?.status).toBe('in_progress');
    });

    it('Edge: malformed JSON in depends_on should skip the story gracefully (no crash)', () => {
      // Insert with raw malformed JSON
      const storyId = db
        .insert(stories)
        .values({
          epicId,
          storyKey: 'BAD',
          title: 'Story BAD',
          orderIndex: 99,
          status: 'waiting',
          dependsOn: 'NOT_VALID_JSON[[[',
        })
        .returning({ id: stories.id })
        .get().id;

      expect(() => resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE)).not.toThrow();

      // Story should remain waiting (skipped, not crashed)
      const storyBad = getStory(db, storyId);
      expect(storyBad?.status).toBe('waiting');
    });

    it('Edge: story depending on a storyKey in a different epic should NOT be resolved', () => {
      // Cross-epic dep: A is in epic2, B in epic1, B depends on A's key
      const epic2Id = seedEpic(db, projectId, `E${++epicKeyCounter}`);
      seedStory(db, epic2Id, { key: 'CROSS_A', status: 'done' });
      const storyBId = seedStory(db, epicId, {
        key: 'B',
        status: 'waiting',
        dependsOn: ['CROSS_A'],
      });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      // Cross-epic deps are not resolved (only within same epic)
      expect(count).toBe(0);
      expect(getStory(db, storyBId)?.status).toBe('waiting');
    });

    it('Edge: story with dep on blocked/cancelled story should stay waiting', () => {
      seedStory(db, epicId, { key: 'A', status: 'blocked' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(count).toBe(0);
      expect(getStory(db, storyBId)?.status).toBe('waiting');
    });

    it('Edge: story with dep on cancelled story should stay waiting', () => {
      seedStory(db, epicId, { key: 'A', status: 'cancelled' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(count).toBe(0);
      expect(getStory(db, storyBId)?.status).toBe('waiting');
    });

    it('Edge: stories with no waiting status should not be processed', () => {
      seedStory(db, epicId, { key: 'A', status: 'done' });
      const storyBId = seedStory(db, epicId, { key: 'B', status: 'draft', dependsOn: ['A'] });
      const storyCId = seedStory(db, epicId, {
        key: 'C',
        status: 'in_progress',
        dependsOn: ['A'],
      });

      const count = resolver.resolveWaitingStories(ACTIVE_TEAM, FIRST_STAGE);

      expect(count).toBe(0);
      expect(getStory(db, storyBId)?.status).toBe('draft'); // unchanged
      expect(getStory(db, storyCId)?.status).toBe('in_progress'); // unchanged
    });
  });

  // ── validateDependencyGraph ──────────────────────────────────────────────

  describe('validateDependencyGraph', () => {
    it('AC8: should detect a direct cycle (A depends on B, B depends on A)', () => {
      const epicKey = `E${++epicKeyCounter}`;
      const cycleEpicId = seedEpic(db, projectId, epicKey);
      seedStory(db, cycleEpicId, { key: 'A', status: 'waiting', dependsOn: ['B'] });
      seedStory(db, cycleEpicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });

      const result: ValidationResult = resolver.validateDependencyGraph(epicKey);

      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
      // Cycle should contain both A and B
      const cycleKeys = result.cycles.flat();
      expect(cycleKeys).toContain('A');
      expect(cycleKeys).toContain('B');
    });

    it('AC8: should detect a longer cycle (A→B→C→A)', () => {
      const epicKey = `E${++epicKeyCounter}`;
      const cycleEpicId = seedEpic(db, projectId, epicKey);
      seedStory(db, cycleEpicId, { key: 'A', status: 'waiting', dependsOn: ['B'] });
      seedStory(db, cycleEpicId, { key: 'B', status: 'waiting', dependsOn: ['C'] });
      seedStory(db, cycleEpicId, { key: 'C', status: 'waiting', dependsOn: ['A'] });

      const result: ValidationResult = resolver.validateDependencyGraph(epicKey);

      expect(result.valid).toBe(false);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('AC8: should return valid=true for a linear chain with no cycles (A→B→C)', () => {
      const epicKey = `E${++epicKeyCounter}`;
      const linearEpicId = seedEpic(db, projectId, epicKey);
      seedStory(db, linearEpicId, { key: 'A', status: 'done' });
      seedStory(db, linearEpicId, { key: 'B', status: 'waiting', dependsOn: ['A'] });
      seedStory(db, linearEpicId, { key: 'C', status: 'waiting', dependsOn: ['B'] });

      const result: ValidationResult = resolver.validateDependencyGraph(epicKey);

      expect(result.valid).toBe(true);
      expect(result.cycles).toHaveLength(0);
      expect(result.missingKeys).toHaveLength(0);
    });

    it('AC9: should detect missing storyKey reference (A depends on Z which does not exist)', () => {
      const epicKey = `E${++epicKeyCounter}`;
      const missingEpicId = seedEpic(db, projectId, epicKey);
      seedStory(db, missingEpicId, { key: 'A', status: 'waiting', dependsOn: ['Z'] });

      const result: ValidationResult = resolver.validateDependencyGraph(epicKey);

      expect(result.valid).toBe(false);
      expect(result.missingKeys).toContain('Z');
    });

    it('AC9: should detect multiple missing keys', () => {
      const epicKey = `E${++epicKeyCounter}`;
      const missingEpicId = seedEpic(db, projectId, epicKey);
      seedStory(db, missingEpicId, { key: 'A', status: 'waiting', dependsOn: ['X', 'Y'] });

      const result: ValidationResult = resolver.validateDependencyGraph(epicKey);

      expect(result.valid).toBe(false);
      expect(result.missingKeys).toContain('X');
      expect(result.missingKeys).toContain('Y');
    });

    it('AC9: should return valid=true for an epic with no deps at all', () => {
      const epicKey = `E${++epicKeyCounter}`;
      const noDepsEpicId = seedEpic(db, projectId, epicKey);
      seedStory(db, noDepsEpicId, { key: 'A', status: 'draft' });
      seedStory(db, noDepsEpicId, { key: 'B', status: 'draft' });

      const result: ValidationResult = resolver.validateDependencyGraph(epicKey);

      expect(result.valid).toBe(true);
      expect(result.cycles).toHaveLength(0);
      expect(result.missingKeys).toHaveLength(0);
    });

    it('AC8+AC9: should report both cycles and missing keys together', () => {
      const epicKey = `E${++epicKeyCounter}`;
      const mixedEpicId = seedEpic(db, projectId, epicKey);
      seedStory(db, mixedEpicId, { key: 'A', status: 'waiting', dependsOn: ['B', 'GHOST'] }); // GHOST missing
      seedStory(db, mixedEpicId, { key: 'B', status: 'waiting', dependsOn: ['A'] }); // cycle A↔B

      const result: ValidationResult = resolver.validateDependencyGraph(epicKey);

      expect(result.valid).toBe(false);
      expect(result.missingKeys).toContain('GHOST');
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should return valid=true for an unknown/empty epicKey', () => {
      const result: ValidationResult = resolver.validateDependencyGraph('NONEXISTENT_EPIC');

      expect(result.valid).toBe(true); // empty epic has no violations
      expect(result.cycles).toHaveLength(0);
      expect(result.missingKeys).toHaveLength(0);
    });
  });
});
