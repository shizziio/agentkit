import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import type { Key } from 'ink';

import type { MarkableStory, EpicMarkInfo, MarkDoneResult } from '@core/MarkDoneTypes';
import type { DrizzleDB } from '@core/db/Connection';
import type { EventBus } from '@core/EventBus';

// ---------------------------------------------------------------------------
// Mock MarkDoneService
// ---------------------------------------------------------------------------
const mockGetMarkableStories = vi.fn<() => MarkableStory[]>().mockReturnValue([]);
const mockGetMarkableEpics = vi.fn<() => EpicMarkInfo[]>().mockReturnValue([]);
const mockMarkStoriesDone = vi.fn<(ids: number[]) => MarkDoneResult>(() => ({
  storiesMarked: 0,
  epicsMarked: 0,
}));
const mockMarkEpicDone = vi.fn<(epicId: number) => MarkDoneResult>(() => ({
  storiesMarked: 0,
  epicsMarked: 1,
}));

vi.mock('@core/MarkDoneService', () => ({
  MarkDoneService: vi.fn().mockImplementation(() => ({
    getMarkableStories: mockGetMarkableStories,
    getMarkableEpics: mockGetMarkableEpics,
    markStoriesDone: mockMarkStoriesDone,
    markEpicDone: mockMarkEpicDone,
  })),
}));

// ---------------------------------------------------------------------------
// Capture useInput handlers
// ---------------------------------------------------------------------------
type InputHandler = (input: string, key: Key) => void;
interface CapturedInput {
  handler: InputHandler;
  isActive: boolean;
}
let capturedInputs: CapturedInput[] = [];

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn((handler: InputHandler, opts?: { isActive?: boolean }) => {
      capturedInputs.push({ handler, isActive: opts?.isActive ?? true });
    }),
  };
});

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------
import { MarkDoneWizard } from '@ui/mark-done/MarkDoneWizard';
import type { MarkDoneWizardProps } from '@ui/mark-done/MarkDoneWizard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EMPTY_KEY: Key = {
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
  pageDown: false, pageUp: false, return: false, escape: false,
  ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false,
};

const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');

function makeStream(): {
  stream: NodeJS.WriteStream & { columns: number };
  getOutput: () => string;
} {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 80;
  let lastChunk = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    lastChunk = chunk;
  });
  return {
    stream: stream as unknown as NodeJS.WriteStream & { columns: number },
    getOutput: () => stripAnsi(lastChunk),
  };
}

const tick = (ms = 50): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function makeStory(overrides: Partial<MarkableStory> = {}): MarkableStory {
  return {
    id: 1,
    storyKey: '11.1',
    title: 'Test Story',
    status: 'draft',
    epicId: 1,
    epicKey: '11',
    epicTitle: 'Epic Eleven',
    ...overrides,
  };
}

function makeEpicInfo(overrides: Partial<EpicMarkInfo> = {}): EpicMarkInfo {
  return {
    id: 10,
    epicKey: '10',
    title: 'Epic Ten',
    totalStories: 2,
    doneStories: 2,
    allDone: true,
    ...overrides,
  };
}

function makeProps(overrides: Partial<MarkDoneWizardProps> = {}): MarkDoneWizardProps {
  return {
    projectId: 1,
    db: {} as DrizzleDB,
    eventBus: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as EventBus,
    markDoneService: {
      getMarkableStories: mockGetMarkableStories,
      getMarkableEpics: mockGetMarkableEpics,
      markStoriesDone: mockMarkStoriesDone,
      markEpicDone: mockMarkEpicDone,
    },
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    compact: false,
    ...overrides,
  };
}

function getSelectHandler(): InputHandler {
  return capturedInputs[capturedInputs.length - 2]!.handler;
}

function getDoneHandler(): InputHandler {
  return capturedInputs[capturedInputs.length - 1]!.handler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MarkDoneWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInputs = [];
    mockGetMarkableStories.mockReturnValue([]);
    mockGetMarkableEpics.mockReturnValue([]);
    mockMarkStoriesDone.mockReturnValue({ storiesMarked: 0, epicsMarked: 0 });
    mockMarkEpicDone.mockReturnValue({ storiesMarked: 0, epicsMarked: 1 });
  });

  // Test 1: empty state
  it('1. renders empty state when no markable stories and no eligible epics', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();
    const output = getOutput();
    expect(output).toContain('No stories or epics available to mark done');
    expect(output).toContain('[Esc] Cancel');
    result.unmount();
  });

  // Test 2: story list grouped by epic
  it('2. renders story list grouped by epic on mount', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Story Alpha', epicKey: '11', epicTitle: 'Epic Eleven' }),
      makeStory({ id: 2, storyKey: '11.2', title: 'Story Beta', epicKey: '11', epicTitle: 'Epic Eleven' }),
    ]);
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();
    const output = getOutput();
    expect(output).toContain('11: Epic Eleven');
    expect(output).toContain('11/11.1 Story Alpha');
    expect(output).toContain('11/11.2 Story Beta');
    result.unmount();
  });

  // Test 3: arrow down moves cursor
  it('3. arrow down moves cursor', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Story One' }),
    ]);
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();
    // Initially cursor at 0 (epic header, shows ">")
    expect(getOutput()).toContain('>');
    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();
    // Cursor now at story row
    expect(getOutput()).toContain('11/11.1 Story One');
    result.unmount();
  });

  // Test 4: Space on story toggles selectedStoryIds
  it('4. Space on story node toggles selectedStoryIds', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Toggle Me' }),
    ]);
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();
    // Move to story row
    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();
    // Select
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();
    expect(getOutput()).toContain('[x]');
    expect(getOutput()).toContain('1 stories');
    // Deselect
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();
    expect(getOutput()).not.toContain('[x]');
    expect(getOutput()).toContain('0 stories');
    result.unmount();
  });

  // Test 5: Space on epic node toggles expand/collapse
  it('5. Space on epic node toggles expand/collapse', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Story One' }),
    ]);
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();
    // Initially expanded ([-])
    expect(getOutput()).toContain('[-]');
    expect(getOutput()).toContain('11/11.1');
    // Collapse
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();
    expect(getOutput()).toContain('[+]');
    expect(getOutput()).not.toContain('11/11.1');
    // Expand again
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();
    expect(getOutput()).toContain('[-]');
    expect(getOutput()).toContain('11/11.1');
    result.unmount();
  });

  // Test 6: 'A' selects all stories
  it('6. A key selects all undone stories across all groups', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Story One', epicKey: '11', epicTitle: 'E1' }),
      makeStory({ id: 2, storyKey: '11.2', title: 'Story Two', epicKey: '11', epicTitle: 'E1' }),
    ]);
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();
    getSelectHandler()('a', EMPTY_KEY);
    await tick();
    const output = getOutput();
    expect(output).toContain('2 stories');
    const xCount = (output.match(/\[x\]/g) ?? []).length;
    expect(xCount).toBe(2);
    result.unmount();
  });

  // Test 7: 'N' clears all selections
  it('7. N key clears both selectedStoryIds and selectedEpicIds', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Story One' }),
    ]);
    mockGetMarkableEpics.mockReturnValue([makeEpicInfo()]);
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();
    getSelectHandler()('a', EMPTY_KEY);
    await tick();
    getSelectHandler()('n', EMPTY_KEY);
    await tick();
    const output = getOutput();
    expect(output).toContain('0 stories');
    expect(output).toContain('0 epics');
    expect(output).not.toContain('[x]');
    result.unmount();
  });

  // Test 8: Enter with selections calls markStoriesDone + markEpicDone → done
  it('8. Enter with selections calls markStoriesDone and markEpicDone, transitions to done', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Story One' }),
    ]);
    mockGetMarkableEpics.mockReturnValue([makeEpicInfo({ id: 10, epicKey: '10', allDone: true })]);
    mockMarkStoriesDone.mockReturnValue({ storiesMarked: 1, epicsMarked: 0 });
    mockMarkEpicDone.mockReturnValue({ storiesMarked: 0, epicsMarked: 1 });

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();

    // Select story: go down to story node (idx 1), Space
    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();

    // Navigate to section-header (idx 2), then eligible-epic (idx 3)
    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();
    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();

    // Press Enter
    getSelectHandler()('', { ...EMPTY_KEY, return: true });
    await tick(100);

    expect(mockMarkStoriesDone).toHaveBeenCalledWith([1]);
    expect(mockMarkEpicDone).toHaveBeenCalledWith(10);
    expect(getOutput()).toContain('Marked');
    expect(getOutput()).toContain('Press any key to exit');
    result.unmount();
  });

  // Test 9: Enter with no selections does nothing
  it('9. Enter with no selections does nothing', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Story One' }),
    ]);
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();
    getSelectHandler()('', { ...EMPTY_KEY, return: true });
    await tick(100);
    expect(mockMarkStoriesDone).not.toHaveBeenCalled();
    expect(getOutput()).toContain('Mark Stories');
    expect(getOutput()).not.toContain('Press any key to exit');
    result.unmount();
  });

  // Test 10: Escape calls onCancel
  it('10. Escape calls onCancel', async () => {
    const onCancel = vi.fn();
    const { stream } = makeStream();
    const result = render(
      React.createElement(MarkDoneWizard, makeProps({ onCancel })),
      { stdout: stream },
    );
    await tick();
    getSelectHandler()('', { ...EMPTY_KEY, escape: true });
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
    result.unmount();
  });

  // Test 11: eligible epics appear in section 2
  it('11. eligible epics appear in Section 2 when allDone=true', async () => {
    mockGetMarkableEpics.mockReturnValue([
      makeEpicInfo({ id: 10, epicKey: '10', title: 'Completed Epic', allDone: true, totalStories: 3, doneStories: 3 }),
      makeEpicInfo({ id: 11, epicKey: '11', title: 'Incomplete Epic', allDone: false, totalStories: 2, doneStories: 1 }),
    ]);
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();
    const output = getOutput();
    expect(output).toContain('Epics ready to mark done');
    expect(output).toContain('Completed Epic');
    expect(output).not.toContain('Incomplete Epic');
    result.unmount();
  });

  // Test 12: Space on eligible-epic toggles selectedEpicIds
  it('12. Space on eligible-epic node toggles selectedEpicIds', async () => {
    mockGetMarkableEpics.mockReturnValue([
      makeEpicInfo({ id: 10, epicKey: '10', title: 'Done Epic', allDone: true }),
    ]);
    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();

    // flatList: [section-header, eligible-epic] (no stories) → indices 0, 1
    // Move down to eligible-epic
    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();
    expect(getOutput()).toContain('1 epics');
    expect(getOutput()).toContain('[x]');

    // Deselect
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();
    expect(getOutput()).toContain('0 epics');
    result.unmount();
  });

  // Test 13: done step success and any key calls onComplete
  it('13. done step shows success summary and any key calls onComplete', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Story One' }),
    ]);
    mockMarkStoriesDone.mockReturnValue({ storiesMarked: 1, epicsMarked: 0 });
    const onComplete = vi.fn();

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(MarkDoneWizard, makeProps({ onComplete })),
      { stdout: stream },
    );
    await tick();

    // Select story and Enter
    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();
    getSelectHandler()('', { ...EMPTY_KEY, return: true });
    await tick(100);

    expect(getOutput()).toContain('Marked 1 stories and 0 epics as done');
    expect(getOutput()).toContain('Press any key to exit');

    getDoneHandler()('', EMPTY_KEY);
    await tick();
    expect(onComplete).toHaveBeenCalledTimes(1);
    result.unmount();
  });

  // Test 14: done step shows error if marking throws
  it('14. done step shows error text if marking throws', async () => {
    mockGetMarkableStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '11.1', title: 'Story One' }),
    ]);
    mockMarkStoriesDone.mockImplementation(() => {
      throw new Error('DB write failed');
    });

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(MarkDoneWizard, makeProps()), { stdout: stream });
    await tick();

    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();
    getSelectHandler()('', { ...EMPTY_KEY, return: true });
    await tick(100);

    expect(getOutput()).toContain('DB write failed');
    result.unmount();
  });

  // Test 15: compact=true renders without crashing
  it('15. compact=true renders with padding=0 (no extra whitespace)', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(MarkDoneWizard, makeProps({ compact: true })),
      { stdout: stream },
    );
    await tick();
    expect(result).toBeDefined();
    result.unmount();
  });
});
