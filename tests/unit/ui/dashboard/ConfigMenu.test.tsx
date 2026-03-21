import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { ConfigMenu } from '@ui/dashboard/ConfigMenu.js';
import { Text } from 'ink';

vi.mock('@inkjs/ui', () => ({
  Select: ({ options }: { options: Array<{ label: string; value: string }> }) => (
    <>
      {options.map((opt) => (
        <Text key={opt.value}>{opt.label}</Text>
      ))}
    </>
  ),
}));

function makeStream() {
  const stream = new PassThrough() as NodeJS.WriteStream & { columns: number };
  stream.columns = 80;
  let output = '';
  stream.on('data', (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  const stripAnsi = (str: string): string =>
    str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');
  return { stream, getOutput: () => stripAnsi(output) };
}

describe('ConfigMenu', () => {
  it('renders all config options', async () => {
    const { stream, getOutput } = makeStream();
    render(
      <ConfigMenu onSelect={vi.fn()} onBack={vi.fn()} />,
      { stdout: stream }
    );

    await new Promise(r => setTimeout(r, 50));

    const output = getOutput();
    expect(output).toContain('View Current Config');
    expect(output).toContain('Change Active Team');
    expect(output).toContain('Change Models');
    expect(output).toContain('Switch Provider');
    expect(output).toContain('[P] Provider');
    expect(output).toContain('[Q] Back');
  });
});
