import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

// Story 26.5: mock useStoriesStore instead of useActiveStories.
// The panel no longer takes db/eventBus/refreshKey props.
import type { ActiveStoryEntry, ActiveStoriesSummary } from '@ui/dashboard/active-stories/ActiveStoriesTypes';

const mockUseStoriesStore = vi.fn();
vi.mock('@ui/stores/storiesStore.js', () => ({
  useStoriesStore: (selector: (state: { entries: ActiveStoryEntry[]; summary: ActiveStoriesSummary }) => unknown) =>
    mockUseStoriesStore(selector),
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

import { ActiveStoriesPanel } from '@ui/dashboard/active-stories/ActiveStoriesPanel';

function makeStream(): { stream: NodeJS.WriteStream & { columns: number } } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 120;
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number } };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function defaultStoreState(): { entries: ActiveStoryEntry[]; summary: ActiveStoriesSummary } {
  return {
    entries: [],
    summary: { doneTodayCount: 0, failedCount: 0, averageDurationMs: null },
  };
}

function setStoreState(entries: ActiveStoryEntry[], summary?: ActiveStoriesSummary): void {
  const s = summary ?? defaultStoreState().summary;
  mockUseStoriesStore.mockImplementation(
    (selector: (state: { entries: ActiveStoryEntry[]; summary: ActiveStoriesSummary }) => unknown) =>
      selector({ entries, summary: s }),
  );
}

describe('ActiveStoriesPanel — React.memo isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState([]);
  });

  it('does NOT re-render when parent re-renders with same props', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(ActiveStoriesPanel, {
        isFocused: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = mockUseStoriesStore.mock.calls.length;

    // Re-render with same memo-relevant props
    result.rerender(
      React.createElement(ActiveStoriesPanel, {
        isFocused: false, dimmed: false, width: 40, height: 12,
      }),
    );
    await tick();

    expect(mockUseStoriesStore.mock.calls.length).toBe(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when isFocused changes', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(ActiveStoriesPanel, {
        isFocused: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = mockUseStoriesStore.mock.calls.length;

    result.rerender(
      React.createElement(ActiveStoriesPanel, {
        isFocused: true, dimmed: false, width: 40, height: 12,
      }),
    );
    await tick();

    expect(mockUseStoriesStore.mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when dimmed changes', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(ActiveStoriesPanel, {
        isFocused: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = mockUseStoriesStore.mock.calls.length;

    result.rerender(
      React.createElement(ActiveStoriesPanel, {
        isFocused: false, dimmed: true, width: 40, height: 12,
      }),
    );
    await tick();

    expect(mockUseStoriesStore.mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when width changes (terminal resize)', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(ActiveStoriesPanel, {
        isFocused: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = mockUseStoriesStore.mock.calls.length;

    result.rerender(
      React.createElement(ActiveStoriesPanel, {
        isFocused: false, dimmed: false, width: 60, height: 12,
      }),
    );
    await tick();

    expect(mockUseStoriesStore.mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when height changes (terminal resize)', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(ActiveStoriesPanel, {
        isFocused: false, dimmed: false, width: 40, height: 12,
      }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = mockUseStoriesStore.mock.calls.length;

    result.rerender(
      React.createElement(ActiveStoriesPanel, {
        isFocused: false, dimmed: false, width: 40, height: 20,
      }),
    );
    await tick();

    expect(mockUseStoriesStore.mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('renders correctly without width/height props (all optional)', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
      { stdout: stream },
    );
    await tick();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('does NOT accept db, eventBus, or refreshKey as props (Story 26.5)', () => {
    // Panel renders without those props — they are no longer part of the interface.
    // This test verifies the panel does not require them.
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false }),
      );
      result.unmount();
    }).not.toThrow();
  });
});
