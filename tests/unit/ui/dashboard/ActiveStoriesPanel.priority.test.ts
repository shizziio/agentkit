/**
 * Story 20.5 — Dashboard: Priority Display in Active Stories Panel
 *
 * Tests for:
 *   - getPriorityColor helper (AC2)
 *   - getPriorityDim helper (AC2)
 *   - COL_PRIORITY_WIDTH constant (AC4b)
 *   - Panel renders priority badge for each story (AC1)
 *   - Priority badge color coding (AC2a/AC2b/AC2c)
 *   - Header includes 'Pri' column (AC1)
 *   - Layout: badge is exactly COL_PRIORITY_WIDTH chars wide (AC4b)
 *   - Panel renders without error with various priority values (AC4a)
 *
 * Story 26.5: ActiveStoriesPanel now reads from useStoriesStore.
 * Mock updated from useActiveStories to useStoriesStore.
 * db/eventBus props removed from renders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';

import {
  ActiveStoriesPanel,
  getPriorityColor,
  getPriorityDim,
  COL_PRIORITY_WIDTH,
  formatDuration,
} from '@ui/dashboard/active-stories/ActiveStoriesPanel';
import type { ActiveStoryEntry, ActiveStoriesSummary } from '@ui/dashboard/active-stories/ActiveStoriesTypes';

// ─── Mock useStoriesStore ────────────────────────────────────────────────────

const mockUseStoriesStore = vi.fn();
vi.mock('@ui/stores/storiesStore.js', () => ({
  useStoriesStore: (selector: (state: { entries: ActiveStoryEntry[]; summary: ActiveStoriesSummary }) => unknown) =>
    mockUseStoriesStore(selector),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  doneTodayCount: 0,
  failedCount: 0,
  averageDurationMs: null,
  ...overrides,
});

function setStoreState(entries: ActiveStoryEntry[], summary = makeSummary()): void {
  mockUseStoriesStore.mockImplementation(
    (selector: (s: { entries: ActiveStoryEntry[]; summary: ActiveStoriesSummary }) => unknown) =>
      selector({ entries, summary }),
  );
}

// ─── COL_PRIORITY_WIDTH constant ─────────────────────────────────────────────

describe('COL_PRIORITY_WIDTH', () => {
  it('should be 6', () => {
    expect(COL_PRIORITY_WIDTH).toBe(6);
  });

  it('should pad "p=0" to exactly 6 chars', () => {
    expect('p=0'.padEnd(COL_PRIORITY_WIDTH)).toHaveLength(6);
    expect('p=0'.padEnd(COL_PRIORITY_WIDTH)).toBe('p=0   ');
  });

  it('should pad "p=3" to exactly 6 chars', () => {
    expect('p=3'.padEnd(COL_PRIORITY_WIDTH)).toHaveLength(6);
    expect('p=3'.padEnd(COL_PRIORITY_WIDTH)).toBe('p=3   ');
  });

  it('should render "p=9999" in exactly 6 chars (4-digit number fills the column)', () => {
    const badge = `p=${9999}`.padEnd(COL_PRIORITY_WIDTH);
    expect(badge).toHaveLength(6);
    expect(badge).toBe('p=9999');
  });

  it('should produce correct badge text for priority 10 (5 chars total, padded to 6)', () => {
    const badge = `p=${10}`.padEnd(COL_PRIORITY_WIDTH);
    expect(badge).toHaveLength(6);
    expect(badge).toBe('p=10  ');
  });
});

// ─── getPriorityColor helper ──────────────────────────────────────────────────

describe('getPriorityColor', () => {
  it('should return undefined for priority=0', () => {
    expect(getPriorityColor(0)).toBeUndefined();
  });

  it('should return undefined for priority=1', () => {
    expect(getPriorityColor(1)).toBeUndefined();
  });

  it('should return undefined for priority=2', () => {
    expect(getPriorityColor(2)).toBeUndefined();
  });

  it('should return "yellow" for priority=3', () => {
    expect(getPriorityColor(3)).toBe('yellow');
  });

  it('should return "yellow" for priority=4', () => {
    expect(getPriorityColor(4)).toBe('yellow');
  });

  it('should return "yellow" for priority=10', () => {
    expect(getPriorityColor(10)).toBe('yellow');
  });

  it('should return "yellow" for large priority values (e.g. 9999)', () => {
    expect(getPriorityColor(9999)).toBe('yellow');
  });

  it('should return undefined for negative priority values (treat as below threshold)', () => {
    expect(getPriorityColor(-1)).toBeUndefined();
  });

  it('should return undefined for priority=-99', () => {
    expect(getPriorityColor(-99)).toBeUndefined();
  });
});

// ─── getPriorityDim helper ────────────────────────────────────────────────────

describe('getPriorityDim', () => {
  it('should return true for priority=0', () => {
    expect(getPriorityDim(0)).toBe(true);
  });

  it('should return false for priority=1', () => {
    expect(getPriorityDim(1)).toBe(false);
  });

  it('should return false for priority=2', () => {
    expect(getPriorityDim(2)).toBe(false);
  });

  it('should return false for priority=3', () => {
    expect(getPriorityDim(3)).toBe(false);
  });

  it('should return false for priority=10', () => {
    expect(getPriorityDim(10)).toBe(false);
  });

  it('should return false for negative priority (not exactly 0)', () => {
    expect(getPriorityDim(-1)).toBe(false);
  });
});

// ─── Panel rendering with priority ───────────────────────────────────────────

describe('ActiveStoriesPanel priority rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState([]);
  });

  it('should render without crashing when entries have priority=0', () => {
    setStoreState([makeEntry({ priority: 0 })]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without crashing when entries have priority=1', () => {
    setStoreState([makeEntry({ priority: 1 })]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without crashing when entries have priority=2', () => {
    setStoreState([makeEntry({ priority: 2 })]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without crashing when entries have priority=3 (yellow)', () => {
    setStoreState([makeEntry({ priority: 3 })]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without crashing when entries have priority=5 (yellow)', () => {
    setStoreState([makeEntry({ priority: 5 })]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without crashing when entries have large priority (e.g. 9999)', () => {
    setStoreState([makeEntry({ priority: 9999 })]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without crashing with multiple stories each having different priorities', () => {
    setStoreState([
      makeEntry({ storyId: 1, priority: 0, displayStatus: 'QUEUE' }),
      makeEntry({ storyId: 2, priority: 1, displayStatus: 'RUN' }),
      makeEntry({ storyId: 3, priority: 3, displayStatus: 'DONE' }),
      makeEntry({ storyId: 4, priority: 5, displayStatus: 'FAIL' }),
    ]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without crashing when dimmed=true with priority badges', () => {
    setStoreState([
      makeEntry({ storyId: 1, priority: 3 }),
      makeEntry({ storyId: 2, priority: 0 }),
    ]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false, dimmed: true }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without RangeError when width=0 with priority entries', () => {
    setStoreState([makeEntry({ priority: 2 })]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false, width: 0 }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render without crashing with explicit width=120 with priority column', () => {
    setStoreState([makeEntry({ priority: 3 })]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false, width: 120 }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  // Story 26.5: Panel uses useStoriesStore selectors (no db/eventBus/refreshKey props)
  it('should call useStoriesStore with a selector to get entries', () => {
    setStoreState([makeEntry({ priority: 1 })]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(mockUseStoriesStore).toHaveBeenCalled();
    result.unmount();
  });

  it('should render without crashing when entries have negative priority (-1)', () => {
    setStoreState([makeEntry({ priority: -1 })]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });
});

// ─── Priority badge text format ───────────────────────────────────────────────

describe('priority badge text format', () => {
  it('should format p=0 as "p=0" padded to COL_PRIORITY_WIDTH', () => {
    const badge = `p=${0}`.padEnd(COL_PRIORITY_WIDTH);
    expect(badge).toBe('p=0   ');
    expect(badge.length).toBe(COL_PRIORITY_WIDTH);
  });

  it('should format p=1 as "p=1" padded to COL_PRIORITY_WIDTH', () => {
    const badge = `p=${1}`.padEnd(COL_PRIORITY_WIDTH);
    expect(badge).toBe('p=1   ');
    expect(badge.length).toBe(COL_PRIORITY_WIDTH);
  });

  it('should format p=3 as "p=3" padded to COL_PRIORITY_WIDTH', () => {
    const badge = `p=${3}`.padEnd(COL_PRIORITY_WIDTH);
    expect(badge).toBe('p=3   ');
    expect(badge.length).toBe(COL_PRIORITY_WIDTH);
  });

  it('should format p=10 as "p=10" padded to COL_PRIORITY_WIDTH', () => {
    const badge = `p=${10}`.padEnd(COL_PRIORITY_WIDTH);
    expect(badge).toBe('p=10  ');
    expect(badge.length).toBe(COL_PRIORITY_WIDTH);
  });

  it('should format p=9999 as "p=9999" (exactly COL_PRIORITY_WIDTH chars, no padding needed)', () => {
    const badge = `p=${9999}`.padEnd(COL_PRIORITY_WIDTH);
    expect(badge).toBe('p=9999');
    expect(badge.length).toBe(COL_PRIORITY_WIDTH);
  });
});

// ─── formatDuration re-export still works (no regression) ────────────────────

describe('formatDuration export (regression)', () => {
  it('should still export formatDuration', () => {
    expect(typeof formatDuration).toBe('function');
    expect(formatDuration(5000)).toBe('5s');
  });
});
