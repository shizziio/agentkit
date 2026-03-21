/**
 * Tests for WorkerToggle.drain() method (Story 24.3).
 * AC4: drain() calls workerPipeline.drain(), guards with isTransitioning, resets after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerToggle } from '../../../src/cli/WorkerToggle.js';
import type { DrizzleDB } from '@core/db/Connection.js';
import type { PipelineConfig } from '@core/ConfigTypes.js';
import type { EventBus } from '@core/EventBus.js';

vi.mock('@core/Pipeline.js', () => ({
  Pipeline: vi.fn(),
}));

vi.mock('@workers/Pipeline.js', () => ({
  Pipeline: vi.fn(),
}));

vi.mock('@providers/agent/ClaudeCliProvider.js', () => ({
  ClaudeCliProvider: vi.fn(),
}));

import { Pipeline as CorePipeline } from '@core/Pipeline.js';
import { Pipeline as WorkerPipeline } from '@workers/Pipeline.js';

type EventHandler = (...args: unknown[]) => unknown;

function createMockEventBus() {
  const listeners = new Map<string, Set<EventHandler>>();
  return {
    on: vi.fn((event: string, fn: EventHandler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: EventHandler) => {
      listeners.get(event)?.delete(fn);
    }),
    emit: vi.fn((event: string, payload: unknown) => {
      listeners.get(event)?.forEach((fn) => fn(payload));
    }),
    _listeners: listeners,
  };
}

function createOpts(eventBus: ReturnType<typeof createMockEventBus>) {
  return {
    db: {} as unknown as DrizzleDB,
    pipelineConfig: { stages: [] } as unknown as PipelineConfig,
    eventBus: eventBus as unknown as EventBus,
    projectId: 1,
    projectRoot: '/tmp/test',
  };
}

/** Start workers and simulate pipeline:ready to get a running toggle */
function startAndGetRunning(toggle: WorkerToggle, eventBus: ReturnType<typeof createMockEventBus>) {
  toggle.toggle();
  eventBus.emit('pipeline:ready', {});
  expect(toggle.isRunning()).toBe(true);
}

describe('WorkerToggle.drain()', () => {
  let mockDrain: ReturnType<typeof vi.fn>;
  let mockStop: ReturnType<typeof vi.fn>;
  let mockStart: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDrain = vi.fn().mockResolvedValue(undefined);
    mockStop = vi.fn().mockResolvedValue(undefined);
    mockStart = vi.fn().mockResolvedValue(undefined);
    vi.mocked(WorkerPipeline).mockImplementation(
      () => ({ start: mockStart, stop: mockStop, drain: mockDrain }) as unknown as InstanceType<typeof WorkerPipeline>,
    );
    vi.mocked(CorePipeline).mockImplementation(
      () => ({ start: vi.fn().mockResolvedValue({ recoveredCount: 0, recoveredTasks: [] }) }) as unknown as InstanceType<typeof CorePipeline>,
    );
  });

  // AC4a: calls workerPipeline.drain() when running and not transitioning
  describe('happy path', () => {
    it('calls workerPipeline.drain() when pipeline is running', async () => {
      const eventBus = createMockEventBus();
      const toggle = new WorkerToggle(createOpts(eventBus));
      startAndGetRunning(toggle, eventBus);

      toggle.drain();

      expect(mockDrain).toHaveBeenCalledOnce();
    });

    it('sets isTransitioning=true while drain is in progress (isRunning returns false during transition)', async () => {
      const eventBus = createMockEventBus();
      const toggle = new WorkerToggle(createOpts(eventBus));
      startAndGetRunning(toggle, eventBus);

      let resolveDrain: () => void;
      mockDrain.mockReturnValue(new Promise<void>((r) => { resolveDrain = r; }));

      toggle.drain();
      // During drain, isTransitioning=true → isRunning() returns false
      expect(toggle.isRunning()).toBe(false);

      resolveDrain!();
      await vi.waitFor(() => expect(toggle.isRunning()).toBe(false));
    });

    // AC4b: resets workerPipeline=null and isTransitioning=false in finally
    it('sets workerPipeline=null after drain completes successfully', async () => {
      const eventBus = createMockEventBus();
      const toggle = new WorkerToggle(createOpts(eventBus));
      startAndGetRunning(toggle, eventBus);

      toggle.drain();

      await vi.waitFor(() => {
        expect(toggle.isRunning()).toBe(false);
      });
      // After drain, pipeline is gone — toggle will restart fresh
      expect(mockDrain).toHaveBeenCalledOnce();
    });

    it('resets isTransitioning=false after drain completes', async () => {
      const eventBus = createMockEventBus();
      const toggle = new WorkerToggle(createOpts(eventBus));
      startAndGetRunning(toggle, eventBus);

      toggle.drain();
      await vi.waitFor(() => expect(toggle.isRunning()).toBe(false));

      // Can toggle again (isTransitioning was reset)
      toggle.toggle();
      expect(WorkerPipeline).toHaveBeenCalledTimes(2);
    });

    it('resets workerPipeline=null in finally even when drain rejects', async () => {
      const eventBus = createMockEventBus();
      const toggle = new WorkerToggle(createOpts(eventBus));
      startAndGetRunning(toggle, eventBus);

      mockDrain.mockRejectedValue(new Error('drain failed'));

      toggle.drain();

      await vi.waitFor(() => expect(toggle.isRunning()).toBe(false));
      // After rejection, isTransitioning is reset so toggle works again
      toggle.toggle();
      expect(WorkerPipeline).toHaveBeenCalledTimes(2);
    });
  });

  // AC4c: no-op guards
  describe('no-op guards', () => {
    it('is a no-op when workerPipeline is null (pipeline not started)', () => {
      const eventBus = createMockEventBus();
      const toggle = new WorkerToggle(createOpts(eventBus));

      toggle.drain();

      expect(mockDrain).not.toHaveBeenCalled();
    });

    it('is a no-op when isTransitioning is true (drain already in progress)', async () => {
      const eventBus = createMockEventBus();
      const toggle = new WorkerToggle(createOpts(eventBus));
      startAndGetRunning(toggle, eventBus);

      let resolveDrain: () => void;
      mockDrain.mockReturnValue(new Promise<void>((r) => { resolveDrain = r; }));

      toggle.drain(); // First drain in progress
      toggle.drain(); // Second drain while transitioning — no-op

      expect(mockDrain).toHaveBeenCalledTimes(1);

      resolveDrain!();
      await vi.waitFor(() => expect(toggle.isRunning()).toBe(false));
    });

    it('is a no-op when toggle() is called while drain is in progress', async () => {
      const eventBus = createMockEventBus();
      const toggle = new WorkerToggle(createOpts(eventBus));
      startAndGetRunning(toggle, eventBus);

      let resolveDrain: () => void;
      mockDrain.mockReturnValue(new Promise<void>((r) => { resolveDrain = r; }));

      toggle.drain();
      toggle.toggle(); // toggle() also guarded by isTransitioning

      expect(WorkerPipeline).toHaveBeenCalledTimes(1); // no new pipeline

      resolveDrain!();
      await vi.waitFor(() => expect(toggle.isRunning()).toBe(false));
    });
  });

  // AC4b: isTransitioning=true is set before calling drain()
  describe('transitioning state during drain', () => {
    it('isRunning returns false immediately after drain() is called (isTransitioning=true)', () => {
      const eventBus = createMockEventBus();
      const toggle = new WorkerToggle(createOpts(eventBus));
      startAndGetRunning(toggle, eventBus);

      // Drain is async — mock does not resolve immediately
      let resolveDrain: () => void;
      mockDrain.mockReturnValue(new Promise<void>((r) => { resolveDrain = r; }));

      expect(toggle.isRunning()).toBe(true);
      toggle.drain();
      // isTransitioning=true → isRunning() = false
      expect(toggle.isRunning()).toBe(false);

      resolveDrain!();
    });
  });
});
