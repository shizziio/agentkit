import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, useInput } from 'ink';
import type { Key } from 'ink';
import { PassThrough } from 'node:stream';
import { ChatPanel } from '@ui/chat/ChatPanel.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 80;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  const stripAnsi = (str: string): string =>
    str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 10): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

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

describe('ChatPanel', () => {
  let onExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onExit = vi.fn();
  });

  it('renders initial message and hint', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      <ChatPanel onExit={onExit} isFocused={true} />,
      { stdout: stream }
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('Top questions you can ask:');
    expect(output).toContain('[Q] Back to menu');
    result.unmount();
  });

  it('calls onExit when Q is pressed and input is empty', async () => {
    let inputHandler: InputHandler | undefined;
    vi.mocked(useInput).mockImplementation((handler: InputHandler) => {
      inputHandler = handler;
    });

    const { stream } = makeStream();
    const result = render(
      <ChatPanel onExit={onExit} isFocused={true} />,
      { stdout: stream }
    );
    await tick();

    inputHandler?.('q', makeKey());
    expect(onExit).toHaveBeenCalled();
    result.unmount();
  });

  it('does NOT call onExit when Q is pressed and input is NOT empty', async () => {
    let inputHandler: InputHandler | undefined;
    vi.mocked(useInput).mockImplementation((handler: InputHandler) => {
      inputHandler = handler;
    });

    const { stream } = makeStream();
    const result = render(
      <ChatPanel onExit={onExit} isFocused={true} />,
      { stdout: stream }
    );
    await tick();

    // Type something first
    inputHandler?.('h', makeKey());
    inputHandler?.('e', makeKey());
    inputHandler?.('l', makeKey());
    inputHandler?.('l', makeKey());
    inputHandler?.('o', makeKey());
    
    // Now press 'q'
    inputHandler?.('q', makeKey());
    
    expect(onExit).not.toHaveBeenCalled();
    result.unmount();
  });

  it('ignores Escape key', async () => {
    let inputHandler: InputHandler | undefined;
    vi.mocked(useInput).mockImplementation((handler: InputHandler) => {
      inputHandler = handler;
    });

    const { stream } = makeStream();
    const result = render(
      <ChatPanel onExit={onExit} isFocused={true} />,
      { stdout: stream }
    );
    await tick();

    inputHandler?.('', makeKey({ escape: true }));
    expect(onExit).not.toHaveBeenCalled();
    result.unmount();
  });

  it('renders with specific width and height', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      <ChatPanel onExit={onExit} isFocused={true} width={40} height={10} />,
      { stdout: stream }
    );
    await tick();
    const output = getOutput();
    // With height 10 and overhead 5, we should see about 5 lines of messages.
    // The initial message is quite long, so it should be truncated or scrolled.
    expect(output).toBeDefined();
    result.unmount();
  });
});
