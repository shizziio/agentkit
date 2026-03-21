import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { render, useInput, useStdout } from 'ink';
import type { Key } from 'ink';
import { PassThrough } from 'node:stream';

import { ScrollablePanel } from '@ui/shared/ScrollablePanel.js';

/**
 * Helper to create a properly typed mock write stream for Ink tests.
 * Avoids brute-force 'as any' or 'as unknown as' casts by satisfying the interface.
 */
function createMockWriteStream(rows = 40, columns = 80): NodeJS.WriteStream {
  const pt = new PassThrough();
  Object.assign(pt, {
    rows,
    columns,
    isTTY: true,
    getColorDepth: vi.fn().mockReturnValue(8),
  });
  return pt as unknown as NodeJS.WriteStream;
}

// Mock useInput and useStdout from ink
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
    useStdout: vi.fn(() => ({
      stdout: createMockWriteStream(40, 80),
    })),
  };
});

function makeStream(): {
  stream: NodeJS.WriteStream;
  getOutput: () => string;
  clear: () => void;
} {
  const stream = createMockWriteStream(40, 80);
  let output = '';
  stream.on('data', (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  const stripAnsi = (s: string): string =>
    s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B[()][A-Z]/g, '');
  return {
    stream,
    getOutput: () => stripAnsi(output),
    clear: () => {
      output = '';
    },
  };
}

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeKey(partial: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...partial,
  };
}

type InputHandler = (input: string, key: Key) => void;

describe('ScrollablePanel', () => {
  let inputHandlers: InputHandler[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    inputHandlers = [];
    vi.mocked(useInput).mockImplementation((handler: InputHandler) => {
      inputHandlers = [handler];
    });
    vi.mocked(useStdout).mockReturnValue({
      stdout: createMockWriteStream(40, 80),
      write: vi.fn(),
    });
  });

  async function fireKey(input: string, key: Partial<Key> = {}): Promise<void> {
    const k = makeKey(key);
    await act(async () => {
      inputHandlers.forEach((h) => h(input, k));
    });
    await tick(50);
  }

  it('renders correctly with given lines and height', async () => {
    const { stream, getOutput } = makeStream();
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);

    const { unmount } = render(
      <ScrollablePanel lines={lines} height={10} title="Test Panel" />,
      { stdout: stream }
    );

    await tick();
    const output = getOutput();
    expect(output).toContain('Test Panel');
    expect(output).toContain('Line 1');
    expect(output).toContain('Line 10');
    expect(output).not.toContain('Line 11\n');
    unmount();
  });

  it('scrolls down when downArrow is pressed', async () => {
    const { stream, getOutput, clear } = makeStream();
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`);

    const { unmount } = render(
      <ScrollablePanel lines={lines} height={10} autoScrollToBottom={false} />,
      { stdout: stream }
    );

    await tick(100);
    clear();

    await fireKey('', { downArrow: true });
    const output = getOutput();
    expect(output).toContain('Line 2');
    expect(output).toContain('Line 11');
    expect(output).not.toContain('Line 1 ');

    unmount();
  });

  it('auto-scrolls to bottom when lines are added and autoScrollToBottom is true', async () => {
    const { stream, getOutput, clear } = makeStream();
    const { rerender, unmount } = render(
      <ScrollablePanel lines={['L1', 'L2']} height={5} autoScrollToBottom={true} />,
      { stdout: stream }
    );

    await tick(100);
    clear();

    await act(async () => {
      rerender(<ScrollablePanel lines={['L1', 'L2', 'L3', 'L4', 'L5', 'L6']} height={5} autoScrollToBottom={true} />);
    });
    clear();
    await tick(100);

    const output = getOutput();
    expect(output).toContain('L2');
    expect(output).toContain('L6');
    expect(output).not.toContain('L1');

    unmount();
  });

  it('pauses auto-scroll when user scrolls up', async () => {
    const { stream, getOutput, clear } = makeStream();
    const { rerender, unmount } = render(
      <ScrollablePanel lines={['L1', 'L2', 'L3', 'L4', 'L5', 'L6']} height={5} autoScrollToBottom={true} />,
      { stdout: stream }
    );

    await tick(100);
    clear();

    await fireKey('', { upArrow: true });
    expect(getOutput()).toContain('L1');
    expect(getOutput()).not.toContain('L6\n');
    clear();

    await act(async () => {
      rerender(<ScrollablePanel lines={['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']} height={5} autoScrollToBottom={true} />);
    });
    await tick(100);

    expect(getOutput()).toContain('L1');
    expect(getOutput()).not.toContain('L8');

    unmount();
  });

  it('resumes auto-scroll when user scrolls back to bottom', async () => {
    const { stream, getOutput, clear } = makeStream();
    const { rerender, unmount } = render(
      <ScrollablePanel lines={['L1', 'L2', 'L3', 'L4', 'L5', 'L6']} height={5} autoScrollToBottom={true} />,
      { stdout: stream }
    );

    await tick(50);
    await fireKey('', { upArrow: true }); // pause
    clear();

    await fireKey('', { downArrow: true });
    clear();

    await act(async () => {
      rerender(<ScrollablePanel lines={['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']} height={5} autoScrollToBottom={true} />);
    });
    await tick(100);

    expect(getOutput()).toContain('L8');

    unmount();
  });

  it('calls onExit when Q is pressed', async () => {
    const onExit = vi.fn<() => void>();
    const { unmount } = render(
      <ScrollablePanel lines={['L1']} height={5} onExit={onExit} />
    );

    await fireKey('q');
    expect(onExit).toHaveBeenCalled();

    unmount();
  });

  it('clamps height based on terminal rows', async () => {
    vi.mocked(useStdout).mockReturnValue({
      stdout: createMockWriteStream(10, 80),
      write: vi.fn(),
    });

    const { stream, getOutput } = makeStream();
    const { unmount } = render(
      <ScrollablePanel lines={Array.from({ length: 50 }, (_, i) => `Line ${i}`)} height={50} title="Big Panel" />,
      { stdout: stream }
    );

    await tick();
    const output = getOutput();
    expect(output).toContain('Line 0');
    expect(output).toContain('Line 3');
    expect(output).not.toContain('Line 4\n');

    unmount();
  });
});
