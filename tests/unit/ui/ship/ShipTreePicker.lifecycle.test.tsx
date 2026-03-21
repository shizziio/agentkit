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

function getDoneHandler(): InputHandler {
  return capturedInputs[capturedInputs.length - 1].handler;
}

// ---------------------------------------------------------------------------
// Tests: shipping flow, error, compact, empty state
// ---------------------------------------------------------------------------
describe('ShipTreePicker — lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInputs = [];
    mockGetStories.mockReturnValue([]);
    mockShipStories.mockReturnValue({ shippedCount: 0 });
  });

  it('(f) Enter with selections triggers ship and shows success', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 42, storyKey: '9.1', title: 'Ship Me' }),
    ]);
    mockShipStories.mockReturnValue({ shippedCount: 1 });

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();

    getSelectHandler()('a', EMPTY_KEY);
    await tick();

    getSelectHandler()('', { ...EMPTY_KEY, return: true });
    await tick(100);

    const output = getOutput();
    expect(output).toContain('Shipped 1 stories into pipeline');
    expect(output).toContain('Press any key to exit');

    result.unmount();
  });

  it('shows "No stories available" when DB has no stories', async () => {
    mockGetStories.mockReturnValue([]);

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();

    expect(getOutput()).toContain('No stories available');

    result.unmount();
  });

  it('done step — any key calls onComplete', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Story One' }),
    ]);
    mockShipStories.mockReturnValue({ shippedCount: 1 });

    const onComplete = vi.fn();
    const { stream } = makeStream();
    const result = render(
      React.createElement(ShipTreePicker, makeProps({ onComplete })),
      { stdout: stream },
    );

    await tick();

    getSelectHandler()('a', EMPTY_KEY);
    await tick();
    getSelectHandler()('', { ...EMPTY_KEY, return: true });
    await tick(100);

    getDoneHandler()('', EMPTY_KEY);
    await tick();

    expect(onComplete).toHaveBeenCalledTimes(1);

    result.unmount();
  });

  it('shows error when shipStories throws', async () => {
    mockGetStories.mockReturnValue([
      makeStory({ id: 1, storyKey: '9.1', title: 'Story One' }),
    ]);
    mockShipStories.mockImplementation(() => {
      throw new Error('DB write failed');
    });

    const { stream, getOutput } = makeStream();
    const result = render(React.createElement(ShipTreePicker, makeProps()), { stdout: stream });

    await tick();

    getSelectHandler()('a', EMPTY_KEY);
    await tick();
    getSelectHandler()('', { ...EMPTY_KEY, return: true });
    await tick(100);

    expect(getOutput()).toContain('DB write failed');

    result.unmount();
  });

  it('compact=true renders without crashing', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(ShipTreePicker, makeProps({ compact: true })),
      { stdout: stream },
    );
    await tick();
    expect(result).toBeDefined();
    result.unmount();
  });
});
