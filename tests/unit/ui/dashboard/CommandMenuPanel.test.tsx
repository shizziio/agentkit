import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { CommandMenuPanel } from '@ui/dashboard/command-menu/CommandMenuPanel.js';
import type { EventBus } from '@core/EventBus.js';
import type { UseMenuStack } from '@ui/dashboard/hooks/useMenuStack.js';

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

describe('CommandMenuPanel', () => {
  const mockEventBus = {} as unknown as EventBus;
  const mockMenuStack: UseMenuStack = {
    stack: ['main'],
    currentLevel: 'main',
    push: vi.fn(),
    pop: vi.fn(),
    handleQ: vi.fn(),
  };

  it('renders without crashing', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      <CommandMenuPanel
        eventBus={mockEventBus}
        onSelectAction={vi.fn()}
        menuStack={mockMenuStack}
        isFocused={true}
      />,
      { stdout: stream }
    );
    await tick();
    expect(getOutput()).toContain('Command Menu');
    result.unmount();
  });

  it('shows sub-menu indicator for Epic & Story Management', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      <CommandMenuPanel
        eventBus={mockEventBus}
        onSelectAction={vi.fn()}
        menuStack={mockMenuStack}
        isFocused={true}
      />,
      { stdout: stream }
    );
    await tick();
    expect(getOutput()).toContain('Epic & Story Mgmt ─►');
    result.unmount();
  });

  it('renders different title based on menu level', async () => {
    const { stream, getOutput } = makeStream();
    const mockConfigStack: UseMenuStack = {
      ...mockMenuStack,
      currentLevel: 'config',
    };

    const result = render(
      <CommandMenuPanel
        eventBus={mockEventBus}
        onSelectAction={vi.fn()}
        menuStack={mockConfigStack}
        isFocused={true}
      />,
      { stdout: stream }
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('Configuration');
    expect(output).toContain('Change Active Team');
    result.unmount();
  });

  it('renders Epic & Story Management title and options', async () => {
    const { stream, getOutput } = makeStream();
    const mockEpicStack: UseMenuStack = {
      ...mockMenuStack,
      currentLevel: 'epic-story-mgmt',
    };

    const result = render(
      <CommandMenuPanel
        eventBus={mockEventBus}
        onSelectAction={vi.fn()}
        menuStack={mockEpicStack}
        isFocused={true}
      />,
      { stdout: stream }
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('Epic & Story Management');
    expect(output).toContain('Mark Story Done');
    result.unmount();
  });
});
