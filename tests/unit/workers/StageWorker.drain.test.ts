/**
 * StageWorker Drain Integration Tests — Story 24.2
 *
 * AC1: Worker idle drain — exits poll loop before dequeue when drain activated
 * AC2: Worker in-flight drain — completes current task then stops
 * AC5: DrainSignal injected as 6th constructor parameter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StageWorker } from '@workers/StageWorker.js';
import { DrainSignal } from '@core/DrainSignal.js';
import type { StageWorkerConfig } from '@workers/StageWorkerTypes.js';
import type { BaseProvider } from '@providers/interfaces/BaseProvider.js';
import { EventBus } from '@core/EventBus.js';
import type { StreamEvent } from '@core/EventTypes.js';
import type { TaskLogWriter } from '@workers/TaskLogWriter.js';
import { Queue } from '@core/Queue.js';

// ---------- Module mocks (mirrors StageWorker.test.ts) ----------

vi.mock('@workers/PromptLoader.js', () => ({
  loadPrompt: vi.fn().mockReturnValue('mock prompt template'),
  injectInput: vi.fn().mockReturnValue('mock full prompt'),
  InjectInputOptions: {},
}));

vi.mock('@workers/OutputFileManager.js', () => ({
  getOutputPath: vi.fn().mockReturnValue('/mock/project/_agent_kit/.outputs/task-1.json'),
  ensureOutputDir: vi.fn(),
  readOutputFile: vi.fn().mockReturnValue({ success: false, error: 'OUTPUT_FILE_MISSING' }),
  deleteOutputFile: vi.fn(),
}));

vi.mock('@core/Queue.js', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    dequeue: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

vi.mock('@core/db/schema.js', () => ({
  tasks: { id: 'id' },
  stories: { id: 'id' },
}));

// ---------- Test helpers ----------

function createMockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    storyId: 10,
    parentId: null,
    team: 'agentkit',
    stageName: 'dev',
    status: 'running' as const,
    prompt: null,
    input: '{"code": "test"}',
    output: null,
    workerModel: null,
    inputTokens: null,
    outputTokens: null,
    attempt: 1,
    maxAttempts: 3,
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

function createMockProvider(events: StreamEvent[] = []): BaseProvider {
  return {
    name: 'mock-provider',
    type: 'agent',
    capabilities: { streaming: true, nativeToolUse: false, supportedModels: ['sonnet'] },
    execute: vi.fn().mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    validateConfig: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  };
}

function createSuccessEvents(): StreamEvent[] {
  return [
    {
      taskId: 1,
      type: 'text',
      stageName: 'dev',
      timestamp: Date.now(),
      data: { text: '```json\n{"result":"ok"}\n```' },
    },
    {
      taskId: 1,
      type: 'done',
      stageName: 'dev',
      timestamp: Date.now(),
      data: {},
    },
  ];
}

function createMockTaskLogWriter(): TaskLogWriter {
  return {
    write: vi.fn(),
    flush: vi.fn(),
    drain: vi.fn().mockResolvedValue(undefined),
  } as unknown as TaskLogWriter;
}

function createMockDb() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ title: 'Mock Story', content: 'Mock Content', sessionInfo: null }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          run: vi.fn(),
        }),
      }),
    }),
    transaction: vi.fn().mockImplementation((fn: (tx: Record<string, unknown>) => void) => {
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              run: vi.fn(),
            }),
          }),
        }),
      };
      fn(tx);
      return tx;
    }),
  };
}

const defaultConfig: StageWorkerConfig = {
  stageName: 'dev',
  workerIndex: 0,
  projectRoot: '/mock/project',
  pollInterval: 100,
  maxPollInterval: 1000,
  backoffMultiplier: 1.5,
  model: 'sonnet',
  timeout: 60000,
  promptPath: 'agentkit/prompts/dev.md',
  activeTeam: 'agentkit',
};

// ---------- Tests ----------

describe('StageWorker drain integration', () => {
  let eventBus: EventBus;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockTaskLogWriter: TaskLogWriter;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    mockDb = createMockDb();
    mockTaskLogWriter = createMockTaskLogWriter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('AC5 — DrainSignal constructor injection', () => {
    it('should accept a DrainSignal instance as the 6th constructor parameter without error', () => {
      const drainSignal = new DrainSignal();
      const provider = createMockProvider();

      expect(() => {
        new StageWorker(
          defaultConfig,
          mockDb as never,
          provider,
          eventBus,
          mockTaskLogWriter,
          drainSignal,
        );
      }).not.toThrow();
    });

    it('should use the injected DrainSignal instance — activating it externally controls the worker', async () => {
      const drainSignal = new DrainSignal();
      const provider = createMockProvider();
      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        drainSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(0); // first poll

      const callsBefore = mockQueue.dequeue.mock.calls.length;

      // Activate the SAME injected signal — worker should stop polling
      drainSignal.activate();
      await vi.advanceTimersByTimeAsync(300); // well past backoff delay

      expect(mockQueue.dequeue.mock.calls.length).toBe(callsBefore);

      await worker.stop();
    });

    it('should NOT stop polling if a DIFFERENT DrainSignal instance is activated', async () => {
      const injectedSignal = new DrainSignal();
      const otherSignal = new DrainSignal();
      const provider = createMockProvider();
      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        injectedSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(0); // first poll

      // Activate a DIFFERENT signal — should have no effect
      otherSignal.activate();
      await vi.advanceTimersByTimeAsync(200);

      // Worker should still be polling
      expect(mockQueue.dequeue.mock.calls.length).toBeGreaterThan(1);

      await worker.stop();
    });
  });

  describe('AC1 — worker idle drain (poll loop exits before dequeue)', () => {
    it('should break poll loop before calling dequeue when drainSignal is activated while idle', async () => {
      const drainSignal = new DrainSignal();
      const provider = createMockProvider();
      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        drainSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValue(null);

      worker.start();

      // First dequeue at t=0 (returns null, backoff starts)
      await vi.advanceTimersByTimeAsync(0);
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(1);

      // Activate drain — next iteration should break before dequeue
      drainSignal.activate();

      // Advance past backoff delay (100ms * 1.5 = 150ms)
      await vi.advanceTimersByTimeAsync(200);

      // dequeue must NOT have been called again
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(1);

      await worker.stop();
    });

    it('should stop polling after drain activation even if activated during backoff sleep', async () => {
      const drainSignal = new DrainSignal();
      const provider = createMockProvider();
      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        drainSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(0); // first poll → backoff sleep begins

      // Activate drain DURING the backoff sleep
      drainSignal.activate();

      // Advance past backoff — delay resolves, drain check fires → break
      await vi.advanceTimersByTimeAsync(200);

      // No further dequeue calls
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(1);

      await worker.stop();
    });

    it('should NOT dequeue any task after drain is activated', async () => {
      const drainSignal = new DrainSignal();
      const provider = createMockProvider();
      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        drainSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };

      // Queue has a task waiting, but drain fires before dequeue
      drainSignal.activate(); // activate BEFORE worker starts

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      // dequeue should never be called since drain is already active
      expect(mockQueue.dequeue).not.toHaveBeenCalled();

      await worker.stop();
    });
  });

  describe('AC2 — worker in-flight drain (current task completes then worker stops)', () => {
    it('should complete current task normally when drain activates mid-execution', async () => {
      const drainSignal = new DrainSignal();
      const completedEvents: unknown[] = [];
      eventBus.on('task:completed', (e) => completedEvents.push(e));

      const provider: BaseProvider = {
        name: 'mock-provider',
        type: 'agent',
        capabilities: { streaming: true, nativeToolUse: false, supportedModels: ['sonnet'] },
        execute: vi.fn().mockImplementation(async function* () {
          // Activate drain DURING task execution
          drainSignal.activate();
          yield {
            taskId: 1,
            type: 'text' as const,
            stageName: 'dev',
            timestamp: Date.now(),
            data: { text: '```json\n{"result":"ok"}\n```' },
          };
          yield {
            taskId: 1,
            type: 'done' as const,
            stageName: 'dev',
            timestamp: Date.now(),
            data: {},
          };
        }),
        isAvailable: vi.fn().mockResolvedValue(true),
        validateConfig: vi.fn().mockReturnValue({ valid: true, errors: [] }),
      };

      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        drainSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      // Task MUST have completed — drain does not abort in-progress work
      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0]).toMatchObject({
        taskId: 1,
        stageName: 'dev',
        status: 'completed',
      });

      await worker.stop();
    });

    it('should NOT dequeue a second task after completing current task with drain active', async () => {
      const drainSignal = new DrainSignal();

      const provider: BaseProvider = {
        name: 'mock-provider',
        type: 'agent',
        capabilities: { streaming: true, nativeToolUse: false, supportedModels: ['sonnet'] },
        execute: vi.fn().mockImplementation(async function* () {
          drainSignal.activate(); // activate during execution
          yield {
            taskId: 1,
            type: 'text' as const,
            stageName: 'dev',
            timestamp: Date.now(),
            data: { text: '```json\n{"result":"ok"}\n```' },
          };
          yield {
            taskId: 1,
            type: 'done' as const,
            stageName: 'dev',
            timestamp: Date.now(),
            data: {},
          };
        }),
        isAvailable: vi.fn().mockResolvedValue(true),
        validateConfig: vi.fn().mockReturnValue({ valid: true, errors: [] }),
      };

      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        drainSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      // First dequeue returns a task, subsequent would return more — but drain should prevent them
      mockQueue.dequeue
        .mockReturnValueOnce(createMockTask())
        .mockReturnValueOnce(createMockTask({ id: 2 })) // should NOT be dequeued
        .mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      // First task is processed, drain fires after it completes → loop breaks
      // dequeue should have been called exactly once (for task#1)
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(1);

      // Advance more time to confirm no additional polling
      await vi.advanceTimersByTimeAsync(500);
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(1);

      await worker.stop();
    });

    it('should update task status to done in DB when drain fires mid-execution', async () => {
      const drainSignal = new DrainSignal();

      const provider: BaseProvider = {
        name: 'mock-provider',
        type: 'agent',
        capabilities: { streaming: true, nativeToolUse: false, supportedModels: ['sonnet'] },
        execute: vi.fn().mockImplementation(async function* () {
          drainSignal.activate();
          yield {
            taskId: 1,
            type: 'text' as const,
            stageName: 'dev',
            timestamp: Date.now(),
            data: { text: '```json\n{"result":"ok"}\n```' },
          };
          yield {
            taskId: 1,
            type: 'done' as const,
            stageName: 'dev',
            timestamp: Date.now(),
            data: {},
          };
        }),
        isAvailable: vi.fn().mockResolvedValue(true),
        validateConfig: vi.fn().mockReturnValue({ valid: true, errors: [] }),
      };

      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        drainSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      // DB should have been updated with status='done'
      expect(mockDb.transaction).toHaveBeenCalled();
      const txResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = txResults[txResults.length - 1]?.value;
      const setCall = lastTx.update.mock.results[0]?.value.set;
      expect(setCall).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'done' }),
      );

      await worker.stop();
    });
  });

  describe('stop() backward compatibility (AC6 from worker perspective)', () => {
    it('should still stop normally via stop() when no DrainSignal is involved', async () => {
      const drainSignal = new DrainSignal(); // NOT activated
      const provider = createMockProvider();
      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        drainSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      await worker.stop();

      expect(worker.getStatus().status).toBe('stopped');
    });

    it('should complete an in-progress task when stop() is called (no drain involved)', async () => {
      const drainSignal = new DrainSignal(); // NOT activated
      const completedEvents: unknown[] = [];
      eventBus.on('task:completed', (e) => completedEvents.push(e));

      const provider = createMockProvider(createSuccessEvents());
      const worker = new StageWorker(
        defaultConfig,
        mockDb as never,
        provider,
        eventBus,
        mockTaskLogWriter,
        drainSignal,
      );
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      await worker.stop();

      expect(completedEvents).toHaveLength(1);
      expect(worker.getStatus().status).toBe('stopped');
    });
  });
});
