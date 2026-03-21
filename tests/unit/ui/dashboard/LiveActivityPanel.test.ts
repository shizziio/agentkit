import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

// ---------------------------------------------------------------------------
// Mock useActivityStore — control events/scroll state in tests.
// After story 26.4, LiveActivityPanel reads from useActivityStore selectors
// instead of useLiveActivity(eventBus). The eventBus prop is REMOVED.
// ---------------------------------------------------------------------------
const mockScrollUp = vi.fn();
const mockScrollDown = vi.fn();

const mockStoreState = {
  events: [] as import('@stores/activityStore.js').ActivityEvent[],
  scrollIndex: 0,
  isFollowing: true,
  scrollUp: mockScrollUp,
  scrollDown: mockScrollDown,
};

vi.mock('@stores/activityStore.js', () => ({
  useActivityStore: (selector?: (s: typeof mockStoreState) => unknown) => {
    if (typeof selector === 'function') return selector(mockStoreState);
    return mockStoreState;
  },
}));

import { LiveActivityPanel } from '@ui/dashboard/live-activity/LiveActivityPanel';
import type { ActivityEvent } from '@stores/activityStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 80;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  return {
    stream: stream as unknown as NodeJS.WriteStream & { columns: number },
    getOutput: () => stripAnsi(output),
  };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('LiveActivityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.events = [];
    mockStoreState.scrollIndex = 0;
    mockStoreState.isFollowing = true;
    mockScrollUp.mockReset();
    mockScrollDown.mockReset();
  });

  it('renders without crashing', () => {
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('does NOT require an eventBus prop', () => {
    // After migration, LiveActivityPanel no longer accepts eventBus — it reads from store
    expect(() =>
      render(React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false })),
    ).not.toThrow();
  });

  it('shows "Waiting for activity..." when events array is empty', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('Waiting for activity...');
    result.unmount();
  });

  it('renders visible event rows when events are present', async () => {
    mockStoreState.events = [
      { id: 0, timestamp: '12:34:56', stageName: 'dev', icon: '💬', label: 'text', message: 'hello world' },
      { id: 1, timestamp: '12:34:57', stageName: 'sm', icon: '🧠', label: 'thinking', message: 'analyzing' },
    ];

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('hello world');
    expect(output).toContain('analyzing');
    result.unmount();
  });

  it('shows "(scrolled)" in header when isFollowing=false', async () => {
    mockStoreState.events = [
      { id: 0, timestamp: '12:34:56', stageName: 'dev', icon: '💬', label: 'text', message: 'msg' },
    ];
    mockStoreState.isFollowing = false;

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('(scrolled)');
    result.unmount();
  });

  it('shows "[fullscreen]" in header when isFullscreen=true', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: true, isFullscreen: true }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('[fullscreen]');
    result.unmount();
  });

  it('does not show "(scrolled)" when isFollowing=true', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).not.toContain('(scrolled)');
    result.unmount();
  });

  it('renders with isFocused=true without crashing', () => {
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: true, isFullscreen: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with isFullscreen=false without crashing', () => {
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders CompletionCard content for events with completionData', async () => {
    mockStoreState.events = [
      {
        id: 0,
        timestamp: '12:34:56',
        stageName: '—',
        icon: '✓',
        label: 'complete',
        message: 'Auth service refactor',
        completionData: {
          storyTitle: 'Auth service refactor',
          stageDurations: [
            { stageName: 'dev', durationMs: 60000 },
            { stageName: 'review', durationMs: 30000 },
          ],
          totalDurationMs: 90000,
          totalAttempts: 3,
        },
      } as ActivityEvent,
    ];

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('COMPLETED');
    expect(output).toContain('Auth service refactor');
    expect(output).toContain('Attempts: 3');
    result.unmount();
  });

  it('renders plain text row for events without completionData', async () => {
    mockStoreState.events = [
      { id: 0, timestamp: '12:34:56', stageName: 'dev', icon: '💬', label: 'text', message: 'plain message' },
    ];

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('plain message');
    result.unmount();
  });
});
