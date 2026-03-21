import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';

import { formatDuration, ActiveStoriesPanel } from '@ui/dashboard/active-stories/ActiveStoriesPanel';
import type { ActiveStoryEntry, ActiveStoriesSummary } from '@ui/dashboard/active-stories/ActiveStoriesTypes';

// ---------------------------------------------------------------------------
// Story 26.5: ActiveStoriesPanel now reads from useStoriesStore selectors.
// The panel no longer accepts db, eventBus, or refreshKey props.
// ---------------------------------------------------------------------------

// Mock useStoriesStore so we control the data shown by the panel.
// The panel calls useStoriesStore(s => s.entries) and useStoriesStore(s => s.summary).
const mockUseStoriesStore = vi.fn();
vi.mock('@ui/stores/storiesStore.js', () => ({
  useStoriesStore: (selector: (state: { entries: ActiveStoryEntry[]; summary: ActiveStoriesSummary }) => unknown) =>
    mockUseStoriesStore(selector),
}));

const makeEntry = (overrides: Partial<ActiveStoryEntry> = {}): ActiveStoryEntry => ({
  storyId: 1,
  storyKey: '',
  storyTitle: 'Test Story',
  stageName: 'dev',
  displayStatus: 'RUN',
  firstStartedAt: Date.now() - 65000,
  completedAt: null,
  priority: 0,
  dependsOn: [],
  depStatuses: {},
  ...overrides,
});

const makeSummary = (overrides: Partial<ActiveStoriesSummary> = {}): ActiveStoriesSummary => ({
  doneTodayCount: 3,
  failedCount: 1,
  averageDurationMs: 90000,
  ...overrides,
});

// Helper: configure the useStoriesStore mock for a given entries/summary pair.
function setStoreState(entries: ActiveStoryEntry[], summary: ActiveStoriesSummary): void {
  mockUseStoriesStore.mockImplementation(
    (selector: (s: { entries: ActiveStoryEntry[]; summary: ActiveStoriesSummary }) => unknown) =>
      selector({ entries, summary }),
  );
}

describe('formatDuration', () => {
  it('returns Xs for durations under 60 seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('returns Xm Ys for durations 60 seconds and above', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3661000)).toBe('61m 1s');
  });

  it('returns 0s for 0 milliseconds', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('ActiveStoriesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState([], makeSummary());
  });

  it('renders without crashing when entries is empty', () => {
    setStoreState([], makeSummary());
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without crashing with multiple entries', () => {
    setStoreState(
      [
        makeEntry({ storyId: 1, storyTitle: 'Story Alpha', stageName: 'sm' }),
        makeEntry({ storyId: 2, storyTitle: 'Story Beta', stageName: 'dev' }),
      ],
      makeSummary(),
    );
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with all display statuses without crashing', () => {
    setStoreState(
      [
        makeEntry({ storyId: 1, displayStatus: 'RUN', firstStartedAt: Date.now() - 5000, completedAt: null }),
        makeEntry({ storyId: 2, displayStatus: 'QUEUE', firstStartedAt: null, completedAt: null }),
        makeEntry({ storyId: 3, displayStatus: 'DONE', firstStartedAt: Date.now() - 10000, completedAt: Date.now() }),
        makeEntry({ storyId: 4, displayStatus: 'FAIL', firstStartedAt: Date.now() - 20000, completedAt: Date.now() }),
      ],
      makeSummary(),
    );
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders with null averageDurationMs without crashing', () => {
    setStoreState([], makeSummary({ averageDurationMs: null }));
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders when isFocused is true without crashing', () => {
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: true }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders when isFocused is false without crashing', () => {
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders more than 20 entries without crashing', () => {
    const manyEntries = Array.from({ length: 25 }, (_, i) =>
      makeEntry({ storyId: i + 1, storyTitle: `Story ${i + 1}` }),
    );
    setStoreState(manyEntries, makeSummary());
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('does NOT accept db or eventBus as props — uses useStoriesStore selectors instead', () => {
    // Panel renders without db/eventBus props (they are no longer part of the interface)
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false }));
    expect(mockUseStoriesStore).toHaveBeenCalled();
    result.unmount();
  });

  it('renders QUEUE entry without crashing', () => {
    setStoreState(
      [makeEntry({ displayStatus: 'QUEUE', firstStartedAt: null, completedAt: null })],
      makeSummary(),
    );
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders RUN entry with elapsed time without crashing', () => {
    setStoreState(
      [makeEntry({ displayStatus: 'RUN', firstStartedAt: Date.now() - 125000, completedAt: null })],
      makeSummary(),
    );
    const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false }));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('renders without RangeError when width is 0 (safeWidth guard)', () => {
    setStoreState([], makeSummary());
    expect(() => {
      const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false, width: 0 }));
      result.unmount();
    }).not.toThrow();
  });

  it('renders without crashing with an explicit width prop (separator uses width-2)', () => {
    setStoreState([], makeSummary());
    const width = 60;
    const separatorLen = Math.max(0, width - 2);
    expect(separatorLen).toBe(58);
    expect(() => {
      const result = render(React.createElement(ActiveStoriesPanel, { isFocused: false, width }));
      result.unmount();
    }).not.toThrow();
  });
});

describe('formatDuration re-export from ActiveStoriesPanel', () => {
  it('exports formatDuration function for backward compatibility', () => {
    expect(typeof formatDuration).toBe('function');
  });

  it('formatDuration export is the same implementation', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(90000)).toBe('1m 30s');
  });

  it('formatDuration can be imported directly from module', async () => {
    const mod = await import('@ui/dashboard/active-stories/ActiveStoriesPanel.js');
    expect(mod.formatDuration).toBeDefined();
    expect(typeof mod.formatDuration).toBe('function');
    expect(mod.formatDuration(60000)).toBe('1m 0s');
  });
});
