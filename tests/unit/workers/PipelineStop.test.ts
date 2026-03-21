import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPipelineConfig,
  createMockProvider,
  createMockDb,
  defaultStages,
} from './PipelineTestSetup.js';

import { Pipeline } from '@workers/Pipeline';
import { StageWorker } from '@workers/StageWorker';
import { eventBus } from '@core/EventBus';

describe('Pipeline stop()', () => {
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

  it('sets shutdown state to graceful', async () => {
    const pipeline = new Pipeline({
      db: mockDb as never,
      pipelineConfig: createPipelineConfig(defaultStages),
      provider: createMockProvider(),
      projectRoot: '/tmp/test-project',
    });

    await pipeline.start();
    await pipeline.stop();

    expect(pipeline.getShutdownState()).not.toBe('running');
  });

  it('stops all workers', async () => {
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

  it('emits pipeline:stop event', async () => {
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

  it('drains TaskLogWriter before cleanup', async () => {
    const pipeline = new Pipeline({
      db: mockDb as never,
      pipelineConfig: createPipelineConfig(defaultStages),
      provider: createMockProvider(),
      projectRoot: '/tmp/test-project',
    });

    await pipeline.start();
    await pipeline.stop();

    const { TaskLogWriter } = await import('@workers/TaskLogWriter.js');
    const writerInstance = vi.mocked(TaskLogWriter).mock.results[0]?.value as {
      drain: ReturnType<typeof vi.fn>;
    };
    expect(writerInstance.drain).toHaveBeenCalledTimes(1);
  });

  it('cleans up eventBus listeners on stop', async () => {
    const pipeline = new Pipeline({
      db: mockDb as never,
      pipelineConfig: createPipelineConfig(defaultStages),
      provider: createMockProvider(),
      projectRoot: '/tmp/test-project',
    });

    await pipeline.start();
    await pipeline.stop();

    expect(vi.mocked(eventBus.off)).toHaveBeenCalledWith('task:completed', expect.any(Function));
  });
});
