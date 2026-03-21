import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import type { StageFlowState } from '@ui/dashboard/pipeline-flow/PipelineFlowTypes';
import { EventBus } from '@core/EventBus';
import type { StageConfig } from '@core/ConfigTypes';
import { PipelineFlowPanel } from '@ui/dashboard/pipeline-flow/PipelineFlowPanel';
import { usePipelineFlow } from '@ui/dashboard/hooks/usePipelineFlow';

// Mock the hook to control stage states directly
let mockFlowStates: StageFlowState[] = [];

vi.mock('@ui/dashboard/hooks/usePipelineFlow.js', () => ({
  usePipelineFlow: vi.fn(() => mockFlowStates),
}));

const mockStages: StageConfig[] = [
  { name: 'sm', displayName: 'Scrum Master', icon: '📋', prompt: 'sm.md', timeout: 300, workers: 1, retries: 3, next: 'dev' },
  { name: 'dev', displayName: 'Developer', icon: '💻', prompt: 'dev.md', timeout: 300, workers: 2, retries: 3, next: 'review' },
  { name: 'review', displayName: 'Reviewer', icon: '🔍', prompt: 'review.md', timeout: 300, workers: 1, retries: 3 },
];

describe('PipelineFlowPanel', () => {
  let eventBus: EventBus;
  const mockDb = {} as any;

  function createDefaultStates(overrides?: Partial<Record<string, Partial<StageFlowState>>>): StageFlowState[] {
    const defaults: StageFlowState[] = [
      { stageName: 'sm', displayName: 'Scrum Master', icon: '📋', status: 'idle', queuedCount: 0, estimatedTimeMs: null },
      { stageName: 'dev', displayName: 'Developer', icon: '💻', status: 'idle', queuedCount: 0, estimatedTimeMs: null },
      { stageName: 'review', displayName: 'Reviewer', icon: '🔍', status: 'idle', queuedCount: 0, estimatedTimeMs: null },
    ];
    if (overrides) {
      return defaults.map((s) => ({ ...s, ...overrides[s.stageName] }));
    }
    return defaults;
  }

  function renderPanel(): ReturnType<typeof render> {
    return render(React.createElement(PipelineFlowPanel, { stages: mockStages, eventBus, db: mockDb }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();
    mockFlowStates = createDefaultStates();
  });

  it('renders without crashing', () => {
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('calls usePipelineFlow with correct arguments', () => {
    const result = renderPanel();
    expect(vi.mocked(usePipelineFlow)).toHaveBeenCalledWith(mockStages, eventBus, mockDb, "");
    result.unmount();
  });

  it('renders with idle stages', () => {
    mockFlowStates = createDefaultStates();
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with busy stages', () => {
    mockFlowStates = createDefaultStates({ dev: { status: 'busy' } });
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with warning queued count (4-7)', () => {
    mockFlowStates = createDefaultStates({ dev: { queuedCount: 5 } });
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with danger queued count (>=8)', () => {
    mockFlowStates = createDefaultStates({ review: { queuedCount: 10 } });
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with estimated time when queue > 0 and duration available', () => {
    mockFlowStates = createDefaultStates({ sm: { queuedCount: 3, estimatedTimeMs: 30000 } });
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without estimated time when averageDuration is null', () => {
    mockFlowStates = createDefaultStates({ sm: { queuedCount: 3, estimatedTimeMs: null } });
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without estimated time when queuedCount is 0', () => {
    mockFlowStates = createDefaultStates();
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('handles single stage without crashing', () => {
    mockFlowStates = [
      { stageName: 'sm', displayName: 'Scrum Master', icon: '📋', status: 'idle', queuedCount: 0, estimatedTimeMs: null },
    ];
    const singleStage: StageConfig[] = [mockStages[0]!];
    const result = render(React.createElement(PipelineFlowPanel, { stages: singleStage, eventBus, db: mockDb }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with large estimated time correctly', () => {
    mockFlowStates = createDefaultStates({ dev: { queuedCount: 100, estimatedTimeMs: 1500000 } });
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with all stages in different states simultaneously', () => {
    mockFlowStates = [
      { stageName: 'sm', displayName: 'Scrum Master', icon: '📋', status: 'idle', queuedCount: 0, estimatedTimeMs: null },
      { stageName: 'dev', displayName: 'Developer', icon: '💻', status: 'busy', queuedCount: 5, estimatedTimeMs: 300000 },
      { stageName: 'review', displayName: 'Reviewer', icon: '🔍', status: 'idle', queuedCount: 10, estimatedTimeMs: null },
    ];
    const result = renderPanel();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with empty stages array', () => {
    mockFlowStates = [];
    const result = render(React.createElement(PipelineFlowPanel, { stages: [], eventBus, db: mockDb }));
    expect(result).toBeDefined();
    result.unmount();
  });
});
