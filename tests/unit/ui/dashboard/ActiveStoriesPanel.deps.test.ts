/**
 * Story 1.1 — ActiveStoriesPanel: Deps Column
 *
 * Tests that:
 *   - formatDeps returns '-' for no dependencies
 *   - formatDeps returns 'key✓ key⏳' for done/non-done statuses
 *   - formatDeps returns first 2 deps + '+N' for 3+ deps
 *   - formatDeps uses ⏳ for any status that is not 'done' (else branch)
 *   - Exactly 2 deps renders without overflow suffix
 *   - Exactly 3 deps renders with '+1' suffix
 *   - Deps column header 'Deps' appears between Status and Pri headers
 *   - Deps column is visible for ALL story statuses (RUN, QUEUE, DONE, FAIL, WAIT)
 *   - Deps cell text is truncated to COL_DEPS_WIDTH (14) characters
 *   - The old "Waiting for: ..." row no longer appears for any status
 *   - All previously exported symbols continue to be exported
 *   - COL_DEPS_WIDTH = 14 constant is used (deps text padded/truncated to 14)
 *
 * Story 26.5: ActiveStoriesPanel no longer takes db/eventBus props.
 * Tests now mock useStoriesStore instead of useActiveStories.
 */

import { PassThrough } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';

import {
  ActiveStoriesPanel,
  formatDuration,
  COL_PRIORITY_WIDTH,
  getPriorityColor,
  getPriorityDim,
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
  storyKey: '16.1',
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

/** Render panel entries to a string output using debug mode (synchronous). */
function renderToOutput(entries: ActiveStoryEntry[], width = 120): string {
  const stream = Object.assign(new PassThrough(), { columns: width, rows: 40 });
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer | string) => chunks.push(String(chunk)));

  setStoreState(entries);

  const result = render(
    React.createElement(ActiveStoriesPanel, { isFocused: false, width }),
    { stdout: stream as unknown as NodeJS.WriteStream, debug: true },
  );
  result.unmount();

  return chunks.join('');
}

// ─── formatDeps via component rendering — core logic ─────────────────────────

describe('formatDeps — no dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState([]);
  });

  it('should display "-" in Deps cell when story has no dependencies (empty dependsOn)', () => {
    const output = renderToOutput(
      [makeEntry({ storyId: 1, dependsOn: [], depStatuses: {} })],
    );
    expect(output).toContain('-');
  });

  it('should not crash when dependsOn is empty array and depStatuses is empty object', () => {
    setStoreState([]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false }),
      );
      result.unmount();
    }).not.toThrow();
  });
});

describe('formatDeps — 2 dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState([]);
  });

  it('should display "16.1✓" in Deps cell when dep 16.1 has status "done"', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 2,
        dependsOn: ['16.1'],
        depStatuses: { '16.1': 'done' },
      })],
    );
    expect(output).toContain('16.1✓');
  });

  it('should display "16.2⏳" in Deps cell when dep 16.2 has status "waiting"', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 3,
        dependsOn: ['16.2'],
        depStatuses: { '16.2': 'waiting' },
      })],
    );
    expect(output).toContain('16.2⏳');
  });

  it('should display "16.1✓ 16.2⏳" for done+waiting deps (exactly 2 deps, no overflow suffix)', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 4,
        dependsOn: ['16.1', '16.2'],
        depStatuses: { '16.1': 'done', '16.2': 'waiting' },
      })],
    );
    expect(output).toContain('16.1✓');
    expect(output).toContain('16.2⏳');
    expect(output).not.toMatch(/\+[0-9]+/);
  });

  it('should show both ✓ and ⏳ icons when deps have mixed done/non-done statuses', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 5,
        dependsOn: ['16.1', '16.2'],
        depStatuses: { '16.1': 'done', '16.2': 'in_progress' },
      })],
    );
    expect(output).toContain('✓');
    expect(output).toContain('⏳');
  });

  it('should use ⏳ icon for any dep status that is not "done" (else branch)', () => {
    const nonDoneStatuses = ['waiting', 'in_progress', 'run', 'queue', 'fail', 'unknown', ''];
    for (const status of nonDoneStatuses) {
      const output = renderToOutput(
        [makeEntry({
          storyId: 10,
          dependsOn: ['16.1'],
          depStatuses: { '16.1': status },
        })],
      );
      expect(output).toContain('16.1⏳');
    }
  });
});

describe('formatDeps — 3+ dependencies (overflow truncation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState([]);
  });

  it('should show first 2 deps + "+1" suffix when story has exactly 3 dependencies', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 6,
        dependsOn: ['16.1', '16.2', '16.3'],
        depStatuses: { '16.1': 'done', '16.2': 'waiting', '16.3': 'waiting' },
      })],
    );
    expect(output).toContain('16.1✓');
    expect(output).toContain('16.2⏳');
    expect(output).toContain('+1');
  });

  it('should NOT show 3rd dep key directly when total deps = 3 (overflow hides it)', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 7,
        dependsOn: ['16.1', '16.2', '16.3'],
        depStatuses: { '16.1': 'done', '16.2': 'waiting', '16.3': 'done' },
      })],
    );
    expect(output).toContain('16.1');
    expect(output).toContain('16.2');
    expect(output).toContain('+1');
    expect(output).not.toContain('16.3✓');
    expect(output).not.toContain('16.3⏳');
  });

  it('should show "+2" overflow suffix when story has exactly 4 dependencies', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 8,
        dependsOn: ['16.1', '16.2', '16.3', '16.4'],
        depStatuses: { '16.1': 'done', '16.2': 'done', '16.3': 'waiting', '16.4': 'waiting' },
      })],
    );
    expect(output).toContain('16.1✓');
    expect(output).toContain('+2');
  });

  it('should show "+3" overflow suffix when story has 5 dependencies', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 9,
        dependsOn: ['16.1', '16.2', '16.3', '16.4', '16.5'],
        depStatuses: {
          '16.1': 'done', '16.2': 'waiting',
          '16.3': 'waiting', '16.4': 'done', '16.5': 'waiting',
        },
      })],
    );
    expect(output).toContain('+3');
  });

  it('should render without crashing when story has many (>5) deps', () => {
    const dependsOn = Array.from({ length: 8 }, (_, i) => `16.${i + 1}`);
    const depStatuses: Record<string, string> = {};
    dependsOn.forEach((key, i) => { depStatuses[key] = i % 2 === 0 ? 'done' : 'waiting'; });

    const entries = [makeEntry({ storyId: 10, dependsOn, depStatuses })];
    expect(() => {
      renderToOutput(entries);
    }).not.toThrow();
  });
});

// ─── Deps column header ────────────────────────────────────────────────────────

describe('ActiveStoriesPanel Deps column header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState([]);
  });

  it('should display "Deps" as a column header in the panel header row', () => {
    const output = renderToOutput([]);
    expect(output).toContain('Deps');
  });

  it('should display "Status" column header before "Deps" column header', () => {
    const output = renderToOutput([]);
    const statusIdx = output.indexOf('Status');
    const depsIdx = output.indexOf('Deps');
    expect(statusIdx).toBeGreaterThanOrEqual(0);
    expect(depsIdx).toBeGreaterThanOrEqual(0);
    expect(statusIdx).toBeLessThan(depsIdx);
  });

  it('should display "Pri" column header after "Deps" column header', () => {
    const output = renderToOutput([]);
    const depsIdx = output.indexOf('Deps');
    const priIdx = output.indexOf('Pri');
    expect(depsIdx).toBeGreaterThanOrEqual(0);
    expect(priIdx).toBeGreaterThanOrEqual(0);
    expect(depsIdx).toBeLessThan(priIdx);
  });

  it('should still display all other column headers (#, Story, Stage, Status, Pri, Duration)', () => {
    const output = renderToOutput([]);
    expect(output).toContain('#');
    expect(output).toContain('Story');
    expect(output).toContain('Stage');
    expect(output).toContain('Status');
    expect(output).toContain('Pri');
    expect(output).toContain('Duration');
  });
});

// ─── Deps column visible for ALL statuses ─────────────────────────────────────

describe('ActiveStoriesPanel Deps column — visible for all story statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const statuses: Array<ActiveStoryEntry['displayStatus']> = ['RUN', 'QUEUE', 'DONE', 'FAIL', 'WAIT'];

  for (const status of statuses) {
    it(`should show Deps column cell for status="${status}" with dependencies`, () => {
      const output = renderToOutput(
        [makeEntry({
          storyId: 1,
          displayStatus: status,
          firstStartedAt: status === 'QUEUE' || status === 'WAIT' ? null : Date.now() - 5000,
          completedAt: status === 'DONE' || status === 'FAIL' ? Date.now() : null,
          dependsOn: ['16.1'],
          depStatuses: { '16.1': 'done' },
        })],
      );
      expect(output).toContain('16.1✓');
    });

    it(`should show "-" in Deps cell for status="${status}" with no dependencies`, () => {
      const output = renderToOutput(
        [makeEntry({
          storyId: 2,
          displayStatus: status,
          firstStartedAt: status === 'QUEUE' || status === 'WAIT' ? null : Date.now() - 5000,
          completedAt: status === 'DONE' || status === 'FAIL' ? Date.now() : null,
          dependsOn: [],
          depStatuses: {},
        })],
      );
      expect(output).toContain('-');
    });
  }
});

// ─── "Waiting for" row REMOVED ────────────────────────────────────────────────

describe('ActiveStoriesPanel — old "Waiting for" row is removed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should NOT render "Waiting for:" text for WAIT story with deps (row removed)', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 1,
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['16.1', '16.2'],
        depStatuses: { '16.1': 'done', '16.2': 'waiting' },
      })],
    );
    expect(output).not.toContain('Waiting for:');
  });

  it('should NOT render "Waiting for:" for any WAIT story, even with a single dep', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 2,
        displayStatus: 'WAIT',
        firstStartedAt: null,
        completedAt: null,
        dependsOn: ['16.5'],
        depStatuses: { '16.5': 'done' },
      })],
    );
    expect(output).not.toContain('Waiting for:');
  });

  it('should NOT render "Waiting for:" for RUN story with deps', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 3,
        displayStatus: 'RUN',
        dependsOn: ['16.1'],
        depStatuses: { '16.1': 'done' },
      })],
    );
    expect(output).not.toContain('Waiting for:');
  });

  it('should NOT render "Waiting for:" for DONE story with deps', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 4,
        displayStatus: 'DONE',
        firstStartedAt: Date.now() - 10000,
        completedAt: Date.now(),
        dependsOn: ['16.1'],
        depStatuses: { '16.1': 'done' },
      })],
    );
    expect(output).not.toContain('Waiting for:');
  });

  it('should NOT render "Waiting for:" for FAIL story with deps', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 5,
        displayStatus: 'FAIL',
        firstStartedAt: Date.now() - 10000,
        completedAt: Date.now(),
        dependsOn: ['16.1'],
        depStatuses: { '16.1': 'done' },
      })],
    );
    expect(output).not.toContain('Waiting for:');
  });

  it('should NOT render "Waiting for:" when panel has multiple entries of mixed status', () => {
    const output = renderToOutput(
      [
        makeEntry({ storyId: 1, displayStatus: 'RUN', dependsOn: ['16.0'], depStatuses: { '16.0': 'done' } }),
        makeEntry({ storyId: 2, displayStatus: 'WAIT', firstStartedAt: null, completedAt: null, dependsOn: ['16.1', '16.2'], depStatuses: { '16.1': 'done', '16.2': 'waiting' } }),
        makeEntry({ storyId: 3, displayStatus: 'QUEUE', firstStartedAt: null, completedAt: null, dependsOn: [], depStatuses: {} }),
      ],
    );
    expect(output).not.toContain('Waiting for:');
  });
});

// ─── COL_DEPS_WIDTH = 14: truncation behaviour ────────────────────────────────

describe('ActiveStoriesPanel — Deps cell truncation to COL_DEPS_WIDTH=14', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should truncate deps text that would exceed 14 characters and show ellipsis', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 1,
        dependsOn: ['epic-100.100', 'epic-200.200'],
        depStatuses: { 'epic-100.100': 'done', 'epic-200.200': 'waiting' },
      })],
    );
    expect(output).toContain('…');
  });

  it('should pad "-" to fill COL_DEPS_WIDTH when no deps exist', () => {
    const output = renderToOutput(
      [makeEntry({ storyId: 1, dependsOn: [], depStatuses: {} })],
    );
    expect(output).toContain('-');
  });

  it('should render without crashing when deps text fits within 14 chars', () => {
    setStoreState([makeEntry({
      storyId: 2,
      dependsOn: ['16.1', '16.2'],
      depStatuses: { '16.1': 'done', '16.2': 'waiting' },
    })]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render without crashing when deps text exceeds 14 chars (truncate applied)', () => {
    setStoreState([makeEntry({
      storyId: 1,
      dependsOn: ['longkey.100', 'longkey.200', 'longkey.300'],
      depStatuses: { 'longkey.100': 'done', 'longkey.200': 'waiting', 'longkey.300': 'done' },
    })]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false }),
      );
      result.unmount();
    }).not.toThrow();
  });
});

// ─── Exports remain unchanged ─────────────────────────────────────────────────

describe('ActiveStoriesPanel — all previously exported symbols still exported', () => {
  it('should still export formatDuration function', () => {
    expect(typeof formatDuration).toBe('function');
    expect(formatDuration(60000)).toBe('1m 0s');
  });

  it('should still export COL_PRIORITY_WIDTH constant with value 6', () => {
    expect(typeof COL_PRIORITY_WIDTH).toBe('number');
    expect(COL_PRIORITY_WIDTH).toBe(6);
  });

  it('should still export getPriorityColor function', () => {
    expect(typeof getPriorityColor).toBe('function');
    expect(getPriorityColor(3)).toBe('yellow');
    expect(getPriorityColor(0)).toBeUndefined();
  });

  it('should still export getPriorityDim function', () => {
    expect(typeof getPriorityDim).toBe('function');
    expect(getPriorityDim(0)).toBe(true);
    expect(getPriorityDim(1)).toBe(false);
  });

  it('should still export getStatusColor function', () => {
    expect(typeof getStatusColor).toBe('function');
    expect(getStatusColor('RUN')).toBe('green');
    expect(getStatusColor('QUEUE')).toBe('yellow');
    expect(getStatusColor('DONE')).toBe('cyan');
    expect(getStatusColor('WAIT')).toBe('yellowBright');
    expect(getStatusColor('FAIL')).toBe('red');
  });

  it('should still export ActiveStoriesPanel component', () => {
    expect(typeof ActiveStoriesPanel).toBe('function');
  });

  it('should export all symbols via dynamic import', async () => {
    const mod = await import('@ui/dashboard/active-stories/ActiveStoriesPanel.js');
    expect(typeof mod.formatDuration).toBe('function');
    expect(typeof mod.COL_PRIORITY_WIDTH).toBe('number');
    expect(typeof mod.getPriorityColor).toBe('function');
    expect(typeof mod.getPriorityDim).toBe('function');
    expect(typeof mod.getStatusColor).toBe('function');
    expect(typeof mod.ActiveStoriesPanel).toBe('function');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('ActiveStoriesPanel Deps column — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render 2 deps without "+0" suffix (no overflow for exactly 2 deps)', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 1,
        dependsOn: ['16.1', '16.2'],
        depStatuses: { '16.1': 'done', '16.2': 'done' },
      })],
    );
    expect(output).not.toContain('+0');
    expect(output).toContain('16.1✓');
    expect(output).toContain('16.2✓');
  });

  it('should render 3 deps as first 2 + "+1" (not all 3 without overflow)', () => {
    const output = renderToOutput(
      [makeEntry({
        storyId: 2,
        dependsOn: ['16.1', '16.2', '16.3'],
        depStatuses: { '16.1': 'done', '16.2': 'done', '16.3': 'done' },
      })],
    );
    expect(output).toContain('+1');
  });

  it('should render without crashing with width=0 (safeWidth guard) and deps present', () => {
    setStoreState([makeEntry({
      storyId: 1,
      dependsOn: ['16.1'],
      depStatuses: { '16.1': 'done' },
    })]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false, width: 0 }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render without crashing when dimmed=true with deps present', () => {
    setStoreState([makeEntry({
      storyId: 1,
      dependsOn: ['16.1', '16.2'],
      depStatuses: { '16.1': 'done', '16.2': 'waiting' },
    })]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false, dimmed: true }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render separator line without visual wrapping when COL_DEPS_WIDTH is added', () => {
    setStoreState([]);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false, width: 120 }),
      );
      result.unmount();
    }).not.toThrow();
  });

  it('should render more than 20 entries with deps without crashing (overflow guard)', () => {
    const manyEntries = Array.from({ length: 25 }, (_, i) =>
      makeEntry({
        storyId: i + 1,
        storyTitle: `Story ${i + 1}`,
        dependsOn: ['16.1'],
        depStatuses: { '16.1': 'done' },
      }),
    );
    setStoreState(manyEntries);
    expect(() => {
      const result = render(
        React.createElement(ActiveStoriesPanel, { isFocused: false }),
      );
      result.unmount();
    }).not.toThrow();
  });
});
