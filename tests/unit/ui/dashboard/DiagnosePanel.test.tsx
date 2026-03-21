import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, Text } from 'ink';
import { PassThrough } from 'node:stream';

import type { DiagnoseResult } from '@core/DiagnoseTypes.js';
import { EventBus } from '@core/EventBus.js';
import { DiagnosePanel } from '@ui/dashboard/diagnose/DiagnosePanel.js';
import type { DiagnoseService } from '@core/DiagnoseService.js';

// Mock useDiagnosePolling
vi.mock('@ui/dashboard/hooks/useDiagnosePolling.js', () => ({
  useDiagnosePolling: vi.fn(() => ({
    lastResult: null,
    lastPollAt: null,
    nextPollAt: null,
    nextPollIn: 0,
    isPolling: false,
    pollError: null,
  })),
}));

// Mock PipelineCrew to verify integration
vi.mock('@ui/dashboard/crew/PipelineCrew.js', () => ({
  PipelineCrew: vi.fn(({ stages }) => React.createElement(Text, null, `CREW_VISUALIZATION:${(stages || []).join(',')}`)),
}));

// Mock useInput so keyboard events don't require real input
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

import { useDiagnosePolling } from '@ui/dashboard/hooks/useDiagnosePolling.js';
import { PipelineCrew } from '@ui/dashboard/crew/PipelineCrew.js';

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 120;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  const stripAnsi = (str: string): string =>
    str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 50): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function makeResult(overrides?: Partial<DiagnoseResult>): DiagnoseResult {
  return {
    issues: [],
    summary: { stuckCount: 0, orphanedCount: 0, queueGapCount: 0, loopBlockedCount: 0 },
    ...overrides,
  };
}

describe('DiagnosePanel', () => {
  let eventBus: EventBus;
  let mockDiagnoseService: DiagnoseService;
  const mockStages = ['sm', 'dev', 'review', 'tester'];

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();
    mockDiagnoseService = {
      diagnose: vi.fn().mockReturnValue(null),
    } as unknown as DiagnoseService;
    
    vi.mocked(useDiagnosePolling).mockReturnValue({
      lastResult: null,
      lastPollAt: null,
      nextPollAt: null,
      nextPollIn: 0,
      isPolling: false,
      pollError: null,
    });
  });

  describe('AC2/AC3: PipelineCrew Integration', () => {
    it('should render PipelineCrew at the top with correct stages', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(DiagnosePanel, { 
          eventBus, 
          diagnoseService: mockDiagnoseService, 
          isFocused: false,
          stages: mockStages 
        }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('CREW_VISUALIZATION:sm,dev,review,tester');
      expect(vi.mocked(PipelineCrew)).toHaveBeenCalledWith(
        expect.objectContaining({
          eventBus,
          stages: mockStages,
          dimmed: false
        }),
        expect.anything()
      );
      result.unmount();
    });

    it('should propagate dimmed prop to PipelineCrew', async () => {
      const { stream } = makeStream();
      const result = render(
        React.createElement(DiagnosePanel, { 
          eventBus, 
          diagnoseService: mockDiagnoseService, 
          isFocused: false,
          stages: mockStages,
          dimmed: true
        }),
        { stdout: stream },
      );
      await tick();
      expect(vi.mocked(PipelineCrew)).toHaveBeenCalledWith(
        expect.objectContaining({
          dimmed: true
        }),
        expect.anything()
      );
      result.unmount();
    });

    it('AC6: should not re-render PipelineCrew if props are unchanged', async () => {
      const { stream } = makeStream();
      const props = { 
        eventBus, 
        diagnoseService: mockDiagnoseService, 
        isFocused: false,
        stages: mockStages 
      };
      const result = render(
        React.createElement(DiagnosePanel, props),
        { stdout: stream },
      );
      await tick();
      const initialCallCount = vi.mocked(PipelineCrew).mock.calls.length;
      
      // Re-render with same props
      result.rerender(React.createElement(DiagnosePanel, props));
      await tick();
      
      expect(vi.mocked(PipelineCrew).mock.calls.length).toBe(initialCallCount);
      result.unmount();
    });
  });

  it('shows "Waiting" when result is null', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, diagnoseService: mockDiagnoseService, isFocused: false, stages: [] }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('Waiting');
    result.unmount();
  });

  it('shows "All clear" when issues=[]', async () => {
    // Mock the hook to return a result directly to avoid useEffect timing issues in test
    vi.mocked(useDiagnosePolling).mockReturnValue({
      lastResult: makeResult(),
      lastPollAt: Date.now(),
      nextPollAt: null,
      nextPollIn: 0,
      isPolling: true,
      pollError: null,
    });

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, diagnoseService: mockDiagnoseService, isFocused: false }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('All clear');
    result.unmount();
  });

  it('shows summary row counts when issues are present', async () => {
    vi.mocked(useDiagnosePolling).mockReturnValue({
      lastResult: makeResult({
        issues: [
          {
            taskId: 1,
            storyId: 1,
            storyTitle: 'Story A',
            stageName: 'dev',
            status: 'running',
            elapsedMs: 999,
            type: 'stuck',
            suggestedAction: 'reset_to_queued',
          },
        ],
        summary: { stuckCount: 1, orphanedCount: 0, queueGapCount: 0, loopBlockedCount: 0 },
      }),
      lastPollAt: Date.now(),
      nextPollAt: null,
      nextPollIn: 0,
      isPolling: true,
      pollError: null,
    });

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, diagnoseService: mockDiagnoseService, isFocused: false }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('Stuck: ');
    expect(output).toContain('1');
    expect(output).toContain('Orphaned: ');
    result.unmount();
  });

  it('renders stuck/orphaned issues (type shown in row)', async () => {
    vi.mocked(useDiagnosePolling).mockReturnValue({
      lastResult: makeResult({
        issues: [
          {
            taskId: 2,
            storyId: 1,
            storyTitle: 'Story B',
            stageName: 'review',
            status: 'running',
            elapsedMs: 100,
            type: 'orphaned',
            suggestedAction: 'reset_to_queued',
          },
        ],
        summary: { stuckCount: 0, orphanedCount: 1, queueGapCount: 0, loopBlockedCount: 0 },
      }),
      lastPollAt: Date.now(),
      nextPollAt: null,
      nextPollIn: 0,
      isPolling: true,
      pollError: null,
    });

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, diagnoseService: mockDiagnoseService, isFocused: false }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('orphaned');
    result.unmount();
  });

  it('renders queue_gap issues (type shown in row)', async () => {
    vi.mocked(useDiagnosePolling).mockReturnValue({
      lastResult: makeResult({
        issues: [
          {
            taskId: 3,
            storyId: 2,
            storyTitle: 'Story C',
            stageName: 'dev',
            status: 'done',
            elapsedMs: 0,
            type: 'queue_gap',
            suggestedAction: 'reroute',
            gapNextStage: 'review',
          },
        ],
        summary: { stuckCount: 0, orphanedCount: 0, queueGapCount: 1, loopBlockedCount: 0 },
      }),
      lastPollAt: Date.now(),
      nextPollAt: null,
      nextPollIn: 0,
      isPolling: true,
      pollError: null,
    });

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, diagnoseService: mockDiagnoseService, isFocused: false }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('queue_gap');
    result.unmount();
  });

  it('shows "Last: " timestamp in footer', async () => {
    vi.mocked(useDiagnosePolling).mockReturnValue({
      lastResult: makeResult(),
      lastPollAt: Date.now(),
      nextPollAt: null,
      nextPollIn: 0,
      isPolling: true,
      pollError: null,
    });

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, diagnoseService: mockDiagnoseService, isFocused: false }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('Last: ');
    result.unmount();
  });

  it('renders without crashing when isFocused=true', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, diagnoseService: mockDiagnoseService, isFocused: true }),
      { stdout: stream },
    );
    await tick();
    expect(result).toBeDefined();
    result.unmount();
  });
});
