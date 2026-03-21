import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StageConfig } from '@core/ConfigTypes';
import {
  createPipelineConfig,
  createMockProvider,
  createMockDb,
  defaultStages,
} from './PipelineTestSetup.js';

import { Pipeline } from '@workers/Pipeline';
import { StageWorker } from '@workers/StageWorker';
import { eventBus } from '@core/EventBus';
import { cleanupStaleOutputs } from '@workers/OutputFileManager';

describe('Pipeline', () => {
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

  describe('constructor', () => {
    it('throws QueueError for invalid reject_to stage', () => {
      const stages: StageConfig[] = [
        { name: 'dev', displayName: 'Dev', icon: '🔨', prompt: 'dev.md', timeout: 300000, workers: 1, retries: 3, reject_to: 'nonexistent' },
      ];

      expect(() => {
        new Pipeline({
          db: mockDb as never,
          pipelineConfig: createPipelineConfig(stages),
          provider: createMockProvider(),
          projectRoot: '/tmp/test-project',
        });
      }).toThrow('reject_to');
    });
  });

  describe('start()', () => {
    it('creates correct number of StageWorker instances per stage config', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      await pipeline.start();

      // sm:1 + dev:1 + review:1 + tester:2 = 5
      expect(StageWorker).toHaveBeenCalledTimes(5);
      expect(pipeline.getWorkerCount()).toBe(5);

      await pipeline.stop();
    });

    it('emits pipeline:start event', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      await pipeline.start();

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:start',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );

      await pipeline.stop();
    });

    it('starts all workers', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      await pipeline.start();

      const workerInstances = vi.mocked(StageWorker).mock.results;
      for (const result of workerInstances) {
        const worker = result.value as { start: ReturnType<typeof vi.fn> };
        expect(worker.start).toHaveBeenCalledTimes(1);
      }

      await pipeline.stop();
    });
  });

  describe('single-stage pipeline', () => {
    it('works with a single stage (no next defined)', async () => {
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

      expect(StageWorker).toHaveBeenCalledTimes(1);
      expect(pipeline.getWorkerCount()).toBe(1);

      await pipeline.stop();
    });
  });

  describe('isRunning()', () => {
    it('returns false before start', () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      expect(pipeline.isRunning()).toBe(false);
    });

    it('returns true after start', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      expect(pipeline.isRunning()).toBe(true);
      await pipeline.stop();
    });

    it('returns false after stop', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      await pipeline.stop();
      expect(pipeline.isRunning()).toBe(false);
    });
  });

  describe('terminate()', () => {
    it('emits pipeline:stopping immediately then pipeline:terminated after workers stop', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.terminate();

      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:stopping',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
      expect(vi.mocked(eventBus.emit)).toHaveBeenCalledWith(
        'pipeline:terminated',
        expect.objectContaining({ timestamp: expect.any(String) }),
      );
    });

    it('does NOT call process.exit', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.terminate();

      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('is idempotent — second call returns immediately', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();

      await pipeline.terminate();
      const emitCallCount = vi.mocked(eventBus.emit).mock.calls.length;

      // Second call should be a no-op
      await pipeline.terminate();
      expect(vi.mocked(eventBus.emit).mock.calls.length).toBe(emitCallCount);
    });

    it('sets shutdownState to terminated', async () => {
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

    it('isRunning returns false after terminate', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      expect(pipeline.isRunning()).toBe(true);

      await pipeline.terminate();

      expect(pipeline.isRunning()).toBe(false);
    });
  });

  describe('cleanupStaleOutputs on start()', () => {
    it('calls cleanupStaleOutputs with projectRoot when start() is invoked', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      await pipeline.start();

      expect(vi.mocked(cleanupStaleOutputs)).toHaveBeenCalledWith('/tmp/test-project');

      await pipeline.stop();
    });

    it('calls cleanupStaleOutputs before any workers are started', async () => {
      let cleanupCalledBeforeWorkerCreation = false;
      vi.mocked(cleanupStaleOutputs).mockImplementationOnce(() => {
        // At cleanup time, no StageWorker instances should exist yet
        cleanupCalledBeforeWorkerCreation = vi.mocked(StageWorker).mock.instances.length === 0;
      });

      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });

      await pipeline.start();

      expect(vi.mocked(cleanupStaleOutputs)).toHaveBeenCalled();
      expect(cleanupCalledBeforeWorkerCreation).toBe(true);
      expect(pipeline.getWorkerCount()).toBeGreaterThan(0);

      await pipeline.stop();
    });
  });

  describe('getStatus()', () => {
    it('returns stopped state before start with empty workers array', () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      const status = pipeline.getStatus();
      expect(status.state).toBe('stopped');
      expect(Array.isArray(status.workers)).toBe(true);
      expect(status.activeTeam).toBe('agentkit');
    });

    it('returns running state after start', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      const status = pipeline.getStatus();
      expect(status.state).toBe('running');
      // sm:1 + dev:1 + review:1 + tester:2 = 5
      expect(status.workers).toHaveLength(5);
      await pipeline.stop();
    });

    it('workers array contains WorkerStatus entries from each StageWorker', async () => {
      const pipeline = new Pipeline({
        db: mockDb as never,
        pipelineConfig: createPipelineConfig(defaultStages),
        provider: createMockProvider(),
        projectRoot: '/tmp/test-project',
      });
      await pipeline.start();
      const status = pipeline.getStatus();
      expect(status.workers.length).toBeGreaterThan(0);
      for (const entry of status.workers) {
        expect(entry).toHaveProperty('stageName');
        expect(entry).toHaveProperty('workerIndex');
        expect(entry).toHaveProperty('status');
        expect(entry).toHaveProperty('currentTaskId');
        expect(entry).toHaveProperty('uptime');
      }
      await pipeline.stop();
    });
  });
});
