/**
 * Pipeline Drain Integration Tests — Story 24.2
 *
 * AC3: Routing guard — CompletionHandler skipped when drain active
 * AC4: Pipeline.drain() orchestration — correct sequence of calls and events
 * AC5: Shared DrainSignal injected into all StageWorkers
 * AC6: Backward compatibility — stop() and terminate() unaffected
 *
 * Edge cases:
 *   - drain() when shutdownState !== 'running'
 *   - cancelAllQueued returns 0
 *   - concurrent drain() calls
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------- Hoisted mock instances ----------
// Must be defined before vi.mock() factories via vi.hoisted

const mockDrainSignal = vi.hoisted(() => ({
  activate: vi.fn(),
  reset: vi.fn(),
  isDraining: vi.fn().mockReturnValue(false),
}));

const mockQueueInstance = vi.hoisted(() => ({
  dequeue: vi.fn().mockReturnValue(null),
  cancelAllQueued: vi.fn().mockReturnValue(0),
}));

// ---------- Module mocks ----------

vi.mock('@core/DrainSignal.js', () => ({
  DrainSignal: vi.fn().mockImplementation(() => mockDrainSignal),
}));

vi.mock('@core/Queue.js', () => ({
  Queue: vi.fn().mockImplementation(() => mockQueueInstance),
}));

// Shared Pipeline test infrastructure mocks
vi.mock('@workers/StageWorker.js', () => ({
  StageWorker: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({
      stageName: 'mock',
      workerIndex: 0,
      status: 'stopped',
      currentTaskId: null,
      uptime: 0,
    }),
  })),
}));

vi.mock('@workers/Router.js', () => ({
  Router: vi.fn().mockImplementation(() => ({
    routeCompletedTask: vi.fn(),
    routeRejectedTask: vi.fn().mockReturnValue('routed'),
    detectLoop: vi.fn().mockReturnValue({ isLoop: false, chainLength: 1, stageCounts: {} }),
    completeStory: vi.fn(),
  })),
}));

vi.mock('@workers/CompletionHandler.js', () => ({
  CompletionHandler: vi.fn().mockImplementation(() => ({
    handleTaskCompletion: vi.fn(),
  })),
}));

vi.mock('@workers/OutputFileManager.js', () => ({
  cleanupStaleOutputs: vi.fn(),
}));

vi.mock('@workers/TaskLogWriter.js', () => ({
  TaskLogWriter: vi.fn().mockImplementation(() => ({
    write: vi.fn(),
    flush: vi.fn(),
    drain: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@core/EventBus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  EventBus: vi.fn(),
  default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@providers/agent/ProcessManager.js', () => ({
  processManager: { killAll: vi.fn() },
  ProcessManager: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
}));

vi.mock('@core/db/schema.js', () => ({
  tasks: { id: 'id', storyId: 'story_id', stageName: 'stage_name', status: 'status', team: 'team' },
  stories: { id: 'id', status: 'status', storyKey: 'story_key', epicId: 'epic_id' },
  epics: { id: 'id', epicKey: 'epic_key' },
}));

vi.mock('@config/defaults.js', () => ({
  DEFAULT_POLL_INTERVAL: 3000,
  MAX_POLL_INTERVAL: 30000,
  BACKOFF_MULTIPLIER: 1.5,
  MAX_CHAIN_LENGTH: 10,
}));

vi.mock('@core/Errors.js', () => ({
  AgentKitError: class AgentKitError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.code = code; }
  },
  QueueError: class QueueError extends Error {
    constructor(message: string) { super(message); this.name = 'QueueError'; }
  },
}));

vi.mock('@core/StateManager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    getTaskChain: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@core/EventTypes.js', () => ({}));

vi.mock('@core/DependencyResolver.js', () => ({
  DependencyResolver: vi.fn().mockImplementation(() => ({
    resolveWaitingStories: vi.fn().mockReturnValue(0),
  })),
}));

// ---------- Imports after mocks ----------

import { Pipeline } from '@workers/Pipeline.js';
import { StageWorker } from '@workers/StageWorker.js';
import { CompletionHandler } from '@workers/CompletionHandler.js';
import { eventBus } from '@core/EventBus.js';
import { Queue } from '@core/Queue.js';
import type { StageConfig, PipelineConfig } from '@core/ConfigTypes.js';
import type { BaseProvider } from '@providers/interfaces/BaseProvider.js';

// ---------- Test helpers ----------

function createPipelineConfig(stages: StageConfig[]): PipelineConfig {
  return {
    team: 'agentkit',
    displayName: 'Test Pipeline',
    provider: 'claude-cli',
    project: { name: 'test-project' },
    stages,
    models: {
      allowed: ['opus', 'sonnet', 'haiku'],
      resolved: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
    },
  };
}

function createMockProvider(): BaseProvider {
  return {
    name: 'mock-provider',
    type: 'agent',
    capabilities: { streaming: true, nativeToolUse: false, supportedModels: ['sonnet'] },
    execute: vi.fn().mockImplementation(async function* () {}),
    isAvailable: vi.fn().mockResolvedValue(true),
    validateConfig: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  };
}

function createMockDb() {
  const runFn = vi.fn().mockReturnValue({ changes: 0 });
  const getFn = vi.fn().mockReturnValue(undefined);
  const allFn = vi.fn().mockReturnValue([]);
  const whereFn = vi.fn().mockReturnValue({ run: runFn, get: getFn, all: allFn });
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  return {
    update: updateFn,
    select: selectFn,
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({
      update: updateFn,
    })),
  };
}

const defaultStages: StageConfig[] = [
  { name: 'sm', displayName: 'SM', icon: '📋', prompt: 'sm.md', timeout: 300000, workers: 1, retries: 3, next: 'dev' },
  { name: 'dev', displayName: 'Dev', icon: '🔨', prompt: 'dev.md', timeout: 300000, workers: 1, retries: 3, next: 'review' },
  { name: 'review', displayName: 'Review', icon: '👁', prompt: 'review.md', timeout: 300000, workers: 1, retries: 3, next: 'tester', reject_to: 'dev' },
  { name: 'tester', displayName: 'Tester', icon: '🧪', prompt: 'tester.md', timeout: 300000, workers: 2, retries: 3, reject_to: 'dev' },
];

/** Capture the task:completed listener registered via eventBus.on() */
function captureTaskCompletedListener(): ((event: unknown) => void) | undefined {
  const onCalls = vi.mocked(eventBus.on).mock.calls;
  const entry = onCalls.find(([event]) => event === 'task:completed');
  return entry?.[1] as ((event: unknown) => void) | undefined;
}

function makeFakeTaskCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 100,
    storyId: 1,
    stageName: 'dev',
    status: 'completed',
    durationMs: 500,
    ...overrides,
  };
}

// ---------- Tests ----------

describe('Pipeline drain()', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    // Reset drainSignal mock to default (not draining)
    mockDrainSignal.isDraining.mockReturnValue(false);
    mockDrainSignal.activate.mockClear();
    mockDrainSignal.reset.mockClear();
    mockQueueInstance.cancelAllQueued.mockReturnValue(0);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('uncaughtException');
  });

  // -----------------------------------------------------------------------
  // AC3 — Routing guard: CompletionHandler NOT called during drain
  // -----------------------------------------------------------------------

  describe('AC3 — routing guard during drain', () => {
    it('should NOT call CompletionHandler.handleTaskCompletion when drainSignal is active', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      // Capture the listener Pipeline registered for task:completed
      const listener = captureTaskCompletedListener();
      expect(listener).toBeDefined();

      // Simulate drain active
      mockDrainSignal.isDraining.mockReturnValue(true);

      // Fire task:completed while drain is active
      listener!(makeFakeTaskCompletedEvent());

      // CompletionHandler should NOT have been invoked
      const handlerInstance = vi.mocked(CompletionHandler).mock.results[0]?.value as {
        handleTaskCompletion: ReturnType<typeof vi.fn>;
      };
      expect(handlerInstance.handleTaskCompletion).not.toHaveBeenCalled();

      await pipeline.stop();
    });

    it('should call CompletionHandler.handleTaskCompletion when drain is NOT active (baseline)', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      const listener = captureTaskCompletedListener();
      expect(listener).toBeDefined();

      // Drain NOT active
      mockDrainSignal.isDraining.mockReturnValue(false);

      listener!(makeFakeTaskCompletedEvent());

      const handlerInstance = vi.mocked(CompletionHandler).mock.results[0]?.value as {
        handleTaskCompletion: ReturnType<typeof vi.fn>;
      };
      expect(handlerInstance.handleTaskCompletion).toHaveBeenCalledOnce();
      expect(handlerInstance.handleTaskCompletion).toHaveBeenCalledWith(100, 1, 'dev');

      await pipeline.stop();
    });

    it('should return early from listener (not throw) when drain is active', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      const listener = captureTaskCompletedListener();
      mockDrainSignal.isDraining.mockReturnValue(true);

      // Should not throw
      expect(() => listener!(makeFakeTaskCompletedEvent())).not.toThrow();

      await pipeline.stop();
    });

    it('should NOT route task when drain fires DURING task completion (drain guard takes priority over shutdownState check)', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      const listener = captureTaskCompletedListener();

      // Both drain AND shutdown active — drain guard should fire first
      mockDrainSignal.isDraining.mockReturnValue(true);
      // Note: shutdownState is still 'running' at this point

      listener!(makeFakeTaskCompletedEvent({ taskId: 200, storyId: 5, stageName: 'review' }));

      const handlerInstance = vi.mocked(CompletionHandler).mock.results[0]?.value as {
        handleTaskCompletion: ReturnType<typeof vi.fn>;
      };
      expect(handlerInstance.handleTaskCompletion).not.toHaveBeenCalled();

      await pipeline.stop();
    });
  });

  // -----------------------------------------------------------------------
  // AC4 — Pipeline.drain() orchestration
  // -----------------------------------------------------------------------

  describe('AC4 — drain() orchestration sequence', () => {
    it('should activate drainSignal as the first action', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      vi.mocked(eventBus.emit).mockClear();

      let activateCalledBeforeEmit = false;
      mockDrainSignal.activate.mockImplementationOnce(() => {
        activateCalledBeforeEmit = vi.mocked(eventBus.emit).mock.calls.length === 0;
      });

      await pipeline.drain();

      expect(mockDrainSignal.activate).toHaveBeenCalledTimes(1);
      expect(activateCalledBeforeEmit).toBe(true);
    });

    it('should emit pipeline:draining event with projectId and timestamp', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      vi.mocked(eventBus.emit).mockClear();

      await pipeline.drain();

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:draining',
        expect.objectContaining({
          timestamp: expect.any(String),
          projectId: expect.any(Number),
        }),
      );
    });

    it('should call stop() on all StageWorker instances', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.drain();

      const workerInstances = vi.mocked(StageWorker).mock.results;
      expect(workerInstances.length).toBeGreaterThan(0);
      for (const result of workerInstances) {
        const worker = result.value as { stop: ReturnType<typeof vi.fn> };
        expect(worker.stop).toHaveBeenCalledTimes(1);
      }
    });

    it('should call Queue.cancelAllQueued with the active team name', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      vi.mocked(Queue).mockClear(); // reset to track only drain()'s Queue construction

      await pipeline.drain();

      // Queue should have been constructed in drain()
      expect(vi.mocked(Queue)).toHaveBeenCalled();
      expect(mockQueueInstance.cancelAllQueued).toHaveBeenCalledWith('agentkit');
    });

    it('should reset drainSignal after workers stop and tasks cancelled', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.drain();

      expect(mockDrainSignal.reset).toHaveBeenCalledTimes(1);
    });

    it('should emit pipeline:stop event at the end', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      vi.mocked(eventBus.emit).mockClear();

      await pipeline.drain();

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:stop',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it('should call cleanup — removing task:completed listener from eventBus', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      vi.mocked(eventBus.off).mockClear();

      await pipeline.drain();

      expect(vi.mocked(eventBus.off)).toHaveBeenCalledWith('task:completed', expect.any(Function));
    });

    it('should emit pipeline:draining BEFORE pipeline:stop', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      vi.mocked(eventBus.emit).mockClear();

      await pipeline.drain();

      const emitCalls = vi.mocked(eventBus.emit).mock.calls.map(([event]) => event);
      const drainingIdx = emitCalls.indexOf('pipeline:draining');
      const stopIdx = emitCalls.indexOf('pipeline:stop');

      expect(drainingIdx).toBeGreaterThanOrEqual(0);
      expect(stopIdx).toBeGreaterThanOrEqual(0);
      expect(drainingIdx).toBeLessThan(stopIdx);
    });

    it('should await all workers stopping before cancelling queued tasks', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      const workerStopOrder: string[] = [];
      const workerInstances = vi.mocked(StageWorker).mock.results;
      for (const [i, result] of workerInstances.entries()) {
        const worker = result.value as { stop: ReturnType<typeof vi.fn> };
        worker.stop.mockImplementationOnce(() => {
          workerStopOrder.push(`worker-${i}`);
          return Promise.resolve();
        });
      }

      mockQueueInstance.cancelAllQueued.mockImplementationOnce(() => {
        workerStopOrder.push('cancelAllQueued');
        return 0;
      });

      await pipeline.drain();

      // cancelAllQueued must come after all worker stops
      const cancelIdx = workerStopOrder.indexOf('cancelAllQueued');
      const workerStops = workerStopOrder.filter(s => s.startsWith('worker-'));
      expect(workerStops.length).toBeGreaterThan(0);
      for (const _ of workerStops) {
        const workerIdx = workerStopOrder.indexOf(_);
        expect(workerIdx).toBeLessThan(cancelIdx);
      }
    });

    it('should drain TaskLogWriter after workers stop', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.drain();

      const { TaskLogWriter } = await import('@workers/TaskLogWriter.js');
      const writerInstance = vi.mocked(TaskLogWriter).mock.results[0]?.value as {
        drain: ReturnType<typeof vi.fn>;
      };
      // Called at minimum once during drain (may also be called during stop())
      expect(writerInstance.drain).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // AC5 — Shared DrainSignal injected into all StageWorkers
  // -----------------------------------------------------------------------

  describe('AC5 — shared DrainSignal injection into StageWorkers', () => {
    it('should pass the same DrainSignal instance to every StageWorker constructor', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      // StageWorker constructor: (config, db, provider, eventBus, taskLogWriter, drainSignal)
      const stageWorkerCalls = vi.mocked(StageWorker).mock.calls;
      expect(stageWorkerCalls.length).toBeGreaterThan(0);

      // Every worker should receive an argument at position 5 (drainSignal)
      const drainSignalArgs = stageWorkerCalls.map(call => call[5]);

      // All should be the same reference (the Pipeline-owned DrainSignal)
      for (let i = 1; i < drainSignalArgs.length; i++) {
        expect(drainSignalArgs[i]).toBe(drainSignalArgs[0]);
      }

      // The injected instance should be the mockDrainSignal (since DrainSignal is mocked)
      expect(drainSignalArgs[0]).toBe(mockDrainSignal);

      await pipeline.stop();
    });

    it('should inject DrainSignal into all 5 workers of default pipeline config', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      // sm:1 + dev:1 + review:1 + tester:2 = 5 workers
      expect(vi.mocked(StageWorker).mock.calls).toHaveLength(5);

      const stageWorkerCalls = vi.mocked(StageWorker).mock.calls;
      for (const call of stageWorkerCalls) {
        // 6th arg (index 5) must be the DrainSignal
        expect(call[5]).toBe(mockDrainSignal);
      }

      await pipeline.stop();
    });
  });

  // -----------------------------------------------------------------------
  // AC6 — Backward compatibility: stop() and terminate() unaffected
  // -----------------------------------------------------------------------

  describe('AC6 — backward compatibility', () => {
    it('should NOT call drainSignal.activate() when stop() is called', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.stop();

      expect(mockDrainSignal.activate).not.toHaveBeenCalled();
    });

    it('should NOT call drainSignal.activate() when terminate() is called', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.terminate();

      expect(mockDrainSignal.activate).not.toHaveBeenCalled();
    });

    it('stop() still emits pipeline:stop event (unchanged behavior)', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      vi.mocked(eventBus.emit).mockClear();

      await pipeline.stop();

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:stop',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it('stop() still stops all workers (unchanged behavior)', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.stop();

      const workerInstances = vi.mocked(StageWorker).mock.results;
      for (const result of workerInstances) {
        const worker = result.value as { stop: ReturnType<typeof vi.fn> };
        expect(worker.stop).toHaveBeenCalledTimes(1);
      }
    });

    it('terminate() still emits pipeline:terminated event (unchanged behavior)', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.terminate();

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:terminated',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it('terminate() sets shutdownState to terminated (unchanged behavior)', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.terminate();

      expect(pipeline.getShutdownState()).toBe('terminated');
    });

    it('stop() does NOT call Queue.cancelAllQueued', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      vi.mocked(Queue).mockClear();
      mockQueueInstance.cancelAllQueued.mockClear();

      await pipeline.stop();

      // Queue should not be instantiated or called during stop()
      expect(mockQueueInstance.cancelAllQueued).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('should return early without activating drain when shutdownState is not running (already stopped)', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      await pipeline.stop(); // now not 'running'

      mockDrainSignal.activate.mockClear();
      vi.mocked(eventBus.emit).mockClear();

      await pipeline.drain();

      expect(mockDrainSignal.activate).not.toHaveBeenCalled();
      expect(vi.mocked(eventBus.emit)).not.toHaveBeenCalledWith(
        'pipeline:draining',
        expect.anything(),
      );
    });

    it('should return early without activating drain when shutdownState is not running (terminated)', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      await pipeline.terminate(); // shutdownState = 'terminated'

      mockDrainSignal.activate.mockClear();
      vi.mocked(eventBus.emit).mockClear();

      await pipeline.drain();

      expect(mockDrainSignal.activate).not.toHaveBeenCalled();
    });

    it('should complete drain normally when Queue.cancelAllQueued returns 0 (no pending tasks)', async () => {
      mockQueueInstance.cancelAllQueued.mockReturnValue(0);

      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await expect(pipeline.drain()).resolves.toBeUndefined();

      // Should still emit pipeline:stop
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:stop',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it('should complete drain normally when Queue.cancelAllQueued returns positive count', async () => {
      mockQueueInstance.cancelAllQueued.mockReturnValue(7);

      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await expect(pipeline.drain()).resolves.toBeUndefined();

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:stop',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it('should be safe when drain() called concurrently — drainSignal.activate() is idempotent', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      // Both calls complete without error; activate() may be called once or twice
      // (idempotent by design — draining=true is safe to set multiple times).
      // The spec only requires no crash and a valid final state; the shutdownState
      // guard does NOT prevent concurrent calls since drain() does not change it.
      const [result1, result2] = await Promise.all([pipeline.drain(), pipeline.drain()]);

      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
      // pipeline:stop must have been emitted at least once
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:stop',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it('should not throw when drain() is called on a pipeline that was never started', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      // Pipeline not started — shutdownState is 'running' (default), workers = [].
      // drain() will execute (guard passes) and emit pipeline:stop with no workers to stop.
      await expect(pipeline.drain()).resolves.toBeUndefined();

      // drainSignal activates and resets even with no workers
      expect(mockDrainSignal.activate).toHaveBeenCalledTimes(1);
      expect(mockDrainSignal.reset).toHaveBeenCalledTimes(1);
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:stop',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it('should not throw when drain() is called on a pipeline with a single worker stage', async () => {
      const singleStage: StageConfig[] = [
        { name: 'dev', displayName: 'Dev', icon: '🔨', prompt: 'dev.md', timeout: 300000, workers: 1, retries: 3 },
      ];

      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(singleStage),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await expect(pipeline.drain()).resolves.toBeUndefined();

      expect(mockDrainSignal.activate).toHaveBeenCalledTimes(1);
      expect(mockDrainSignal.reset).toHaveBeenCalledTimes(1);
    });
  });
});
