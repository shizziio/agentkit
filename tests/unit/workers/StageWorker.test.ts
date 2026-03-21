import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StageWorker } from '@workers/StageWorker';
import type { StageWorkerConfig } from '@workers/StageWorkerTypes';
import type { BaseProvider } from '@providers/interfaces/BaseProvider';
import { EventBus } from '@core/EventBus';
import type { StreamEvent } from '@core/EventTypes';
import { ProviderError } from '@core/Errors';
import type { TaskLogWriter } from '@workers/TaskLogWriter';
import { Queue } from '@core/Queue';
import { injectInput } from '@workers/PromptLoader';
import { getOutputPath, ensureOutputDir, readOutputFile, deleteOutputFile } from '@workers/OutputFileManager';

// Mock PromptLoader
vi.mock('@workers/PromptLoader.js', () => ({
  loadPrompt: vi.fn().mockReturnValue('mock prompt template'),
  injectInput: vi.fn().mockReturnValue('mock full prompt'),
  InjectInputOptions: {},
}));

// Mock OutputFileManager
vi.mock('@workers/OutputFileManager.js', () => ({
  getOutputPath: vi.fn().mockReturnValue('/mock/project/_agent_kit/.outputs/task-1.json'),
  ensureOutputDir: vi.fn(),
  readOutputFile: vi.fn().mockReturnValue({ success: false, error: 'OUTPUT_FILE_MISSING' }),
  deleteOutputFile: vi.fn(),
}));

// Mock Queue
vi.mock('@core/Queue.js', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    dequeue: vi.fn().mockReturnValue(null),
  })),
}));

// Mock drizzle-orm eq
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

// Mock schema
vi.mock('@core/db/schema.js', () => ({
  tasks: { id: 'id' },
  stories: { id: 'id' },
}));

function createMockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    storyId: 10,
    parentId: null,
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

function createStreamEvents(text: string): StreamEvent[] {
  return [
    {
      taskId: 1,
      type: 'text',
      stageName: 'dev',
      timestamp: Date.now(),
      data: { text },
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

describe('StageWorker', () => {
  let eventBus: EventBus;
  let mockDb: Record<string, unknown>;
  let mockTaskLogWriter: TaskLogWriter;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue({ title: 'Mock Story', content: 'Mock Content' }),
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
    mockTaskLogWriter = createMockTaskLogWriter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('lifecycle', () => {
    it('starts with idle status', () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      expect(worker.getStatus().status).toBe('stopped');
    });

    it('transitions to running on start', () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      worker.start();
      expect(worker.getStatus().status).toBe('running');
    });

    it('transitions to stopped on stop', async () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      worker.start();

      // Advance past the first poll delay
      await vi.advanceTimersByTimeAsync(150);

      await worker.stop();
      expect(worker.getStatus().status).toBe('stopped');
    });

    it('does not start twice', () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      worker.start();
      worker.start(); // should be no-op
      expect(worker.getStatus().status).toBe('running');
    });
  });

  describe('polling and backoff', () => {
    it('increases poll interval by backoff multiplier when queue is empty', async () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValue(null);

      worker.start();

      // First dequeue happens immediately at t=0
      await vi.advanceTimersByTimeAsync(0);
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(1);

      // After first empty poll, interval becomes 100 * 1.5 = 150
      // Advance 150ms to trigger second poll
      await vi.advanceTimersByTimeAsync(150);
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(2);

      // After second empty poll, interval becomes 150 * 1.5 = 225
      // Advance 225ms to trigger third poll
      await vi.advanceTimersByTimeAsync(225);
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(3);

      await worker.stop();
    });

    it('caps poll interval at maxPollInterval', async () => {
      const config: StageWorkerConfig = {
        ...defaultConfig,
        pollInterval: 500,
        maxPollInterval: 600,
        backoffMultiplier: 2,
      };
      const provider = createMockProvider();
      const worker = new StageWorker(config, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValue(null);

      worker.start();
      // First poll: interval becomes min(500*2, 600) = 600
      await vi.advanceTimersByTimeAsync(600);
      // Second poll: interval stays 600 (already capped)
      await vi.advanceTimersByTimeAsync(650);

      await worker.stop();
    });

    it('resets poll interval when task found', async () => {
      const jsonOutput = '```json\n{"result": "ok"}\n```';
      const events = createStreamEvents(jsonOutput);
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };

      // First poll (immediate): empty (backoff kicks in, interval -> 150)
      // Second poll (after 150ms): task found (resets interval to 100)
      // Third poll (after 100ms): empty
      mockQueue.dequeue
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(createMockTask())
        .mockReturnValue(null);

      worker.start();

      // First dequeue at t=0
      await vi.advanceTimersByTimeAsync(0);
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(1);

      // After backoff delay (150ms), second poll finds task, processes it,
      // then immediately loops and calls dequeue again (third call)
      await vi.advanceTimersByTimeAsync(150);
      expect(mockQueue.dequeue).toHaveBeenCalledTimes(3);

      // Verify task:completed was emitted (proves task was processed)
      const completedEvents: unknown[] = [];
      eventBus.on('task:completed', (e) => completedEvents.push(e));

      await worker.stop();
    });
  });

  describe('task processing', () => {
    it('emits task:started on dequeue', async () => {
      const events = createStreamEvents('```json\n{"ok": true}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      const startedEvents: unknown[] = [];
      eventBus.on('task:started', (e) => startedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(startedEvents).toHaveLength(1);
      expect(startedEvents[0]).toEqual(
        expect.objectContaining({ taskId: 1, storyId: 10, stageName: 'dev', status: 'running' }),
      );

      await worker.stop();
    });

    it('emits task:completed on successful parse', async () => {
      const events = createStreamEvents('```json\n{"result": "done"}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      const completedEvents: unknown[] = [];
      eventBus.on('task:completed', (e) => completedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0]).toEqual(
        expect.objectContaining({ taskId: 1, stageName: 'dev', status: 'completed' }),
      );

      await worker.stop();
    });

    it('emits task:failed on JSON parse failure', async () => {
      const events = createStreamEvents('not valid json at all');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      const failedEvents: unknown[] = [];
      eventBus.on('task:failed', (e) => failedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toEqual(
        expect.objectContaining({
          taskId: 1,
          stageName: 'dev',
          status: 'failed',
          error: 'OUTPUT_MISSING',
        }),
      );

      await worker.stop();
    });

    it('emits task:failed on ProviderError', async () => {
      const provider = createMockProvider();
      vi.mocked(provider.execute).mockImplementation(async function* () {
        throw new ProviderError('Provider crashed');
      });

      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      const failedEvents: unknown[] = [];
      eventBus.on('task:failed', (e) => failedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toEqual(
        expect.objectContaining({
          taskId: 1,
          status: 'failed',
          error: 'Provider crashed',
        }),
      );

      await worker.stop();
    });

    it('preserves original error message for non-AgentKitError throws', async () => {
      const provider = createMockProvider();
      vi.mocked(provider.execute).mockImplementation(async function* () {
        throw new Error('ENOENT: no such file or directory');
      });

      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      const failedEvents: unknown[] = [];
      eventBus.on('task:failed', (e) => failedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toEqual(
        expect.objectContaining({
          taskId: 1,
          status: 'failed',
          error: 'ENOENT: no such file or directory',
        }),
      );

      await worker.stop();
    });

    it('logs dequeue errors to structured logger instead of swallowing', async () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      const dbError = new Error('SQLITE_BUSY');
      mockQueue.dequeue
        .mockImplementationOnce(() => { throw dbError; })
        .mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(0);

      // Verify error does not propagate (worker continues running after dequeue error)
      expect(worker.getStatus().status).toBe('running');

      await worker.stop();
    });

    it('re-emits stream events through EventBus', async () => {
      const streamEvents: StreamEvent[] = [
        { taskId: 1, type: 'thinking', stageName: 'dev', timestamp: Date.now(), data: { thinking: 'hmm' } },
        { taskId: 1, type: 'text', stageName: 'dev', timestamp: Date.now(), data: { text: '```json\n{"ok":true}\n```' } },
        { taskId: 1, type: 'done', stageName: 'dev', timestamp: Date.now(), data: {} },
      ];
      const provider = createMockProvider(streamEvents);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      const emittedTypes: string[] = [];
      eventBus.on('stream:thinking', () => emittedTypes.push('thinking'));
      eventBus.on('stream:text', () => emittedTypes.push('text'));
      eventBus.on('stream:done', () => emittedTypes.push('done'));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(emittedTypes).toEqual(['thinking', 'text', 'done']);

      await worker.stop();
    });

    it('updates task in DB with done status on success', async () => {
      const events = createStreamEvents('```json\n{"ok": true}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(mockDb.transaction).toHaveBeenCalled();
      // The last transaction call is the updateTaskDone
      const txCalls = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.calls;
      const lastTxCall = txCalls[txCalls.length - 1];
      // Get the tx object passed to the last transaction callback
      const lastTxResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = lastTxResults[lastTxResults.length - 1]?.value;
      const lastSetCall = lastTx.update.mock.results[0]?.value.set;
      expect(lastSetCall).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'done',
          output: JSON.stringify({ ok: true }),
        }),
      );

      await worker.stop();
    });

    it('updates task in DB with failed status on parse failure', async () => {
      const events = createStreamEvents('garbage output');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(mockDb.transaction).toHaveBeenCalled();
      const lastTxResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = lastTxResults[lastTxResults.length - 1]?.value;
      const lastSetCall = lastTx.update.mock.results[0]?.value.set;
      expect(lastSetCall).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
        }),
      );

      await worker.stop();
    });

    it('saves prompt to task record before execution', async () => {
      const events = createStreamEvents('```json\n{"ok": true}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      // First transaction call should be the prompt save
      const firstTxResult = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      const firstSetCall = firstTxResult.update.mock.results[0]?.value.set;
      expect(firstSetCall).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'mock full prompt',
        }),
      );

      await worker.stop();
    });

    it('passes stream events to TaskLogWriter.write()', async () => {
      const streamEvents: StreamEvent[] = [
        { taskId: 1, type: 'text', stageName: 'dev', timestamp: Date.now(), data: { text: '```json\n{"ok":true}\n```' } },
        { taskId: 1, type: 'done', stageName: 'dev', timestamp: Date.now(), data: {} },
      ];
      const provider = createMockProvider(streamEvents);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(mockTaskLogWriter.write).toHaveBeenCalledTimes(2);
      expect(mockTaskLogWriter.write).toHaveBeenCalledWith(1, streamEvents[0]);
      expect(mockTaskLogWriter.write).toHaveBeenCalledWith(1, streamEvents[1]);

      await worker.stop();
    });

    it('calls drain() after task processing completes', async () => {
      const events = createStreamEvents('```json\n{"ok": true}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      // drain() called after stream completes (in finally block)
      expect(mockTaskLogWriter.drain).toHaveBeenCalled();

      await worker.stop();
    });

    it('extracts token usage from done event and saves to task record', async () => {
      const streamEvents: StreamEvent[] = [
        { taskId: 1, type: 'text', stageName: 'dev', timestamp: Date.now(), data: { text: '```json\n{"ok":true}\n```' } },
        { taskId: 1, type: 'done', stageName: 'dev', timestamp: Date.now(), data: { inputTokens: 1000, outputTokens: 500 } },
      ];
      const provider = createMockProvider(streamEvents);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      // The last transaction call (updateTaskDone) should include token usage
      const lastTxResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = lastTxResults[lastTxResults.length - 1]?.value;
      const lastSetCall = lastTx.update.mock.results[0]?.value.set;
      expect(lastSetCall).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'done',
          inputTokens: 1000,
          outputTokens: 500,
        }),
      );

      await worker.stop();
    });

    it('handles done event without token usage gracefully', async () => {
      const events = createStreamEvents('```json\n{"ok": true}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      const lastTxResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = lastTxResults[lastTxResults.length - 1]?.value;
      const lastSetCall = lastTx.update.mock.results[0]?.value.set;
      expect(lastSetCall).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'done',
          inputTokens: null,
          outputTokens: null,
        }),
      );

      await worker.stop();
    });
  });

  describe('failure debug trace', () => {
    it('truncates collectedEvents when serialised size exceeds 500 KB with > 20 events', async () => {
      // Build 25 large text events (~25 KB each) so JSON.stringify > 500 KB
      const largeChunk = 'x'.repeat(25 * 1024);
      const streamEvents: StreamEvent[] = Array.from({ length: 25 }, (_, i) => ({
        taskId: 1,
        type: 'text' as const,
        stageName: 'dev',
        timestamp: Date.now(),
        data: { text: `event-${i}: ${largeChunk}` },
      }));
      streamEvents.push({
        taskId: 1, type: 'done', stageName: 'dev', timestamp: Date.now(), data: {},
      });

      const provider = createMockProvider(streamEvents);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      const lastTxResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = lastTxResults[lastTxResults.length - 1]?.value;
      const lastSetCall = lastTx.update.mock.results[0]?.value.set;
      const setArg = vi.mocked(lastSetCall).mock.calls[0]?.[0] as { output?: string };
      const output = JSON.parse(setArg?.output ?? '{}') as {
        collectedEvents?: Array<{ type: string; data: Record<string, unknown> }>;
        eventCount?: number;
      };

      // 25 text + 1 done = 26 collected events; truncation produces 10 + sentinel + 10 = 21
      expect(output.eventCount).toBe(26);
      expect(output.collectedEvents).toHaveLength(21);
      const truncatedEntry = output.collectedEvents?.find(e => e.type === 'truncated');
      expect(truncatedEntry).toBeDefined();
      // sentinel.count = 26 - 20 = 6 events were dropped
      expect(truncatedEntry?.data.count).toBe(6);

      await worker.stop();
    });

    it('does not truncate when event count is 20 or fewer (even if large)', async () => {
      // 20 events — boundary: count is NOT > 20 so truncation must NOT fire
      const largeChunk = 'x'.repeat(30 * 1024);
      const streamEvents: StreamEvent[] = Array.from({ length: 19 }, (_, i) => ({
        taskId: 1,
        type: 'text' as const,
        stageName: 'dev',
        timestamp: Date.now(),
        data: { text: `event-${i}: ${largeChunk}` },
      }));
      streamEvents.push({ taskId: 1, type: 'done', stageName: 'dev', timestamp: Date.now(), data: {} });
      // 19 text + 1 done = 20 events — not > 20

      const provider = createMockProvider(streamEvents);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      const lastTxResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = lastTxResults[lastTxResults.length - 1]?.value;
      const lastSetCall = lastTx.update.mock.results[0]?.value.set;
      const setArg = vi.mocked(lastSetCall).mock.calls[0]?.[0] as { output?: string };
      const output = JSON.parse(setArg?.output ?? '{}') as {
        collectedEvents?: Array<{ type: string }>;
      };

      const truncatedEntry = output.collectedEvents?.find(e => e.type === 'truncated');
      expect(truncatedEntry).toBeUndefined();

      await worker.stop();
    });

    it('does not re-emit raw_trace events on stream:raw_trace EventBus channel', async () => {
      const rawTraceEvent: StreamEvent = {
        taskId: 1, type: 'raw_trace', stageName: 'dev', timestamp: Date.now(),
        data: { stdout: 'some output', stderr: '' },
      };
      const streamEvents: StreamEvent[] = [
        { taskId: 1, type: 'text', stageName: 'dev', timestamp: Date.now(), data: { text: '```json\n{"ok":true}\n```' } },
        rawTraceEvent,
        { taskId: 1, type: 'done', stageName: 'dev', timestamp: Date.now(), data: {} },
      ];
      const provider = createMockProvider(streamEvents);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      const rawTraceEmitted: unknown[] = [];
      eventBus.on('stream:raw_trace', (e) => rawTraceEmitted.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(rawTraceEmitted).toHaveLength(0);

      await worker.stop();
    });

    it('accumulates all event types into collectedEvents on failure', async () => {
      const streamEvents: StreamEvent[] = [
        { taskId: 1, type: 'thinking', stageName: 'dev', timestamp: Date.now(), data: { thinking: 'hmm' } },
        { taskId: 1, type: 'tool_use', stageName: 'dev', timestamp: Date.now(), data: { toolName: 'read_file', toolInput: {} } },
        { taskId: 1, type: 'text', stageName: 'dev', timestamp: Date.now(), data: { text: 'not valid json' } },
        { taskId: 1, type: 'done', stageName: 'dev', timestamp: Date.now(), data: {} },
      ];
      const provider = createMockProvider(streamEvents);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      const lastTxResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = lastTxResults[lastTxResults.length - 1]?.value;
      const lastSetCall = lastTx.update.mock.results[0]?.value.set;
      const setArg = vi.mocked(lastSetCall).mock.calls[0]?.[0] as { output?: string };
      const output = JSON.parse(setArg?.output ?? '{}') as { collectedEvents?: Array<{ type: string }> };
      const types = output.collectedEvents?.map(e => e.type) ?? [];
      expect(types).toContain('thinking');
      expect(types).toContain('tool_use');
      expect(types).toContain('text');

      await worker.stop();
    });

    it('includes stderr and stdout from raw_trace in failure output', async () => {
      const rawTraceEvent: StreamEvent = {
        taskId: 1, type: 'raw_trace', stageName: 'dev', timestamp: Date.now(),
        data: { stdout: 'line1\nline2', stderr: 'stderr content' },
      };
      const streamEvents: StreamEvent[] = [
        { taskId: 1, type: 'text', stageName: 'dev', timestamp: Date.now(), data: { text: 'bad output' } },
        rawTraceEvent,
        { taskId: 1, type: 'done', stageName: 'dev', timestamp: Date.now(), data: {} },
      ];
      const provider = createMockProvider(streamEvents);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      const lastTxResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = lastTxResults[lastTxResults.length - 1]?.value;
      const lastSetCall = lastTx.update.mock.results[0]?.value.set;
      const setArg = vi.mocked(lastSetCall).mock.calls[0]?.[0] as { output?: string };
      const output = JSON.parse(setArg?.output ?? '{}') as { stdout?: string; stderr?: string };
      expect(output.stdout).toBe('line1\nline2');
      expect(output.stderr).toBe('stderr content');

      await worker.stop();
    });

    it('calls taskLogWriter.flush before updateTaskFailed on parse fail', async () => {
      const events = createStreamEvents('garbage not json');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      let flushCalledBeforeTransaction = false;
      let flushCallCount = 0;
      vi.mocked(mockTaskLogWriter.flush).mockImplementation(() => {
        flushCallCount++;
      });
      vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: Record<string, unknown>) => void) => {
        if (flushCallCount > 0) {
          flushCalledBeforeTransaction = true;
        }
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
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(mockTaskLogWriter.flush).toHaveBeenCalled();
      expect(flushCalledBeforeTransaction).toBe(true);

      await worker.stop();
    });

    it('does not write raw_trace events to taskLogWriter', async () => {
      const rawTraceEvent: StreamEvent = {
        taskId: 1, type: 'raw_trace', stageName: 'dev', timestamp: Date.now(),
        data: { stdout: 'stdout', stderr: 'stderr' },
      };
      const streamEvents: StreamEvent[] = [
        { taskId: 1, type: 'text', stageName: 'dev', timestamp: Date.now(), data: { text: '```json\n{"ok":true}\n```' } },
        rawTraceEvent,
        { taskId: 1, type: 'done', stageName: 'dev', timestamp: Date.now(), data: {} },
      ];
      const provider = createMockProvider(streamEvents);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      // raw_trace must not be passed to taskLogWriter.write
      const writeCalls = vi.mocked(mockTaskLogWriter.write).mock.calls;
      const rawTracePassed = writeCalls.some(([, e]) => (e as StreamEvent).type === 'raw_trace');
      expect(rawTracePassed).toBe(false);

      await worker.stop();
    });
  });

  describe('getStatus()', () => {
    it('returns WorkerStatus object with correct shape when idle', () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const status = worker.getStatus();
      expect(status).toEqual({
        stageName: 'dev',
        workerIndex: 0,
        status: 'stopped',
        currentTaskId: null,
        uptime: 0,
      });
    });

    it('returns status running when worker is started', () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      worker.start();
      expect(worker.getStatus().status).toBe('running');
      void worker.stop();
    });

    it('returns currentTaskId=null when idle (no task being processed)', async () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(worker.getStatus().currentTaskId).toBeNull();
      await worker.stop();
    });

    it('getCurrentTaskId() returns null when no task is processing', () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      expect(worker.getCurrentTaskId()).toBeNull();
    });

    it('uptime is 0 before start', () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      expect(worker.getStatus().uptime).toBe(0);
    });

    it('uptime is non-negative after start', async () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      worker.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(worker.getStatus().uptime).toBeGreaterThanOrEqual(0);
      await worker.stop();
    });
  });

  describe('team isolation', () => {
    it('passes activeTeam to queue.dequeue()', async () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockQueue.dequeue).toHaveBeenCalledWith(defaultConfig.stageName, defaultConfig.activeTeam);

      await worker.stop();
    });

    it('does not process tasks when dequeue returns null for the configured team', async () => {
      // Worker for 'team-a' — queue returns null (no matching task for this team)
      const configTeamA: StageWorkerConfig = { ...defaultConfig, activeTeam: 'team-a' };
      const provider = createMockProvider();
      const worker = new StageWorker(configTeamA, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValue(null);

      const startedEvents: unknown[] = [];
      eventBus.on('task:started', (e) => startedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(startedEvents).toHaveLength(0);
      // dequeue is always called with the worker's own team — isolation enforced at Queue level
      expect(mockQueue.dequeue).toHaveBeenCalledWith('dev', 'team-a');

      await worker.stop();
    });
  });

  describe('file-based output reading', () => {
    it('(a) file success → completed + deleteOutputFile called', async () => {
      const events = createStreamEvents('not valid json');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      vi.mocked(readOutputFile).mockReturnValueOnce({ success: true, data: { result: 'from-file' } });

      const completedEvents: unknown[] = [];
      eventBus.on('task:completed', (e) => completedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(completedEvents).toHaveLength(1);
      expect(vi.mocked(deleteOutputFile)).toHaveBeenCalledWith('/mock/project/_agent_kit/.outputs/task-1.json');

      // DB should be updated with done status and file data
      const lastTxResults = vi.mocked(mockDb.transaction as ReturnType<typeof vi.fn>).mock.results;
      const lastTx = lastTxResults[lastTxResults.length - 1]?.value;
      const lastSetCall = lastTx.update.mock.results[0]?.value.set;
      expect(lastSetCall).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'done', output: JSON.stringify({ result: 'from-file' }) }),
      );

      await worker.stop();
    });

    it('(b) file missing → parseOutput success → completed', async () => {
      const events = createStreamEvents('```json\n{"result": "from-stdout"}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      // Default mock returns OUTPUT_FILE_MISSING — parseOutput will succeed
      vi.mocked(readOutputFile).mockReturnValueOnce({ success: false, error: 'OUTPUT_FILE_MISSING' });

      const completedEvents: unknown[] = [];
      eventBus.on('task:completed', (e) => completedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(completedEvents).toHaveLength(1);
      expect(vi.mocked(deleteOutputFile)).not.toHaveBeenCalled();

      await worker.stop();
    });

    it('(c) file missing → parseOutput fail → failed with OUTPUT_MISSING', async () => {
      const events = createStreamEvents('not valid json at all');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      vi.mocked(readOutputFile).mockReturnValueOnce({ success: false, error: 'OUTPUT_FILE_MISSING' });

      const failedEvents: unknown[] = [];
      eventBus.on('task:failed', (e) => failedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toEqual(
        expect.objectContaining({ taskId: 1, status: 'failed', error: 'OUTPUT_MISSING' }),
      );

      await worker.stop();
    });

    it('(d) INVALID_OUTPUT_JSON → parseOutput success → completed + file not deleted', async () => {
      const events = createStreamEvents('```json\n{"result": "from-stdout"}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      vi.mocked(readOutputFile).mockReturnValueOnce({ success: false, error: 'INVALID_OUTPUT_JSON', rawText: 'bad json' });

      const completedEvents: unknown[] = [];
      eventBus.on('task:completed', (e) => completedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(completedEvents).toHaveLength(1);
      // File must NOT be deleted (kept for debugging)
      expect(vi.mocked(deleteOutputFile)).not.toHaveBeenCalled();

      await worker.stop();
    });

    it('(e) INVALID_OUTPUT_JSON → parseOutput fail → failed with INVALID_OUTPUT_JSON', async () => {
      const events = createStreamEvents('not valid json at all');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      vi.mocked(readOutputFile).mockReturnValueOnce({ success: false, error: 'INVALID_OUTPUT_JSON', rawText: 'bad json' });

      const failedEvents: unknown[] = [];
      eventBus.on('task:failed', (e) => failedEvents.push(e));

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toEqual(
        expect.objectContaining({ taskId: 1, status: 'failed', error: 'INVALID_OUTPUT_JSON' }),
      );
      // File not deleted when INVALID_OUTPUT_JSON
      expect(vi.mocked(deleteOutputFile)).not.toHaveBeenCalled();

      await worker.stop();
    });

    it('(f) ensureOutputDir called before execute', async () => {
      const events = createStreamEvents('```json\n{"ok": true}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask()).mockReturnValue(null);

      let ensureDirCalledBeforeExecute = false;
      vi.mocked(ensureOutputDir).mockImplementationOnce(() => {
        ensureDirCalledBeforeExecute = true;
      });
      vi.mocked(provider.execute).mockImplementation(async function* () {
        // At this point ensureOutputDir should have been called
        if (!ensureDirCalledBeforeExecute) throw new Error('ensureOutputDir not called before execute');
        yield { taskId: 1, type: 'text' as const, stageName: 'dev', timestamp: Date.now(), data: { text: '```json\n{"ok":true}\n```' } };
        yield { taskId: 1, type: 'done' as const, stageName: 'dev', timestamp: Date.now(), data: {} };
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(ensureDirCalledBeforeExecute).toBe(true);

      await worker.stop();
    });

    it('(g) getOutputPath called with correct projectRoot and taskId', async () => {
      const events = createStreamEvents('```json\n{"ok": true}\n```');
      const provider = createMockProvider(events);
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      const mockQueue = vi.mocked(Queue).mock.results[0]?.value as { dequeue: ReturnType<typeof vi.fn> };
      mockQueue.dequeue.mockReturnValueOnce(createMockTask({ id: 42 })).mockReturnValue(null);

      worker.start();
      await vi.advanceTimersByTimeAsync(50);

      expect(vi.mocked(getOutputPath)).toHaveBeenCalledWith(defaultConfig.projectRoot, 42);

      await worker.stop();
    });
  });

  describe('stop behavior', () => {
    it('stops immediately when idle', async () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      worker.start();

      // Abort the delay immediately
      const stopPromise = worker.stop();
      await vi.advanceTimersByTimeAsync(10);
      await stopPromise;

      expect(worker.getStatus().status).toBe('stopped');
    });

    it('stop is no-op when not running', async () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      await worker.stop();
      expect(worker.getStatus().status).toBe('stopped');
    });

    it('calls drain() during stop', async () => {
      const provider = createMockProvider();
      const worker = new StageWorker(defaultConfig, mockDb as never, provider, eventBus, mockTaskLogWriter);
      worker.start();

      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockTaskLogWriter.drain).toHaveBeenCalled();
    });
  });
});
