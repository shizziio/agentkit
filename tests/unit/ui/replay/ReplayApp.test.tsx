import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import type { ReplayPlayerState, ReplayEvent } from '@ui/replay/ReplayTypes';
import { ReplayApp } from '@ui/replay/ReplayApp';

const mockOnQuit = vi.fn();

let mockState: ReplayPlayerState = {
  taskMeta: {
    taskId: 42,
    stageName: 'dev',
    workerModel: 'sonnet',
    durationMs: 5000,
    inputTokens: 100,
    outputTokens: 200,
  },
  totalEvents: 10,
  loadedEvents: [],
  currentIndex: -1,
  playbackState: 'playing',
  speed: 1,
  firstTimestampMs: 1000,
  lastTimestampMs: 6000,
  playbackOffsetMs: 0,
  playbackResumedAt: Date.now(),
};

let mockCurrentEvent: ReplayEvent | null = null;

vi.mock('@ui/replay/useReplayPlayer.js', () => ({
  useReplayPlayer: vi.fn(() => ({
    state: mockState,
    currentEvent: mockCurrentEvent,
  })),
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

Object.defineProperty(process.stdout, 'rows', { value: 24, writable: true });

function makeEvent(id: number, eventType: string, createdAt = 1500): ReplayEvent {
  return {
    id,
    sequence: id,
    eventType,
    eventData: { text: `message ${id}` },
    createdAt,
  };
}

const defaultMeta = {
  taskId: 42,
  stageName: 'dev',
  workerModel: 'sonnet',
  durationMs: 5000,
  inputTokens: 100,
  outputTokens: 200,
};

describe('ReplayApp', () => {
  const baseProps = {
    replayService: {} as Parameters<typeof ReplayApp>[0]['replayService'],
    taskId: 42,
    onQuit: mockOnQuit,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentEvent = null;
    mockState = {
      taskMeta: { ...defaultMeta },
      totalEvents: 10,
      loadedEvents: [],
      currentIndex: -1,
      playbackState: 'playing',
      speed: 1,
      firstTimestampMs: 1000,
      lastTimestampMs: 6000,
      playbackOffsetMs: 0,
      playbackResumedAt: Date.now(),
    };
  });

  it('renders without crashing with default state', () => {
    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with events up to currentIndex', () => {
    const events = [
      makeEvent(1, 'text', 1500),
      makeEvent(2, 'text', 2000),
      makeEvent(3, 'text', 2500),
    ];
    mockState = {
      ...mockState,
      loadedEvents: events,
      currentIndex: 1,
    };

    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing in paused state with null currentEvent', () => {
    mockState = {
      ...mockState,
      playbackState: 'paused',
      currentIndex: -1,
    };

    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing in paused state with a currentEvent', () => {
    const event = makeEvent(1, 'text', 1500);
    mockState = {
      ...mockState,
      playbackState: 'paused',
      currentIndex: 0,
      loadedEvents: [event],
    };
    mockCurrentEvent = event;

    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing in playing state', () => {
    mockState = { ...mockState, playbackState: 'playing' };

    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with null workerModel', () => {
    mockState = {
      ...mockState,
      taskMeta: { ...defaultMeta, workerModel: null },
    };

    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with null durationMs', () => {
    mockState = {
      ...mockState,
      taskMeta: { ...defaultMeta, durationMs: null },
    };

    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with speed=4', () => {
    mockState = { ...mockState, speed: 4 };

    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('accepts onQuit callback prop', () => {
    const r = render(React.createElement(ReplayApp, { ...baseProps, onQuit: mockOnQuit }));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with thinking event type', () => {
    const event = makeEvent(1, 'thinking', 1500);
    event.eventData = { thinking: 'I am thinking...' };
    mockState = {
      ...mockState,
      loadedEvents: [event],
      currentIndex: 0,
    };
    mockCurrentEvent = event;

    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('renders without crashing with tool_use event type', () => {
    const event = makeEvent(1, 'tool_use', 1500);
    event.eventData = { toolName: 'Read', toolInput: { file_path: '/src/foo.ts' } };
    mockState = {
      ...mockState,
      loadedEvents: [event],
      currentIndex: 0,
    };

    const r = render(React.createElement(ReplayApp, baseProps));
    expect(r).toBeDefined();
    r.unmount();
  });

  it('calls useReplayPlayer with correct props', async () => {
    const { useReplayPlayer } = await import('@ui/replay/useReplayPlayer.js');
    render(React.createElement(ReplayApp, baseProps)).unmount();
    expect(vi.mocked(useReplayPlayer)).toHaveBeenCalledWith({
      replayService: baseProps.replayService,
      taskId: 42,
      onQuit: mockOnQuit,
    });
  });
});
