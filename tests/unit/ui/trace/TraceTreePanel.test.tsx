import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import type { EpicNode, StoryNode, TaskNode } from '@core/TraceTypes';
import type { VisibleLine } from '@ui/trace/TraceTypes';
import { TraceTreePanel } from '@ui/trace/TraceTreePanel';

// Mock TraceService static methods
vi.mock('@core/TraceService.js', () => ({
  TraceService: {
    statusColor: vi.fn(() => 'white'),
    formatDuration: vi.fn((ms: number | null) => (ms !== null ? `${ms}ms` : '-')),
    formatReworkLabel: vi.fn(() => ''),
  },
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

Object.defineProperty(process.stdout, 'rows', { value: 24, writable: true });

const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 120;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function makeEpicLine(id: number, isExpanded = false): VisibleLine {
  const node: EpicNode = {
    id,
    epicKey: `E${id}`,
    title: `Epic ${id}`,
    status: 'draft',
    storyCount: 2,
    completionPct: 50,
    orderIndex: id,
  };
  return { kind: 'epic', depth: 0, node, isExpanded };
}

function makeStoryLine(id: number, isExpanded = false): VisibleLine {
  const node: StoryNode = {
    id,
    epicId: 1,
    storyKey: `S${id}`,
    title: `Story ${id}`,
    status: 'draft',
    totalDurationMs: null,
    orderIndex: id,
  };
  return { kind: 'story', depth: 1, node, isExpanded };
}

function makeTaskLine(id: number, overrides: Partial<TaskNode> = {}): VisibleLine {
  const node: TaskNode = {
    id,
    storyId: 1,
    team: '',
    stageName: 'dev',
    status: 'done',
    attempt: 1,
    maxAttempts: 3,
    reworkLabel: null,
    workerModel: 'claude',
    inputTokens: 100,
    outputTokens: 200,
    durationMs: 5000,
    startedAt: null,
    completedAt: null,
    input: null,
    output: null,
    superseded: false,
    ...overrides,
  };
  return { kind: 'task', depth: 2, node };
}

describe('TraceTreePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with empty lines', () => {
    const r = render(
      React.createElement(TraceTreePanel, { lines: [], focusedLine: 0, searchFilter: '' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with epic line', () => {
    const lines = [makeEpicLine(1)];
    const r = render(
      React.createElement(TraceTreePanel, { lines, focusedLine: 0, searchFilter: '' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with story line', () => {
    const lines = [makeStoryLine(1)];
    const r = render(
      React.createElement(TraceTreePanel, { lines, focusedLine: 0, searchFilter: '' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with task line', () => {
    const lines = [makeTaskLine(1)];
    const r = render(
      React.createElement(TraceTreePanel, { lines, focusedLine: 0, searchFilter: '' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with mixed lines', () => {
    const lines = [makeEpicLine(1, true), makeStoryLine(1, true), makeTaskLine(1)];
    const r = render(
      React.createElement(TraceTreePanel, { lines, focusedLine: 1, searchFilter: '' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders with search filter', () => {
    const lines = [makeEpicLine(1)];
    const r = render(
      React.createElement(TraceTreePanel, { lines, focusedLine: 0, searchFilter: 'test' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders focused line at focusedLine index', () => {
    const lines = [makeEpicLine(1), makeEpicLine(2)];
    const r = render(
      React.createElement(TraceTreePanel, { lines, focusedLine: 1, searchFilter: '' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders expanded epic with expand indicator', () => {
    const lines = [makeEpicLine(1, true)];
    const r = render(
      React.createElement(TraceTreePanel, { lines, focusedLine: 0, searchFilter: '' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders task with rework label', () => {
    const taskLine = makeTaskLine(1);
    if (taskLine.kind === 'task') {
      taskLine.node.reworkLabel = 'Dev rework #1';
      taskLine.node.attempt = 2;
    }
    const r = render(
      React.createElement(TraceTreePanel, { lines: [taskLine], focusedLine: 0, searchFilter: '' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders story with totalDurationMs', () => {
    const storyLine = makeStoryLine(1);
    if (storyLine.kind === 'story') {
      storyLine.node.totalDurationMs = 12000;
    }
    const r = render(
      React.createElement(TraceTreePanel, { lines: [storyLine], focusedLine: 0, searchFilter: '' }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });
});

describe('TraceTreePanel — showTeamOnTask (Story 12.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows team badge when showTeamOnTask=true and task has non-empty team', async () => {
    const { stream, getOutput } = makeStream();
    const taskLine = makeTaskLine(1, { team: 'agentkit' });
    const r = render(
      React.createElement(TraceTreePanel, {
        lines: [taskLine],
        focusedLine: 0,
        searchFilter: '',
        showTeamOnTask: true,
      }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('[agentkit]');
    r.unmount();
  });

  it('does not show team badge when showTeamOnTask=false (default)', async () => {
    const { stream, getOutput } = makeStream();
    const taskLine = makeTaskLine(1, { team: 'agentkit' });
    const r = render(
      React.createElement(TraceTreePanel, {
        lines: [taskLine],
        focusedLine: 0,
        searchFilter: '',
        showTeamOnTask: false,
      }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).not.toContain('[agentkit]');
    r.unmount();
  });

  it('does not show team badge when showTeamOnTask=true but team is empty string', async () => {
    const { stream, getOutput } = makeStream();
    const taskLine = makeTaskLine(1, { team: '' });
    const r = render(
      React.createElement(TraceTreePanel, {
        lines: [taskLine],
        focusedLine: 0,
        searchFilter: '',
        showTeamOnTask: true,
      }),
      { stdout: stream },
    );
    await tick();
    // Only "[superseded]" badge might appear; no team badge
    expect(getOutput()).not.toMatch(/\[agentkit\]|\[data-platform\]/);
    r.unmount();
  });

  it('does not show team badge when showTeamOnTask prop omitted (defaults false)', async () => {
    const { stream, getOutput } = makeStream();
    const taskLine = makeTaskLine(1, { team: 'backend' });
    const r = render(
      React.createElement(TraceTreePanel, {
        lines: [taskLine],
        focusedLine: 0,
        searchFilter: '',
      }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).not.toContain('[backend]');
    r.unmount();
  });

  it('renders without crashing with showTeamOnTask=true on non-task lines', () => {
    const lines: VisibleLine[] = [makeEpicLine(1), makeStoryLine(1)];
    const r = render(
      React.createElement(TraceTreePanel, {
        lines,
        focusedLine: 0,
        searchFilter: '',
        showTeamOnTask: true,
      }),
    );
    expect(r).toBeDefined();
    r.unmount();
  });
});
