import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { TraceRightPanel } from '@ui/dashboard/layouts/TraceRightPanel';
import type { TaskNode, TraceTaskLog } from '@core/TraceTypes';
import type { ResetTarget } from '@core/ResetTypes';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

vi.mock('@ui/dashboard/modals/StoryActionPicker.js', () => ({
  StoryActionPicker: ({ storyKey }: { storyKey: string }) =>
    React.createElement('Text', null, `picker:${storyKey}`),
}));

vi.mock('@ui/trace/TraceDetailPanel.js', () => ({
  TraceDetailPanel: () => React.createElement('Text', null, 'detail-panel'),
}));

vi.mock('@ui/trace/TraceLogsPanel.js', () => ({
  TraceLogsPanel: () => React.createElement('Text', null, 'logs-panel'),
}));

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 80;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  const stripAnsi = (str: string): string =>
    str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');
  return {
    stream: stream as unknown as NodeJS.WriteStream & { columns: number },
    getOutput: () => stripAnsi(output),
  };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

const mockTask: TaskNode = {
  id: 1,
  storyId: 1,
  stageName: 'dev',
  status: 'done',
  attempt: 1,
  maxAttempts: 3,
  reworkLabel: null,
  workerModel: 'claude-sonnet-4-6',
  inputTokens: 100,
  outputTokens: 50,
  durationMs: 1000,
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:00:01Z',
  input: null,
  output: null,
  superseded: false,
};

const mockLog: TraceTaskLog = {
  id: 1,
  taskId: 1,
  sequence: 1,
  eventType: 'output',
  eventData: 'test output',
  createdAt: '2026-01-01T00:00:00Z',
};

const mockTargets: ResetTarget[] = [
  { stageName: 'sm', displayName: 'SM', icon: '📋' },
];

function renderPanel(props: Partial<Parameters<typeof TraceRightPanel>[0]> = {}) {
  const { stream, getOutput } = makeStream();
  const defaults: Parameters<typeof TraceRightPanel>[0] = {
    showPicker: false,
    pickerTargets: [],
    actionStoryKey: '',
    showCancelConfirm: false,
    actionError: '',
    rightPanelMode: 'details',
    selectedTask: null,
    currentLogs: [],
    logsScrollIndex: 0,
    onPickerSelect: vi.fn(),
    onPickerCancel: vi.fn(),
  };
  const result = render(
    React.createElement(TraceRightPanel, { ...defaults, ...props }),
    { stdout: stream },
  );
  return { result, getOutput };
}

describe('TraceRightPanel', () => {
  it('(1) showPicker branch renders StoryActionPicker', async () => {
    const { result, getOutput } = renderPanel({
      showPicker: true,
      pickerTargets: mockTargets,
      actionStoryKey: '1.1',
    });
    await tick();
    expect(getOutput()).toContain('picker:1.1');
    result.unmount();
  });

  it('(2) showCancelConfirm branch renders confirm text', async () => {
    const { result, getOutput } = renderPanel({
      showCancelConfirm: true,
      actionStoryKey: '2.3',
    });
    await tick();
    const out = getOutput();
    expect(out).toContain('Cancel story 2.3');
    expect(out).toContain('[Y] Confirm');
    result.unmount();
  });

  it('(3) actionError branch renders error text', async () => {
    const { result, getOutput } = renderPanel({
      actionError: 'Something went wrong',
    });
    await tick();
    expect(getOutput()).toContain('Something went wrong');
    result.unmount();
  });

  it('(4) details mode renders TraceDetailPanel', async () => {
    const { result, getOutput } = renderPanel({
      rightPanelMode: 'details',
      selectedTask: mockTask,
    });
    await tick();
    expect(getOutput()).toContain('detail-panel');
    result.unmount();
  });

  it('(5) logs mode renders TraceLogsPanel', async () => {
    const { result, getOutput } = renderPanel({
      rightPanelMode: 'logs',
      currentLogs: [mockLog],
    });
    await tick();
    expect(getOutput()).toContain('logs-panel');
    result.unmount();
  });

  it('(6) default empty state renders hint', async () => {
    const { result, getOutput } = renderPanel({
      rightPanelMode: 'details',
      selectedTask: null,
    });
    await tick();
    expect(getOutput()).toContain('Navigate to a task to see details');
    result.unmount();
  });

  it('details mode with selectedTask null falls through to empty state', async () => {
    const { result, getOutput } = renderPanel({
      rightPanelMode: 'details',
      selectedTask: null,
    });
    await tick();
    expect(getOutput()).not.toContain('detail-panel');
    expect(getOutput()).toContain('Navigate to a task to see details');
    result.unmount();
  });

  it('showPicker takes precedence over showCancelConfirm', async () => {
    const { result, getOutput } = renderPanel({
      showPicker: true,
      pickerTargets: mockTargets,
      actionStoryKey: 'x.y',
      showCancelConfirm: true,
    });
    await tick();
    const out = getOutput();
    expect(out).toContain('picker:x.y');
    expect(out).not.toContain('Cancel story');
    result.unmount();
  });

  it('actionError takes precedence over mode panels', async () => {
    const { result, getOutput } = renderPanel({
      actionError: 'error message',
      rightPanelMode: 'details',
      selectedTask: mockTask,
    });
    await tick();
    const out = getOutput();
    expect(out).toContain('error message');
    expect(out).not.toContain('detail-panel');
    result.unmount();
  });
});
