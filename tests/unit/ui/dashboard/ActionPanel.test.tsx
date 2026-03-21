import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, Text } from 'ink';
import { PassThrough } from 'node:stream';
import { ActionPanel } from '@ui/dashboard/command-menu/ActionPanel';

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

describe('ActionPanel', () => {
  it('renders idleContent when actionMode is none', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ActionPanel, {
        actionMode: 'none',
        idleContent: React.createElement(Text, null, 'idle-content'),
        activeContent: React.createElement(Text, null, 'active-content'),
      }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('idle-content');
    expect(output).not.toContain('active-content');
    result.unmount();
  });

  it('renders activeContent when actionMode is load', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ActionPanel, {
        actionMode: 'load',
        idleContent: React.createElement(Text, null, 'idle-content'),
        activeContent: React.createElement(Text, null, 'active-content'),
      }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('active-content');
    expect(output).not.toContain('idle-content');
    result.unmount();
  });

  it('renders activeContent when actionMode is ship', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ActionPanel, {
        actionMode: 'ship',
        idleContent: React.createElement(Text, null, 'idle-content'),
        activeContent: React.createElement(Text, null, 'active-content'),
      }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('active-content');
    result.unmount();
  });

  it('renders activeContent when actionMode is diagnose', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ActionPanel, {
        actionMode: 'diagnose',
        idleContent: React.createElement(Text, null, 'idle-content'),
        activeContent: React.createElement(Text, null, 'active-content'),
      }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('active-content');
    result.unmount();
  });

  it('renders activeContent when actionMode is config', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ActionPanel, {
        actionMode: 'config',
        idleContent: React.createElement(Text, null, 'idle-content'),
        activeContent: React.createElement(Text, null, 'active-content'),
      }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('active-content');
    result.unmount();
  });

  it('renders activeContent when actionMode is help', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ActionPanel, {
        actionMode: 'help',
        idleContent: React.createElement(Text, null, 'idle-content'),
        activeContent: React.createElement(Text, null, 'active-content'),
      }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('active-content');
    result.unmount();
  });

  it('renders nothing when activeContent is null and actionMode is not none', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ActionPanel, {
        actionMode: 'load',
        idleContent: React.createElement(Text, null, 'idle-content'),
        activeContent: null,
      }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).not.toContain('idle-content');
    result.unmount();
  });

  it('renders without crashing with null activeContent and none actionMode', () => {
    const result = render(
      React.createElement(ActionPanel, {
        actionMode: 'none',
        idleContent: React.createElement(Text, null, 'idle'),
        activeContent: null,
      }),
    );
    expect(result).toBeDefined();
    result.unmount();
  });

  describe('border rendering (Story 15.8 visual polish)', () => {
    it('wraps activeContent in bordered box when actionMode is load', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(ActionPanel, {
          actionMode: 'load',
          idleContent: React.createElement(Text, null, 'idle'),
          activeContent: React.createElement(Text, null, 'wizard-content'),
        }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('wizard-content');
      // single borderStyle renders box-drawing characters ┌ ─ ┐ │ └ ┘
      const hasBorderChar = output.includes('┌') || output.includes('│') || output.includes('─');
      expect(hasBorderChar).toBe(true);
      result.unmount();
    });

    it('wraps activeContent in bordered box when actionMode is ship', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(ActionPanel, {
          actionMode: 'ship',
          idleContent: React.createElement(Text, null, 'idle'),
          activeContent: React.createElement(Text, null, 'ship-wizard'),
        }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('ship-wizard');
      const hasBorderChar = output.includes('┌') || output.includes('│') || output.includes('─');
      expect(hasBorderChar).toBe(true);
      result.unmount();
    });

    it('wraps activeContent in bordered box when actionMode is diagnose', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(ActionPanel, {
          actionMode: 'diagnose',
          idleContent: React.createElement(Text, null, 'idle'),
          activeContent: React.createElement(Text, null, 'diagnose-wizard'),
        }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('diagnose-wizard');
      const hasBorderChar = output.includes('┌') || output.includes('│') || output.includes('─');
      expect(hasBorderChar).toBe(true);
      result.unmount();
    });

    it('wraps activeContent in bordered box when actionMode is config', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(ActionPanel, {
          actionMode: 'config',
          idleContent: React.createElement(Text, null, 'idle'),
          activeContent: React.createElement(Text, null, 'config-wizard'),
        }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('config-wizard');
      const hasBorderChar = output.includes('┌') || output.includes('│') || output.includes('─');
      expect(hasBorderChar).toBe(true);
      result.unmount();
    });

    it('wraps activeContent in bordered box when actionMode is help', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(ActionPanel, {
          actionMode: 'help',
          idleContent: React.createElement(Text, null, 'idle'),
          activeContent: React.createElement(Text, null, 'help-content'),
        }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('help-content');
      const hasBorderChar = output.includes('┌') || output.includes('│') || output.includes('─');
      expect(hasBorderChar).toBe(true);
      result.unmount();
    });

    it('does NOT render border when actionMode is none (idle path unchanged)', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(ActionPanel, {
          actionMode: 'none',
          idleContent: React.createElement(Text, null, 'idle-menu'),
          activeContent: React.createElement(Text, null, 'wizard'),
        }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('idle-menu');
      // idle path has no bordered wrapper — no top-left corner char
      expect(output).not.toContain('┌');
      result.unmount();
    });

    it('renders border with null activeContent and active mode (no crash)', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(ActionPanel, {
          actionMode: 'mark-done',
          idleContent: React.createElement(Text, null, 'idle'),
          activeContent: null,
        }),
        { stdout: stream },
      );
      await tick();
      // should not contain idle content
      expect(getOutput()).not.toContain('idle');
      result.unmount();
    });
  });
});
