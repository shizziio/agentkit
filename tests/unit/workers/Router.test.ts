import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from '@workers/Router';
import type { StageConfig } from '@core/ConfigTypes';
import type { TaskChainItem } from '@core/QueueTypes';
import { eventBus } from '@core/EventBus';

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

// Mock schema
vi.mock('@core/db/schema.js', () => ({
  tasks: { id: 'id', storyId: 'story_id', stageName: 'stage_name', status: 'status' },
  stories: { id: 'id', status: 'status' },
}));

// Mock EventBus
vi.mock('@core/EventBus.js', () => {
  const emitFn = vi.fn();
  return {
    eventBus: { emit: emitFn, on: vi.fn(), off: vi.fn() },
    EventBus: vi.fn(),
    default: { emit: emitFn, on: vi.fn(), off: vi.fn() },
  };
});

// Mock StateManager
const mockGetTaskChain = vi.fn<() => TaskChainItem[]>().mockReturnValue([]);
vi.mock('@core/StateManager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    getTaskChain: mockGetTaskChain,
  })),
}));

// Mock defaults
vi.mock('@config/defaults.js', () => ({
  MAX_CHAIN_LENGTH: 10,
}));

function createMockDb() {
  const runFn = vi.fn();
  const whereFn = vi.fn().mockReturnValue({ run: runFn });
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });
  const valuesFn = vi.fn().mockReturnValue({ run: runFn });
  const insertFn = vi.fn().mockReturnValue({ values: valuesFn });

  // Select chain for Router.completeStory queries
  const getFn = vi.fn().mockReturnValue(undefined);
  const allFn = vi.fn().mockReturnValue([]);
  const selectWhereFn = vi.fn().mockReturnValue({ run: runFn, get: getFn, all: allFn });
  const fromFn = vi.fn().mockReturnValue({ where: selectWhereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  const _allFn = allFn;

  const txRunFn = vi.fn();
  const txWhereFn = vi.fn().mockReturnValue({ run: txRunFn });
  const txSetFn = vi.fn().mockReturnValue({ where: txWhereFn });
  const txUpdateFn = vi.fn().mockReturnValue({ set: txSetFn });
  const txValuesFn = vi.fn().mockReturnValue({ run: txRunFn });
  const txInsertFn = vi.fn().mockReturnValue({ values: txValuesFn });

  const tx = {
    update: txUpdateFn,
    insert: txInsertFn,
  };

  const transactionFn = vi.fn().mockImplementation((cb: (t: typeof tx) => void) => {
    return cb(tx);
  });

  return {
    select: selectFn,
    update: updateFn,
    insert: insertFn,
    transaction: transactionFn,
    _tx: tx,
    _txInsertFn: txInsertFn,
    _txValuesFn: txValuesFn,
    _txUpdateFn: txUpdateFn,
    _allFn,
  };
}

function makeStageConfig(overrides: Partial<StageConfig> = {}): StageConfig {
  return {
    name: 'dev',
    displayName: 'Developer',
    icon: '🔨',
    prompt: 'agentkit/prompts/dev.md',
    timeout: 300000,
    workers: 1,
    retries: 3,
    ...overrides,
  };
}

function makeChainItem(overrides: Partial<TaskChainItem> = {}): TaskChainItem {
  return {
    id: 1,
    storyId: 10,
    parentId: null,
    stageName: 'dev',
    status: 'done',
    createdAt: new Date().toISOString(),
    superseded: false,
    ...overrides,
  };
}

describe('Router', () => {
  let router: Router;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    router = new Router(mockDb as never, 'agentkit');
  });

  describe('routeCompletedTask', () => {
    it('creates new task at next stage in a transaction', () => {
      const stageConfig = makeStageConfig({ next: 'review' });
      const task = { id: 1, storyId: 10, output: '{"result":"ok"}', attempt: 1, maxAttempts: 3, team: 'agentkit' };

      router.routeCompletedTask(task, stageConfig);

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(mockDb._txUpdateFn).toHaveBeenCalled();
      expect(mockDb._txInsertFn).toHaveBeenCalled();
      expect(mockDb._txValuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          storyId: 10,
          parentId: 1,
          stageName: 'review',
          status: 'queued',
          input: '{"result":"ok"}',
          attempt: 1,
        }),
      );
    });

    it('propagates team field from task to the newly inserted next-stage task', () => {
      const stageConfig = makeStageConfig({ next: 'review' });
      const task = { id: 2, storyId: 11, output: '{}', attempt: 1, maxAttempts: 3, team: 'alpha-team' };

      router.routeCompletedTask(task, stageConfig);

      expect(mockDb._txValuesFn).toHaveBeenCalledWith(
        expect.objectContaining({ team: 'alpha-team' }),
      );
    });

    it('does nothing when no next stage defined', () => {
      const stageConfig = makeStageConfig({ next: undefined });
      const task = { id: 1, storyId: 10, output: '{}', attempt: 1, maxAttempts: 3, team: 'agentkit' };

      router.routeCompletedTask(task, stageConfig);

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  describe('routeRejectedTask', () => {
    it('creates new task at reject_to with incremented attempt', () => {
      const stageConfig = makeStageConfig({ name: 'review', reject_to: 'dev' });
      const task = { id: 5, storyId: 10, output: '{"result":"CHANGES_REQUESTED"}', attempt: 1, maxAttempts: 3, team: 'agentkit' };

      const result = router.routeRejectedTask(task, stageConfig);

      expect(result).toBe('routed');
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(mockDb._txValuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          stageName: 'dev',
          parentId: 5,
          attempt: 2,
          status: 'queued',
        }),
      );
    });

    it('propagates team field from task to the newly inserted reject_to task', () => {
      const stageConfig = makeStageConfig({ name: 'review', reject_to: 'dev' });
      const task = { id: 6, storyId: 12, output: '{}', attempt: 1, maxAttempts: 3, team: 'beta-team' };

      const result = router.routeRejectedTask(task, stageConfig);

      expect(result).toBe('routed');
      expect(mockDb._txValuesFn).toHaveBeenCalledWith(
        expect.objectContaining({ team: 'beta-team' }),
      );
    });

    it('returns blocked without DB changes when attempt >= maxAttempts (caller handles atomically)', () => {
      const stageConfig = makeStageConfig({ name: 'review', reject_to: 'dev' });
      const task = { id: 5, storyId: 10, output: '{}', attempt: 3, maxAttempts: 3, team: 'agentkit' };

      const result = router.routeRejectedTask(task, stageConfig);

      expect(result).toBe('blocked');
      // Task and story blocking is handled atomically by CompletionHandler.blockStoryAndTask
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('returns blocked when no reject_to defined', () => {
      const stageConfig = makeStageConfig({ name: 'review', reject_to: undefined });
      const task = { id: 5, storyId: 10, output: '{}', attempt: 1, maxAttempts: 3, team: 'agentkit' };

      const result = router.routeRejectedTask(task, stageConfig);

      expect(result).toBe('blocked');
    });
  });

  describe('detectLoop', () => {
    it('returns isLoop=false for normal chains', () => {
      mockGetTaskChain.mockReturnValue([
        makeChainItem({ id: 1, stageName: 'sm' }),
        makeChainItem({ id: 2, stageName: 'dev', parentId: 1 }),
        makeChainItem({ id: 3, stageName: 'review', parentId: 2 }),
      ]);

      const info = router.detectLoop(3);

      expect(info.isLoop).toBe(false);
      expect(info.chainLength).toBe(3);
    });

    it('returns isLoop=true when chain length >= MAX_CHAIN_LENGTH (10)', () => {
      const chain: TaskChainItem[] = [];
      for (let i = 1; i <= 10; i++) {
        chain.push(makeChainItem({
          id: i,
          stageName: i % 2 === 0 ? 'dev' : 'review',
          parentId: i > 1 ? i - 1 : null,
        }));
      }
      mockGetTaskChain.mockReturnValue(chain);

      const info = router.detectLoop(10);

      expect(info.isLoop).toBe(true);
      expect(info.reason).toContain('chain length');
    });

    it('returns isLoop=true when same stage appears > 5 times', () => {
      const chain: TaskChainItem[] = [];
      for (let i = 1; i <= 6; i++) {
        chain.push(makeChainItem({
          id: i,
          stageName: 'dev',
          parentId: i > 1 ? i - 1 : null,
        }));
      }
      mockGetTaskChain.mockReturnValue(chain);

      const info = router.detectLoop(6);

      expect(info.isLoop).toBe(true);
      expect(info.reason).toContain('dev');
      expect(info.reason).toContain('6');
    });

    it('excludes superseded tasks from stage repeat counts and chain length detection', () => {
      // Chain has 4 'dev' stages but 3 are superseded - only 1 active 'dev'
      mockGetTaskChain.mockReturnValue([
        makeChainItem({ id: 1, stageName: 'dev', superseded: true }),
        makeChainItem({ id: 2, stageName: 'dev', superseded: true }),
        makeChainItem({ id: 3, stageName: 'dev', superseded: true }),
        makeChainItem({ id: 4, stageName: 'dev', parentId: 3, superseded: false }),
        makeChainItem({ id: 5, stageName: 'review', parentId: 4, superseded: false }),
      ]);

      const info = router.detectLoop(5);

      expect(info.isLoop).toBe(false);
      // chainLength is total including superseded
      expect(info.chainLength).toBe(5);
    });

    it('superseded tasks do not trigger false chain-length loop detection', () => {
      // 8 superseded + 1 active = 9 total, active chain = 1, should not be loop
      const chain = [];
      for (let i = 1; i <= 8; i++) {
        chain.push(makeChainItem({ id: i, stageName: 'dev', superseded: true, parentId: i > 1 ? i - 1 : null }));
      }
      chain.push(makeChainItem({ id: 9, stageName: 'dev', superseded: false, parentId: 8 }));
      mockGetTaskChain.mockReturnValue(chain);

      const info = router.detectLoop(9);

      expect(info.isLoop).toBe(false);
    });

    it('returns isLoop=false when stage appears exactly 3 times', () => {
      mockGetTaskChain.mockReturnValue([
        makeChainItem({ id: 1, stageName: 'dev' }),
        makeChainItem({ id: 2, stageName: 'review', parentId: 1 }),
        makeChainItem({ id: 3, stageName: 'dev', parentId: 2 }),
        makeChainItem({ id: 4, stageName: 'review', parentId: 3 }),
        makeChainItem({ id: 5, stageName: 'dev', parentId: 4 }),
      ]);

      const info = router.detectLoop(5);

      expect(info.isLoop).toBe(false);
    });
  });

  describe('completeStory', () => {
    it('updates story status and emits event', () => {
      const task = { id: 1, storyId: 10 };

      router.completeStory(task, 'story-1.1', 'epic-1');

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'story:completed',
        expect.objectContaining({
          storyId: 10,
          storyKey: 'story-1.1',
          epicKey: 'epic-1',
        }),
      );
    });

    it('excludes superseded tasks from totalAttempts in story:completed event', () => {
      const task = { id: 5, storyId: 10 };
      // Return 3 tasks: 2 done active, 1 done superseded — only active ones count
      mockDb._allFn.mockReturnValueOnce([
        { stageName: 'sm', durationMs: 100, status: 'done', superseded: 0 },
        { stageName: 'dev', durationMs: 200, status: 'done', superseded: 0 },
        { stageName: 'dev', durationMs: 500, status: 'done', superseded: 1 },
      ]);

      router.completeStory(task, 'story-2.1', 'epic-1');

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'story:completed',
        expect.objectContaining({
          totalAttempts: 2,
          durationMs: 300, // 100 + 200, excludes superseded 500
        }),
      );
    });
  });

  describe('transaction atomicity', () => {
    it('routeCompletedTask performs update and insert in same transaction', () => {
      const stageConfig = makeStageConfig({ next: 'review' });
      const task = { id: 1, storyId: 10, output: '{}', attempt: 1, maxAttempts: 3, team: 'agentkit' };

      router.routeCompletedTask(task, stageConfig);

      // Verify both operations happen inside the transaction callback
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      const txCallback = mockDb.transaction.mock.calls[0]?.[0];
      expect(txCallback).toBeDefined();
      // tx.update and tx.insert were called (verified by _tx references)
      expect(mockDb._txUpdateFn).toHaveBeenCalled();
      expect(mockDb._txInsertFn).toHaveBeenCalled();
    });
  });
});
