import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPipelineConfig,
  createMockProvider,
  createMockDb,
  defaultStages,
} from './PipelineTestSetup.js';

import { Pipeline } from '@workers/Pipeline';
import { CompletionHandler } from '@workers/CompletionHandler';
import { eventBus } from '@core/EventBus';

describe('Pipeline signals & task completion', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    // Safe cast: mock replaces process.exit which returns never
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('uncaughtException');
  });

  describe('signal handling', () => {
    it('registers SIGINT, SIGTERM handlers on start', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      const sigintBefore = process.listenerCount('SIGINT');
      const sigtermBefore = process.listenerCount('SIGTERM');

      await pipeline.start();

      expect(process.listenerCount('SIGINT')).toBeGreaterThan(sigintBefore);
      expect(process.listenerCount('SIGTERM')).toBeGreaterThan(sigtermBefore);

      await pipeline.stop();
    });

    it('cleans up signal handlers on normal stop', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      const sigintBefore = process.listenerCount('SIGINT');

      await pipeline.start();
      await pipeline.stop();

      expect(process.listenerCount('SIGINT')).toBe(sigintBefore);
    });
  });

  describe('task completion callback', () => {
    it('registers task:completed listener on start', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      await pipeline.start();

      expect(vi.mocked(eventBus.on)).toHaveBeenCalledWith('task:completed', expect.any(Function));

      await pipeline.stop();
    });

    it('delegates to CompletionHandler on task:completed', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      await pipeline.start();

      const completedCall = vi.mocked(eventBus.on).mock.calls.find(
        (call) => call[0] === 'task:completed',
      );
      const callback = completedCall?.[1] as unknown as (event: Record<string, unknown>) => void;

      callback({ taskId: 1, storyId: 10, stageName: 'dev', status: 'completed' });

      const handlerInstance = vi.mocked(CompletionHandler).mock.results[0]?.value as {
        handleTaskCompletion: ReturnType<typeof vi.fn>;
      };
      expect(handlerInstance.handleTaskCompletion).toHaveBeenCalledWith(1, 10, 'dev');

      await pipeline.stop();
    });

    it('skips routing during shutdown', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      await pipeline.start();

      const completedCall = vi.mocked(eventBus.on).mock.calls.find(
        (call) => call[0] === 'task:completed',
      );
      const callback = completedCall?.[1] as unknown as (event: Record<string, unknown>) => void;

      await pipeline.stop();

      callback({ taskId: 1, storyId: 10, stageName: 'dev', status: 'completed' });

      const handlerInstance = vi.mocked(CompletionHandler).mock.results[0]?.value as {
        handleTaskCompletion: ReturnType<typeof vi.fn>;
      };
      expect(handlerInstance.handleTaskCompletion).not.toHaveBeenCalled();
    });
  });
});
