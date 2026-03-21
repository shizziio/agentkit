import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

import { StoryActionPicker } from '@ui/dashboard/modals/StoryActionPicker';
import type { ResetTarget } from '@core/ResetTypes';

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

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

const mockTargets: ResetTarget[] = [
  { stageName: 'sm', displayName: 'Story Manager', icon: '📋' },
  { stageName: 'dev', displayName: 'Developer', icon: '💻' },
];

const emptyKey = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  insert: false,
  meta: false,
  f1: false, f2: false, f3: false, f4: false, f5: false,
  f6: false, f7: false, f8: false, f9: false, f10: false,
  f11: false, f12: false,
};

describe('StoryActionPicker', () => {
  let onSelect: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const ink = await import('ink');
    vi.mocked(ink.useInput).mockReset();
    onSelect = vi.fn();
    onCancel = vi.fn();
  });

  it('(a) renders numbered list of targets with storyKey in header', async () => {
    const { stream, getOutput } = makeStream();
    const r = render(
      React.createElement(StoryActionPicker, {
        targets: mockTargets,
        storyKey: '1.1',
        onSelect,
        onCancel,
      }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('1.1');
    expect(output).toContain('[1]');
    expect(output).toContain('Story Manager');
    expect(output).toContain('[2]');
    expect(output).toContain('Developer');
    r.unmount();
  });

  it('(b) pressing "1" calls onSelect with targets[0].stageName', async () => {
    const ink = await import('ink');
    let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
    vi.mocked(ink.useInput).mockImplementation((cb) => {
      capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
    });

    const r = render(
      React.createElement(StoryActionPicker, {
        targets: mockTargets,
        storyKey: '1.1',
        onSelect,
        onCancel,
      }),
    );

    expect(capturedCallback).not.toBeNull();
    capturedCallback!('1', { ...emptyKey });
    expect(onSelect).toHaveBeenCalledWith('sm');
    expect(onCancel).not.toHaveBeenCalled();
    r.unmount();
  });

  it('(c) pressing Esc calls onCancel', async () => {
    const ink = await import('ink');
    let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
    vi.mocked(ink.useInput).mockImplementation((cb) => {
      capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
    });

    const r = render(
      React.createElement(StoryActionPicker, {
        targets: mockTargets,
        storyKey: '1.1',
        onSelect,
        onCancel,
      }),
    );

    expect(capturedCallback).not.toBeNull();
    capturedCallback!('', { ...emptyKey, escape: true });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    r.unmount();
  });

  it('(d) pressing a digit > target count does nothing', async () => {
    const ink = await import('ink');
    let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
    vi.mocked(ink.useInput).mockImplementation((cb) => {
      capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
    });

    const r = render(
      React.createElement(StoryActionPicker, {
        targets: mockTargets,
        storyKey: '1.1',
        onSelect,
        onCancel,
      }),
    );

    expect(capturedCallback).not.toBeNull();
    capturedCallback!('9', { ...emptyKey }); // only 2 targets
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    r.unmount();
  });

  it('(e) empty targets list renders gracefully', async () => {
    const { stream, getOutput } = makeStream();
    const r = render(
      React.createElement(StoryActionPicker, {
        targets: [],
        storyKey: '2.3',
        onSelect,
        onCancel,
      }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('2.3');
    expect(output).toContain('(no targets)');
    r.unmount();
  });
});
