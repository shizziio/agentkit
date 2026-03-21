import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerToggle } from '../../../src/cli/WorkerToggle.js';

vi.mock('@core/Pipeline.js', () => ({
  Pipeline: vi.fn(),
}));

vi.mock('@workers/Pipeline.js', () => ({
  Pipeline: vi.fn(),
}));

vi.mock('@providers/agent/ClaudeCliProvider.js', () => ({
  ClaudeCliProvider: vi.fn(),
}));

import { Pipeline as CorePipeline } from '@core/Pipeline';
import { Pipeline as WorkerPipeline } from '@workers/Pipeline';

function createMockEventBus() {
  const listeners = new Map<string, Set<Function>>();
  return {
    on: vi.fn((event: string, fn: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: Function) => {
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
    db: {} as any,
    pipelineConfig: { stages: [] } as any,
    eventBus: eventBus as any,
    projectId: 1,
    projectRoot: '/tmp/test',
  };
}

describe('WorkerToggle', () => {
  let mockStop: ReturnType<typeof vi.fn>;
  let mockStart: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStop = vi.fn().mockResolvedValue(undefined);
    mockStart = vi.fn().mockResolvedValue(undefined);
    vi.mocked(WorkerPipeline).mockImplementation(
      () => ({ start: mockStart, stop: mockStop }) as any,
    );
    vi.mocked(CorePipeline).mockImplementation(
      () => ({ start: vi.fn().mockResolvedValue({ recoveredCount: 0, recoveredTasks: [] }) }) as any,
    );
  });

  it('starts workers on first toggle via core pipeline', () => {
    const eventBus = createMockEventBus();
    const toggle = new WorkerToggle(createOpts(eventBus));

    expect(toggle.isRunning).toBe(false);
    toggle.toggle();

    // Core pipeline started, ready listener registered
    expect(CorePipeline).toHaveBeenCalledOnce();
    expect(eventBus.on).toHaveBeenCalledWith('pipeline:ready', expect.any(Function));

    // Simulate pipeline:ready
    eventBus.emit('pipeline:ready', {});
    expect(WorkerPipeline).toHaveBeenCalledOnce();
    expect(mockStart).toHaveBeenCalledOnce();
    expect(toggle.isRunning).toBe(true);
  });

  it('stops workers on second toggle', async () => {
    const eventBus = createMockEventBus();
    const toggle = new WorkerToggle(createOpts(eventBus));

    // Start
    toggle.toggle();
    eventBus.emit('pipeline:ready', {});
    expect(toggle.isRunning).toBe(true);

    // Stop
    toggle.toggle();
    expect(mockStop).toHaveBeenCalledOnce();

    // Wait for async stop to complete
    await vi.waitFor(() => {
      expect(toggle.isRunning).toBe(false);
    });
  });

  it('skips core pipeline on subsequent restarts', async () => {
    const eventBus = createMockEventBus();
    const toggle = new WorkerToggle(createOpts(eventBus));

    // First start (through core pipeline)
    toggle.toggle();
    eventBus.emit('pipeline:ready', {});

    // Stop
    toggle.toggle();
    await vi.waitFor(() => expect(toggle.isRunning).toBe(false));

    // Restart — should NOT create CorePipeline again
    vi.mocked(CorePipeline).mockClear();
    toggle.toggle();
    expect(CorePipeline).not.toHaveBeenCalled();
    expect(WorkerPipeline).toHaveBeenCalledTimes(2);
    expect(toggle.isRunning).toBe(true);
  });

  it('rejects rapid toggles during transition', async () => {
    const eventBus = createMockEventBus();
    const toggle = new WorkerToggle(createOpts(eventBus));

    // Start workers
    toggle.toggle();
    eventBus.emit('pipeline:ready', {});
    expect(toggle.isRunning).toBe(true);

    // Stop (async in progress)
    toggle.toggle();
    expect(mockStop).toHaveBeenCalledOnce();

    // Rapid toggle while stopping — should be ignored
    toggle.toggle();
    expect(WorkerPipeline).toHaveBeenCalledTimes(1); // no new pipeline created

    // After stop completes, toggle should work again
    await vi.waitFor(() => expect(toggle.isRunning).toBe(false));
    toggle.toggle();
    expect(WorkerPipeline).toHaveBeenCalledTimes(2);
  });

  it('removes pipeline:ready listener after it fires', () => {
    const eventBus = createMockEventBus();
    const toggle = new WorkerToggle(createOpts(eventBus));

    toggle.toggle();
    eventBus.emit('pipeline:ready', {});

    // Listener should be removed
    expect(eventBus.off).toHaveBeenCalledWith('pipeline:ready', expect.any(Function));

    // Second emission should NOT create another pipeline
    vi.mocked(WorkerPipeline).mockClear();
    eventBus.emit('pipeline:ready', {});
    expect(WorkerPipeline).not.toHaveBeenCalled();
  });

  it('registerReadyListener sets up one-time listener', () => {
    const eventBus = createMockEventBus();
    const toggle = new WorkerToggle(createOpts(eventBus));

    toggle.registerReadyListener();
    expect(eventBus.on).toHaveBeenCalledWith('pipeline:ready', expect.any(Function));

    eventBus.emit('pipeline:ready', {});
    expect(WorkerPipeline).toHaveBeenCalledOnce();
    expect(toggle.isRunning).toBe(true);

    // Listener removed after firing
    expect(eventBus.off).toHaveBeenCalledWith('pipeline:ready', expect.any(Function));
  });

  it('does not create duplicate workers if startWorkers called while running', () => {
    const eventBus = createMockEventBus();
    const toggle = new WorkerToggle(createOpts(eventBus));

    toggle.registerReadyListener();
    eventBus.emit('pipeline:ready', {});
    expect(WorkerPipeline).toHaveBeenCalledTimes(1);

    // Second ready event should not create another (listener already removed)
    eventBus.emit('pipeline:ready', {});
    expect(WorkerPipeline).toHaveBeenCalledTimes(1);
  });

  it('nulls workerPipeline only after stop completes', async () => {
    const eventBus = createMockEventBus();
    const toggle = new WorkerToggle(createOpts(eventBus));

    toggle.toggle();
    eventBus.emit('pipeline:ready', {});

    // During stop, isRunning should still be true until promise resolves
    let resolveStop: () => void;
    mockStop.mockReturnValue(new Promise<void>((r) => { resolveStop = r; }));

    toggle.toggle();
    // Still running during async stop
    expect(toggle.isRunning).toBe(true);

    resolveStop!();
    await vi.waitFor(() => expect(toggle.isRunning).toBe(false));
  });
});
