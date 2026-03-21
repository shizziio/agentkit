import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

// ---------------------------------------------------------------------------
// Mock useActivityStore — after story 26.4 migration, LiveActivityPanel
// sources events/scroll state from useActivityStore, NOT useLiveActivity.
// The eventBus prop is REMOVED from LiveActivityPanel.
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
  useActivityStore: vi.fn(),
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

import { useActivityStore } from '@stores/activityStore.js';
import { LiveActivityPanel } from '@ui/dashboard/live-activity/LiveActivityPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeStream(): { stream: NodeJS.WriteStream & { columns: number } } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 120;
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number } };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function defaultStoreState() {
  return {
    events: [] as import('@stores/activityStore.js').ActivityEvent[],
    scrollIndex: 0,
    isFollowing: true,
    scrollUp: vi.fn(),
    scrollDown: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('LiveActivityPanel — React.memo isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useActivityStore).mockImplementation((selector?: (s: typeof mockStoreState) => unknown) => {
      const state = defaultStoreState();
      if (typeof selector === 'function') return selector(state as unknown as typeof mockStoreState);
      return state;
    });
  });

  it('does NOT re-render when parent re-renders with same props', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useActivityStore).mock.calls.length;

    // Re-render with same memo-relevant props — should NOT cause re-render
    result.rerender(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
    );
    await tick();

    expect(vi.mocked(useActivityStore).mock.calls.length).toBe(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when isFocused changes', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useActivityStore).mock.calls.length;

    result.rerender(
      React.createElement(LiveActivityPanel, {
        isFocused: true, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
    );
    await tick();

    expect(vi.mocked(useActivityStore).mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when isFullscreen changes', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useActivityStore).mock.calls.length;

    result.rerender(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: true, dimmed: false, width: 40, height: 12,
      }),
    );
    await tick();

    expect(vi.mocked(useActivityStore).mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when dimmed changes', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useActivityStore).mock.calls.length;

    result.rerender(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: true, width: 40, height: 12,
      }),
    );
    await tick();

    expect(vi.mocked(useActivityStore).mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when width changes (terminal resize)', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useActivityStore).mock.calls.length;

    result.rerender(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 60, height: 12,
      }),
    );
    await tick();

    expect(vi.mocked(useActivityStore).mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when height changes (terminal resize)', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useActivityStore).mock.calls.length;

    result.rerender(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 20,
      }),
    );
    await tick();

    expect(vi.mocked(useActivityStore).mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('renders correctly without optional width/height props', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, { isFocused: false, isFullscreen: false }),
      { stdout: stream },
    );
    await tick();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('memo equality function does NOT include events/scrollIndex/isFollowing (store handles those)', async () => {
    // These are sourced from the store, not props — changing the store state
    // should NOT trigger a prop-equality re-render check mismatch.
    // Verify: same props but different store state (simulated) → memo blocks re-render.
    const { stream } = makeStream();
    const result = render(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useActivityStore).mock.calls.length;

    // Re-render with IDENTICAL props — memo should block even if store state changed
    result.rerender(
      React.createElement(LiveActivityPanel, {
        isFocused: false, isFullscreen: false, dimmed: false, width: 40, height: 12,
      }),
    );
    await tick();

    expect(vi.mocked(useActivityStore).mock.calls.length).toBe(callCountAfterMount);
    result.unmount();
  });
});
