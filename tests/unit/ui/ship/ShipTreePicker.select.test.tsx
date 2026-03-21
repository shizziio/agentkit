import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import type { Key } from 'ink';

import type { StoryWithEpic } from '@core/ShipTypes';
import type { DrizzleDB } from '@core/db/Connection';

// ---------------------------------------------------------------------------
// Mock ShipService
// ---------------------------------------------------------------------------
const mockGetStories = vi.fn<() => StoryWithEpic[]>().mockReturnValue([]);
const mockShipStories = vi.fn<(ids: number[], stageName: string) => { shippedCount: number }>(
  () => ({ shippedCount: 0 }),
);

vi.mock('@core/ShipService', () => ({
  ShipService: vi.fn().mockImplementation(() => ({
    getStories: mockGetStories,
    shipStories: mockShipStories,
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
// Import component AFTER mocks are set up
// ---------------------------------------------------------------------------
import { ShipTreePicker } from '@ui/ship/ShipTreePicker';
import type { ShipTreePickerProps } from '@ui/ship/ShipTreePicker';

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
  (stream as unknown as PassThrough).on('data', (chunk: string) => { lastChunk = chunk; });
  return {
    stream: stream as unknown as NodeJS.WriteStream & { columns: number },
    getOutput: () => stripAnsi(lastChunk),
  };
}

const tick = (ms = 50): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function makeStory(overrides: Partial<StoryWithEpic> = {}): StoryWithEpic {
  return {
    id: 1,
    storyKey: '9.1',
    title: 'Test Story',
    status: 'pending',
    epicId: 1,
    epicKey: '9',
    epicTitle: 'Epic Nine',
    hasExistingTasks: false,
    ...overrides,
  };
}

function makeProps(overrides: Partial<ShipTreePickerProps> = {}): ShipTreePickerProps {
  return {
    projectId: 1,
    db: {} as DrizzleDB,
    firstStageName: 'sm',
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    compact: false,
    ...overrides,
  };
}

function getSelectHandler(): InputHandler {
  return capturedInputs[capturedInputs.length - 2].handler;
}

// ---------------------------------------------------------------------------
// Tests: keyboard interactions & selection logic
// ---------------------------------------------------------------------------
describe('ShipTreePicker — selection & keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInputs = [];
    mockGetStories.mockReturnValue([]);
    mockShipStories.mockReturnValue({ shippedCount: 0 });
  });

  it('(a) renders epic headers and story rows on mount', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Story One', epicKey: '9', epicTitle: 'Epic Nine' }),
      makeStory({ id: 2, storyKey: '9.2', title: 'Story Two', epicKey: '9', epicTitle: 'Epic Nine' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();
    const output = getOutput();

    expect(output).toContain('9: Epic Nine');
    expect(output).toContain('9/9.1 Story One');
    expect(output).toContain('9/9.2 Story Two');

    result.unmount();
  });

  it('(b) Space on a story toggles selection', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Toggle Me' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();

    // cursor=0 is the epic row; move down to story
    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();

    // space to select
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();

    expect(getOutput()).toContain('[x]');

    // space again to deselect
    getSelectHandler()(' ', EMPTY_KEY);
    await tick();

    expect(getOutput()).toContain('[ ]');

    result.unmount();
  });

  it('(c) A selects all eligible stories', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Story One' }),
      makeStory({ id: 2, storyKey: '9.2', title: 'Story Two' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();

    getSelectHandler()('a', EMPTY_KEY);
    await tick();

    const output = getOutput();
    const xCount = (output.match(/\[x\]/g) ?? []).length;
    expect(xCount).toBe(2);
    expect(output).toContain('2 selected');

    result.unmount();
  });

  it('(d) N deselects all stories', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Story One' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();

    getSelectHandler()('a', EMPTY_KEY);
    await tick();

    getSelectHandler()('n', EMPTY_KEY);
    await tick();

    expect(getOutput()).toContain('0 selected');
    expect(getOutput()).not.toContain('[x]');

    result.unmount();
  });

  it('(e) ineligible story shows [!] and cannot be selected with Space', async () => {
    // Epic has a mix: one ineligible + one eligible — epic stays visible, ineligible shows [!]
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Ineligible Story', hasExistingTasks: true }),
      makeStory({ id: 2, storyKey: '9.2', title: 'Eligible Story', hasExistingTasks: false }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();
    expect(getOutput()).toContain('[!]');

    getSelectHandler()('', { ...EMPTY_KEY, downArrow: true });
    await tick();

    getSelectHandler()(' ', EMPTY_KEY);
    await tick();

    expect(getOutput()).toContain('0 selected');
    expect(getOutput()).not.toContain('[x]');

    result.unmount();
  });

  it('(g) Esc calls onCancel', async () => {
    const onCancel = vi.fn();
    const { stream } = makeStream();
    const result = render(
      React.createElement(ShipTreePicker, makeProps({ onCancel })),
      { stdout: stream },
    );

    await tick();

    getSelectHandler()('', { ...EMPTY_KEY, escape: true });
    await tick();

    expect(onCancel).toHaveBeenCalledTimes(1);

    result.unmount();
  });

  it('(h) Space on epic row toggles expand/collapse', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Story One' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();

    expect(getOutput()).toContain('[-]');

    getSelectHandler()(' ', EMPTY_KEY);
    await tick();

    expect(getOutput()).toContain('[+]');
    expect(getOutput()).not.toContain('9/9.1 Story One');

    getSelectHandler()(' ', EMPTY_KEY);
    await tick();

    expect(getOutput()).toContain('[-]');
    expect(getOutput()).toContain('9/9.1 Story One');

    result.unmount();
  });

  it('(j) fully-done epic is hidden from tree', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Done Story', epicKey: '9', epicTitle: 'Epic Nine', status: 'done' }),
      makeStory({ id: 2, storyKey: '10.1', title: 'Pending Story', epicKey: '10', epicTitle: 'Epic Ten', status: 'pending' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();
    const output = getOutput();

    expect(output).not.toContain('9: Epic Nine');
    expect(output).toContain('10: Epic Ten');

    result.unmount();
  });

  it('(k) hidden-count message shown with correct count', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', epicKey: '9', epicTitle: 'Epic Nine', status: 'done' }),
      makeStory({ id: 2, storyKey: '10.1', epicKey: '10', epicTitle: 'Epic Ten', status: 'done' }),
      makeStory({ id: 3, storyKey: '11.1', epicKey: '11', epicTitle: 'Epic Eleven', status: 'done' }),
      makeStory({ id: 4, storyKey: '12.1', epicKey: '12', epicTitle: 'Epic Twelve', status: 'pending' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();
    const output = getOutput();

    expect(output).toContain('3 epics hidden');
    expect(output).toContain('all stories done or shipped');

    result.unmount();
  });

  it('(l) singular epic hidden message when exactly 1 epic hidden', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', epicKey: '9', epicTitle: 'Epic Nine', status: 'done' }),
      makeStory({ id: 2, storyKey: '10.1', epicKey: '10', epicTitle: 'Epic Ten', status: 'pending' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();
    const output = getOutput();

    expect(output).toContain('1 epic hidden');
    expect(output).not.toContain('1 epics hidden');

    result.unmount();
  });

  it('(m) all epics done: hidden count message AND no stories available shown', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', epicKey: '9', epicTitle: 'Epic Nine', status: 'done' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();
    const output = getOutput();

    expect(output).toContain('1 epic hidden');
    expect(output).toContain('No stories available');

    result.unmount();
  });

  it('(n) mixed epic stays visible — ineligible stories show [!], eligible show [ ]', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Done Story', epicKey: '9', epicTitle: 'Epic Nine', status: 'done' }),
      makeStory({ id: 2, storyKey: '9.2', title: 'Pending Story', epicKey: '9', epicTitle: 'Epic Nine', status: 'pending' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();
    const output = getOutput();

    expect(output).toContain('9: Epic Nine');
    expect(output).toContain('[!]');
    expect(output).toContain('[ ]');
    expect(output).not.toContain('1 epic hidden');

    result.unmount();
  });

  it('(o) no hidden message when no epics are fully done', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', epicKey: '9', epicTitle: 'Epic Nine', status: 'pending' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();
    const output = getOutput();

    expect(output).not.toContain('hidden');

    result.unmount();
  });

  it('(i) Enter with zero selections does nothing', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Story One' }),
    ]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();

    getSelectHandler()('', { ...EMPTY_KEY, return: true });
    await tick(100);

    expect(getOutput()).toContain('Select stories to ship');
    expect(getOutput()).not.toContain('Shipping stories');
    expect(getOutput()).not.toContain('Press any key to exit');
    expect(mockShipStories).not.toHaveBeenCalled();

    result.unmount();
  });
});
