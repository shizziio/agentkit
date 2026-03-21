/**
 * Story 21.6 — ActiveStoriesPanel: Waiting Story Display
 *
 * Tests that:
 *   - getStatusColor('WAIT') returns 'yellowBright' (AC1)
 *   - WAIT is visually distinct from all other status values (AC1)
 *   - Waiting story entries render without crashing (AC1)
 *   - No dep row rendered when dependsOn is empty (AC3)
 *   - Done deps use ✓ icon, non-done use ⏳ (AC2)
 *
 * Story 26.5: ActiveStoriesPanel now reads from useStoriesStore.
 * Mock updated from useActiveStories to useStoriesStore.
 * db/eventBus props removed from renders.
 */

import { PassThrough } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';

import {
  ActiveStoriesPanel,
  getStatusColor,
} from '@ui/dashboard/active-stories/ActiveStoriesPanel.js';
import type { ActiveStoryEntry, ActiveStoriesSummary } from '@ui/dashboard/active-stories/ActiveStoriesTypes.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Story 26.5: mock useStoriesStore instead of useActiveStories
const mockUseStoriesStore = vi.fn();
vi.mock('@ui/stores/storiesStore.js', () => ({
  useStoriesStore: (selector: (state: { entries: ActiveStoryEntry[]; summary: ActiveStoriesSummary }) => unknown) =>
    mockUseStoriesStore(selector),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
} as ActiveStoryEntry);

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

// Helper: render to a captured PassThrough stream (debug mode writes immediately)
function renderToStream(entries: ActiveStoryEntry[]): string {
  const stream = Object.assign(new PassThrough(), { columns: 120, rows: 40 });
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer | string) => chunks.push(String(chunk)));

  setStoreState(entries);

  const result = render(
    React.createElement(ActiveStoriesPanel, { isFocused: false }),
    { stdout: stream as unknown as NodeJS.WriteStream, debug: true },
  );
  result.unmount();

  return chunks.join('');
}

// ─── getStatusColor export ────────────────────────────────────────────────────

describe('getStatusColor', () => {
  it('should return "yellowBright" for displayStatus WAIT', () => {
    expect(getStatusColor('WAIT')).toBe('yellowBright');
  });

  it('should return a different color for WAIT vs RUN', () => {
    expect(getStatusColor('WAIT')).not.toBe(getStatusColor('RUN'));
  });

  it('should return a different color for WAIT vs QUEUE', () => {
    expect(getStatusColor('WAIT')).not.toBe(getStatusColor('QUEUE'));
  });

  it('should return a different color for WAIT vs DONE', () => {
    expect(getStatusColor('WAIT')).not.toBe(getStatusColor('DONE'));
  });

  it('should return a different color for WAIT vs FAIL', () => {
    expect(getStatusColor('WAIT')).not.toBe(getStatusColor('FAIL'));
  });

  it('should still return defined colors for existing statuses (no regression)', () => {
    expect(getStatusColor('RUN')).toBeDefined();
    expect(getStatusColor('QUEUE')).toBeDefined();
    expect(getStatusColor('DONE')).toBeDefined();
    expect(getStatusColor('FAIL')).toBeDefined();
  });
});

// ─── Panel rendering with WAIT entries — crash tests ─────────────────────────

describe('ActiveStoriesPanel waiting story rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState([]);
  });

  it('should render without crashing when a single WAIT entry has deps', () => {
    setStoreState([
      makeEntry({
        storyId: 4,
        storyTitle: 'Story 21.4',
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['21.2', '21.3'],
        depStatuses: { '21.2': 'done', '21.3': 'waiting' },
      }),
    ]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without crashing when mixing WAIT with RUN, QUEUE, DONE, FAIL entries', () => {
    setStoreState([
      makeEntry({ storyId: 1, displayStatus: 'RUN' }),
      makeEntry({ storyId: 2, displayStatus: 'QUEUE', firstStartedAt: null }),
      makeEntry({ storyId: 3, displayStatus: 'DONE', completedAt: Date.now() }),
      makeEntry({ storyId: 4, displayStatus: 'FAIL', completedAt: Date.now() }),
      makeEntry({
        storyId: 5,
        storyTitle: 'Story 21.4',
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['21.1', '21.2'],
        depStatuses: { '21.1': 'done', '21.2': 'in_progress' },
      }),
    ]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without dep row when waiting story has empty dependsOn array', () => {
    expect(() => {
      setStoreState([
        makeEntry({
          storyId: 5,
          displayStatus: 'WAIT',
          firstStartedAt: null,
          completedAt: null,
          dependsOn: [],
          depStatuses: {},
        }),
      ]);
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render WAIT entry with null firstStartedAt and null completedAt without crashing', () => {
    expect(() => {
      setStoreState([
        makeEntry({
          storyId: 9,
          displayStatus: 'WAIT',
          firstStartedAt: null,
          completedAt: null,
          dependsOn: ['21.1'],
          depStatuses: { '21.1': 'in_progress' },
        }),
      ]);
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render without crashing when waiting story has > 5 deps (truncate guard)', () => {
    const dependsOn = Array.from({ length: 8 }, (_, i) => `21.${i + 1}`);
    const depStatuses: Record<string, string> = {};
    dependsOn.forEach((key, i) => {
      depStatuses[key] = i % 2 === 0 ? 'done' : 'waiting';
    });
    setStoreState([
      makeEntry({
        storyId: 8,
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn,
        depStatuses,
      }),
    ]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render multiple WAIT entries without crashing', () => {
    setStoreState([
      makeEntry({
        storyId: 11,
        storyTitle: 'Story 21.4',
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['21.1'],
        depStatuses: { '21.1': 'in_progress' },
      }),
      makeEntry({
        storyId: 12,
        storyTitle: 'Story 21.5',
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['21.1', '21.3'],
        depStatuses: { '21.1': 'done', '21.3': 'waiting' },
      }),
    ]);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render without RangeError when width=0 with WAIT entries', () => {
    setStoreState([
      makeEntry({
        storyId: 13,
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['21.1'],
        depStatuses: { '21.1': 'done' },
      }),
    ]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false, width: 0 }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render with explicit width=120 with WAIT entries', () => {
    setStoreState([
      makeEntry({
        storyId: 14,
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['21.1', '21.2'],
        depStatuses: { '21.1': 'done', '21.2': 'waiting' },
      }),
    ]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false, width: 120 }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render without crashing when dimmed=true with WAIT entries', () => {
    setStoreState([
      makeEntry({
        storyId: 16,
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['21.1'],
        depStatuses: { '21.1': 'done' },
      }),
    ]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false, dimmed: true }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render without crashing when > 20 WAIT entries exist (overflow guard)', () => {
    const manyEntries = Array.from({ length: 25 }, (_, i) =>
      makeEntry({
        storyId: i + 100,
        storyTitle: `Waiting Story ${i + 1}`,
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['21.1'],
        depStatuses: { '21.1': 'in_progress' },
      }),
    );
    setStoreState(manyEntries);
    const result = render(
      React.createElement(ActiveStoriesPanel, { isFocused: false }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });
});

// ─── AC2: dep list row content assertions (using captured stream output) ──────

describe('ActiveStoriesPanel waiting dep list row — content assertions (AC2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState([]);
  });

  it('should render ✓ icon in output when dep status is "done"', () => {
    const output = renderToStream(
      [
        makeEntry({
          storyId: 4,
          displayStatus: 'WAIT',
          firstStartedAt: null,
          completedAt: null,
          dependsOn: ['21.1'],
          depStatuses: { '21.1': 'done' },
        }),
      ],
    );
    expect(output).toContain('✓');
  });

  it('should render ⏳ icon in output when dep status is non-done', () => {
    const output = renderToStream(
      [
        makeEntry({
          storyId: 5,
          displayStatus: 'WAIT',
          firstStartedAt: null,
          completedAt: null,
          dependsOn: ['21.3'],
          depStatuses: { '21.3': 'waiting' },
        }),
      ],
    );
    expect(output).toContain('⏳');
  });

  it('should render both ✓ and ⏳ icons when deps have mixed statuses', () => {
    const output = renderToStream(
      [
        makeEntry({
          storyId: 4,
          displayStatus: 'WAIT',
          firstStartedAt: null,
          completedAt: null,
          dependsOn: ['21.1', '21.2'],
          depStatuses: { '21.1': 'done', '21.2': 'waiting' },
        }),
      ],
    );
    expect(output).toContain('✓');
    expect(output).toContain('⏳');
  });

  it('should NOT render "Waiting for:" in output when dependsOn is empty array (deps column shows -)', () => {
    const output = renderToStream(
      [
        makeEntry({
          storyId: 6,
          displayStatus: 'WAIT',
          firstStartedAt: null,
          completedAt: null,
          dependsOn: [],
          depStatuses: {},
        }),
      ],
    );
    expect(output).not.toContain('Waiting for:');
  });

  it('should render "WAIT" badge text in output for WAIT entry', () => {
    const output = renderToStream(
      [
        makeEntry({
          storyId: 7,
          storyTitle: 'Story 21.4',
          displayStatus: 'WAIT',
          firstStartedAt: null,
          completedAt: null,
          dependsOn: ['21.1'],
          depStatuses: { '21.1': 'done' },
        }),
      ],
    );
    expect(output).toContain('WAIT');
  });

  it('should render dep story key in the deps column', () => {
    const output = renderToStream(
      [
        makeEntry({
          storyId: 4,
          displayStatus: 'WAIT',
          firstStartedAt: null,
          completedAt: null,
          dependsOn: ['21.2'],
          depStatuses: { '21.2': 'done' },
        }),
      ],
    );
    expect(output).toContain('21.2');
  });
});

// ─── ActiveStoryEntry type verification ──────────────────────────────────────

describe('ActiveStoryEntry type — fields for Story 21.6', () => {
  it('should allow creating an entry with displayStatus="WAIT"', () => {
    const entry = makeEntry({ displayStatus: 'WAIT' });
    expect(entry.displayStatus).toBe('WAIT');
  });

  it('should allow creating an entry with dependsOn string array', () => {
    const entry = makeEntry({ dependsOn: ['21.1', '21.2'] } as Partial<ActiveStoryEntry>);
    const asRecord = entry as unknown as Record<string, unknown>;
    expect(Array.isArray(asRecord['dependsOn'])).toBe(true);
    expect(asRecord['dependsOn']).toEqual(['21.1', '21.2']);
  });

  it('should allow creating an entry with depStatuses record', () => {
    const entry = makeEntry({
      depStatuses: { '21.1': 'done', '21.2': 'waiting' },
    } as Partial<ActiveStoryEntry>);
    const asRecord = entry as unknown as Record<string, unknown>;
    expect(typeof asRecord['depStatuses']).toBe('object');
    expect(asRecord['depStatuses']).toEqual({ '21.1': 'done', '21.2': 'waiting' });
  });

  it('should have empty dependsOn array by default', () => {
    const entry = makeEntry();
    const asRecord = entry as unknown as Record<string, unknown>;
    expect(asRecord['dependsOn']).toEqual([]);
  });

  it('should have empty depStatuses object by default', () => {
    const entry = makeEntry();
    const asRecord = entry as unknown as Record<string, unknown>;
    expect(asRecord['depStatuses']).toEqual({});
  });
});
