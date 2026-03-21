import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import type { PipelineConfig, ProjectConfig } from '@core/ConfigTypes.js';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
    useStdout: vi.fn().mockReturnValue({ stdout: { rows: 40 } }),
  };
});

vi.mock('@ui/shared/ScrollablePanel.js', async () => {
  const { Text, Box } = await import('ink');
  return {
    ScrollablePanel: ({ lines, title }: { lines: string[]; title: string }) => (
      <Box flexDirection="column">
        <Text>{title}</Text>
        {lines.map((line: string, i: number) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    ),
  };
});

import { ConfigViewer } from '@ui/config/ConfigViewer.js';

const makePipelineConfig = (): PipelineConfig => ({
  project: { name: 'test-proj', id: 'proj-1', owner: 'Alice' },
  team: { name: 'team-alpha', id: 'team-1' },
  provider: { name: 'claude' },
  stages: [
    { name: 'sm', displayName: 'Story Manager', icon: '📋', workers: 1, retries: 2 },
    { name: 'dev', displayName: 'Developer', icon: '💻', workers: 2, retries: 3 },
  ],
  models: {
    resolved: { sm: 'claude-opus', dev: 'claude-sonnet' },
    allowed: ['claude-opus', 'claude-sonnet', 'claude-haiku'],
  },
} as unknown as PipelineConfig);

const makeProjectConfig = (): ProjectConfig => ({
  version: 2,
  project: { name: 'test-proj', id: 'proj-1', owner: 'Alice' },
  activeTeam: 'team-alpha',
  teams: ['team-alpha', 'team-beta'],
  provider: { name: 'claude' },
  models: { claude: { sm: 'claude-opus', dev: 'claude-sonnet' } },
} as unknown as ProjectConfig);

function makeStream() {
  const pt = new PassThrough();
  const stream = Object.assign(pt, {
    columns: 100,
    rows: 40,
    isTTY: true,
    getColorDepth: vi.fn<() => number>().mockReturnValue(8),
  }) as unknown as NodeJS.WriteStream;

  let output = '';
  stream.on('data', (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  const stripAnsi = (str: string): string =>
    str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');
  return { stream, getOutput: () => stripAnsi(output) };
}

describe('ConfigViewer', () => {
  it('renders config title', async () => {
    const { stream, getOutput } = makeStream();
    render(
      <ConfigViewer
        pipeline={makePipelineConfig()}
        projectConfig={makeProjectConfig()}
        onBack={vi.fn()}
      />,
      { stdout: stream }
    );

    await new Promise(r => setTimeout(r, 50));

    const output = getOutput();
    expect(output).toContain('Current AgentKit Configuration');
  });

  it('displays project name and active team', async () => {
    const { stream, getOutput } = makeStream();
    render(
      <ConfigViewer
        pipeline={makePipelineConfig()}
        projectConfig={makeProjectConfig()}
        onBack={vi.fn()}
      />,
      { stdout: stream }
    );

    await new Promise(r => setTimeout(r, 50));

    const output = getOutput();
    expect(output).toContain('test-proj');
    expect(output).toContain('team-alpha');
  });

  it('displays all configured teams', async () => {
    const { stream, getOutput } = makeStream();
    render(
      <ConfigViewer
        pipeline={makePipelineConfig()}
        projectConfig={makeProjectConfig()}
        onBack={vi.fn()}
      />,
      { stdout: stream }
    );

    await new Promise(r => setTimeout(r, 50));

    const output = getOutput();
    expect(output).toContain('team-alpha');
    expect(output).toContain('team-beta');
  });
});
