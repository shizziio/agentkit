import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { EventBus } from '@core/EventBus';
import type { StageConfig } from '@core/ConfigTypes';
import type { StageFlowState } from '@ui/dashboard/pipeline-flow/PipelineFlowTypes';
import { usePipelineFlow } from '@ui/dashboard/hooks/usePipelineFlow';

// Mock StateManager
const mockGetStatistics = vi.fn(() => ({
  doneTodayCount: 0,
  failedCount: 0,
  averageDurationPerStage: [
    { stageName: 'sm', averageDurationMs: 10000 },
    { stageName: 'dev', averageDurationMs: 60000 },
  ],
}));

const mockGetQueueDepthByStage = vi.fn(() => ({ sm: 2 } as Record<string, number>));

vi.mock('@core/StateManager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    getStatistics: mockGetStatistics,
    getQueueDepthByStage: mockGetQueueDepthByStage,
  })),
}));

const mockStages: StageConfig[] = [
  { name: 'sm', displayName: 'Scrum Master', icon: '📋', prompt: 'sm.md', timeout: 300, workers: 1, retries: 3, next: 'dev' },
  { name: 'dev', displayName: 'Developer', icon: '💻', prompt: 'dev.md', timeout: 300, workers: 2, retries: 3, next: 'review' },
  { name: 'review', displayName: 'Reviewer', icon: '🔍', prompt: 'review.md', timeout: 300, workers: 1, retries: 3 },
];

// Capture hook output via a test component
let capturedStates: StageFlowState[] = [];

function HookCapture({ stages, eventBus, db }: { stages: StageConfig[]; eventBus: EventBus; db: unknown }): React.ReactElement | null {
  const result = usePipelineFlow(stages, eventBus, db as any);
  capturedStates = result;
  return null;
}

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 10); });

describe('usePipelineFlow', () => {
  let eventBus: EventBus;
  const mockDb = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();
    capturedStates = [];
    mockGetStatistics.mockReturnValue({
      doneTodayCount: 0,
      failedCount: 0,
      averageDurationPerStage: [
        { stageName: 'sm', averageDurationMs: 10000 },
        { stageName: 'dev', averageDurationMs: 60000 },
      ],
    });
    mockGetQueueDepthByStage.mockReturnValue({ sm: 2 });
  });

  function renderHook(): ReturnType<typeof render> {
    return render(React.createElement(HookCapture, { stages: mockStages, eventBus, db: mockDb }));
  }

  it('initializes all stages as idle with queue depths from DB', () => {
    const result = renderHook();

    expect(capturedStates).toHaveLength(3);
    expect(capturedStates[0]!.stageName).toBe('sm');
    expect(capturedStates[0]!.status).toBe('idle');
    expect(capturedStates[0]!.queuedCount).toBe(2);
    expect(capturedStates[1]!.status).toBe('idle');
    expect(capturedStates[1]!.queuedCount).toBe(0);
    expect(capturedStates[2]!.status).toBe('idle');

    result.unmount();
  });

  it('sets stage to busy on worker:busy event', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('worker:busy', { workerId: 'w1', stageName: 'dev', model: 'opus' });
    await tick();

    expect(capturedStates[1]!.status).toBe('busy');
    expect(capturedStates[0]!.status).toBe('idle');

    result.unmount();
  });

  it('sets stage to idle on worker:idle when all workers idle', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('worker:busy', { workerId: 'w1', stageName: 'dev', model: 'opus' });
    await tick();
    expect(capturedStates[1]!.status).toBe('busy');

    eventBus.emit('worker:idle', { workerId: 'w1', stageName: 'dev', model: 'opus' });
    await tick();
    expect(capturedStates[1]!.status).toBe('idle');

    result.unmount();
  });

  it('stays busy if other workers on same stage are still busy', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('worker:busy', { workerId: 'w1', stageName: 'dev', model: 'opus' });
    eventBus.emit('worker:busy', { workerId: 'w2', stageName: 'dev', model: 'opus' });
    await tick();

    eventBus.emit('worker:idle', { workerId: 'w1', stageName: 'dev', model: 'opus' });
    await tick();
    expect(capturedStates[1]!.status).toBe('busy');

    result.unmount();
  });

  it('updates queuedCount on queue:updated with stageName', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('queue:updated', { pending: 10, running: 1, completed: 0, failed: 0, stageName: 'dev', queuedCount: 5 });
    await tick();

    expect(capturedStates[1]!.queuedCount).toBe(5);

    result.unmount();
  });

  it('ignores queue:updated without stageName', async () => {
    const result = renderHook();
    await tick();

    const beforeCounts = capturedStates.map((s) => s.queuedCount);

    eventBus.emit('queue:updated', { pending: 10, running: 1, completed: 0, failed: 0 });
    await tick();

    const afterCounts = capturedStates.map((s) => s.queuedCount);
    expect(afterCounts).toEqual(beforeCounts);

    result.unmount();
  });

  it('computes estimatedTimeMs correctly from queue depth × avg duration', async () => {
    const result = renderHook();

    // sm has avgDuration 10000ms and initial queue of 2 -> 20000
    expect(capturedStates[0]!.estimatedTimeMs).toBe(20000);

    await tick();
    eventBus.emit('queue:updated', { pending: 5, running: 0, completed: 0, failed: 0, stageName: 'dev', queuedCount: 3 });
    await tick();

    // dev has avgDuration 60000ms, queue 3 -> 180000ms
    expect(capturedStates[1]!.estimatedTimeMs).toBe(180000);

    result.unmount();
  });

  it('returns null estimatedTimeMs when no avg duration available', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('queue:updated', { pending: 5, running: 0, completed: 0, failed: 0, stageName: 'review', queuedCount: 3 });
    await tick();

    // review has no avgDuration in mock
    expect(capturedStates[2]!.estimatedTimeMs).toBeNull();

    result.unmount();
  });

  it('cleans up all listeners on unmount', async () => {
    const offSpy = vi.spyOn(eventBus, 'off');

    const result = renderHook();
    await tick();

    result.unmount();
    await tick();

    expect(offSpy).toHaveBeenCalledWith('worker:busy', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('worker:idle', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('queue:updated', expect.any(Function));
  });

  it('returns null estimatedTimeMs when queuedCount is 0', () => {
    mockGetQueueDepthByStage.mockReturnValue({});

    const result = renderHook();

    expect(capturedStates[0]!.queuedCount).toBe(0);
    expect(capturedStates[0]!.estimatedTimeMs).toBeNull();

    result.unmount();
  });
});
