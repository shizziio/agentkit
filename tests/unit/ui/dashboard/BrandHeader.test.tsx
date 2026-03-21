import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

import { BrandHeader } from '@ui/dashboard/brand/BrandHeader';
import type { WorkerStatusEntry } from '@ui/dashboard/shared/DashboardTypes';
import type { QueueStats } from '@ui/stores/workerStore';

const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 120;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('BrandHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    projectName: 'my-project',
    isPipelineRunning: false,
    workerStatuses: [] as WorkerStatusEntry[],
    queueStats: null as QueueStats | null,
  };

  it('renders APP_NAME "AgentKit"', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, defaultProps),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('AgentKit');
    result.unmount();
  });

  it('renders version string', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, defaultProps),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('v1.0.0');
    result.unmount();
  });

  it('renders projectName', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, projectName: 'cool-pipeline' }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('cool-pipeline');
    result.unmount();
  });

  it('shows "● Running" when isPipelineRunning=true', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, isPipelineRunning: true }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('●');
    expect(output).toContain('Running');
    result.unmount();
  });

  it('shows "○ Stopped" when isPipelineRunning=false', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, isPipelineRunning: false }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('○');
    expect(output).toContain('Stopped');
    result.unmount();
  });

  it('shows worker statuses when workers are present', async () => {
    const workerStatuses: WorkerStatusEntry[] = [
      { stageName: 'dev', displayName: 'Dev', status: 'run', runStartedAt: Date.now() },
      { stageName: 'sm', displayName: 'Sm', status: 'idle', runStartedAt: null },
    ];
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, isPipelineRunning: true, workerStatuses }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('Dev');
    expect(output).toContain('Sm');
    result.unmount();
  });

  it('shows queue stats when pipeline running and queueStats non-null', async () => {
    const queueStats: QueueStats = { done: 5, queued: 3, failed: 1 };
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, isPipelineRunning: true, queueStats }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('done:');
    expect(output).toContain('5');
    expect(output).toContain('queue:');
    expect(output).toContain('3');
    expect(output).toContain('fail:');
    expect(output).toContain('1');
    result.unmount();
  });

  it('hides queue stats when pipeline is stopped', async () => {
    const queueStats: QueueStats = { done: 5, queued: 3, failed: 1 };
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, isPipelineRunning: false, queueStats }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).not.toContain('done:');
    expect(output).not.toContain('queue:');
    result.unmount();
  });

  it('renders team name when activeTeam is provided', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, activeTeam: 'agentkit' }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('team:');
    expect(output).toContain('agentkit');
    result.unmount();
  });

  it('renders provider when activeProvider is provided', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, activeProvider: 'claude-cli' }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('provider:');
    expect(output).toContain('claude-cli');
    result.unmount();
  });

  it('shows default hints when isActionActive=false', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, isActionActive: false }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('[↑↓] Navigate');
    expect(output).toContain('[Enter] Select');
    expect(output).toContain('[Q] Back/Quit');
    result.unmount();
  });

  it('shows action hints when isActionActive=true', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(BrandHeader, { ...defaultProps, isActionActive: true }),
      { stdout: stream },
    );
    await tick();
    const output = getOutput();
    expect(output).toContain('[Q] Back');
    expect(output).not.toContain('[↑↓] Navigate');
    result.unmount();
  });
});
