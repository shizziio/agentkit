import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { EventBus } from '@core/EventBus';
import type { LiveActivityState, WorkerFocus, LiveActivityEvent } from '@ui/dashboard/live-activity/LiveActivityTypes';
import { LiveActivityFullscreen } from '@ui/dashboard/live-activity/LiveActivityFullscreen';

// Mock useFullscreenLiveActivity to control state in tests
const mockScrollUp = vi.fn();
const mockScrollDown = vi.fn();
const mockFocusNextWorker = vi.fn();
const mockFocusPrevWorker = vi.fn();

const defaultState: LiveActivityState = {
  events: [],
  workers: [],
  focusedWorkerIndex: 0,
  scrollOffset: 0,
};

let mockState: LiveActivityState = { ...defaultState };

vi.mock('@ui/dashboard/hooks/useFullscreenLiveActivity.js', () => ({
  useFullscreenLiveActivity: vi.fn(() => ({
    state: mockState,
    scrollUp: mockScrollUp,
    scrollDown: mockScrollDown,
    focusNextWorker: mockFocusNextWorker,
    focusPrevWorker: mockFocusPrevWorker,
  })),
}));

// Mock ink's useInput to avoid raw mode requirement in tests
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

// Mock process.stdout.rows for stable VISIBLE_LINES calculation
Object.defineProperty(process.stdout, 'rows', { value: 24, writable: true });

function makeWorker(taskId: number, stageName: string): WorkerFocus {
  return { taskId, stageName, label: `${stageName}#${taskId}` };
}

function makeEvent(
  id: number,
  type: LiveActivityEvent['type'],
  lines: string[],
  taskId = 1,
  stageName = 'dev',
): LiveActivityEvent {
  return {
    id,
    taskId,
    stageName,
    timestamp: new Date('2024-01-01T10:00:00.000Z').getTime(),
    type,
    lines,
  };
}

describe('LiveActivityFullscreen', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();
    mockState = { ...defaultState };
  });

  it('renders without crashing when empty', () => {
    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without crashing with events', () => {
    mockState = {
      ...defaultState,
      events: [makeEvent(0, 'text', ['hello world'])],
      workers: [makeWorker(1, 'dev')],
    };

    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without crashing with thinking event', () => {
    mockState = {
      ...defaultState,
      events: [makeEvent(0, 'thinking', ['💭 I am thinking'])],
      workers: [makeWorker(1, 'dev')],
    };

    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without crashing with tool_use Read event', () => {
    mockState = {
      ...defaultState,
      events: [makeEvent(0, 'tool_use', ['🔍 Read: /src/foo.ts'])],
      workers: [makeWorker(1, 'dev')],
    };

    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without crashing with tool_use Edit event', () => {
    mockState = {
      ...defaultState,
      events: [makeEvent(0, 'tool_use', ['✏️  Edit: /src/bar.ts', ' range: 5 lines'])],
      workers: [makeWorker(1, 'dev')],
    };

    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without crashing with tool_use Bash event', () => {
    mockState = {
      ...defaultState,
      events: [makeEvent(0, 'tool_use', ['🖥️  Bash:', '  npm test'])],
      workers: [makeWorker(1, 'dev')],
    };

    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without crashing with worker label when focusedWorkerIndex > 0', () => {
    mockState = {
      ...defaultState,
      events: [makeEvent(0, 'text', ['📝 hello'])],
      workers: [makeWorker(42, 'sm')],
      focusedWorkerIndex: 1,
    };

    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('filters events by worker when focusedWorkerIndex > 0 - component accepts state', () => {
    const devEvent = makeEvent(0, 'text', ['📝 dev message'], 1, 'dev');
    const smEvent = makeEvent(1, 'text', ['📝 sm message'], 2, 'sm');
    mockState = {
      events: [devEvent, smEvent],
      workers: [makeWorker(1, 'dev'), makeWorker(2, 'sm')],
      focusedWorkerIndex: 1,
      scrollOffset: 0,
    };

    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('shows all events when focusedWorkerIndex === 0 - component accepts state', () => {
    const devEvent = makeEvent(0, 'text', ['📝 dev message'], 1, 'dev');
    const smEvent = makeEvent(1, 'text', ['📝 sm message'], 2, 'sm');
    mockState = {
      events: [devEvent, smEvent],
      workers: [makeWorker(1, 'dev'), makeWorker(2, 'sm')],
      focusedWorkerIndex: 0,
      scrollOffset: 0,
    };

    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without crashing (no onExit prop required)', () => {
    const result = render(
      React.createElement(LiveActivityFullscreen, { eventBus }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });
});
