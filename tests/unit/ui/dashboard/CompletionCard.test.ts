import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

import { CompletionCard } from '@ui/dashboard/live-activity/CompletionCard';
import { formatDuration } from '@ui/dashboard/shared/utils';

const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 100;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('CompletionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with story title', async () => {
    const { stream, getOutput } = makeStream();

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: 'Implement user login',
        stageDurations: [],
        totalDurationMs: 60000,
        totalAttempts: 1,
      }),
      { stdout: stream },
    );

    await tick();
    expect(getOutput()).toContain('COMPLETED');
    expect(getOutput()).toContain('Implement user login');

    result.unmount();
  });

  it('renders stage durations with formatDuration', async () => {
    const { stream, getOutput } = makeStream();

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: 'Test story',
        stageDurations: [
          { stageName: 'sm', durationMs: 15000 },
          { stageName: 'dev', durationMs: 120000 },
          { stageName: 'review', durationMs: 45000 },
        ],
        totalDurationMs: 180000,
        totalAttempts: 2,
      }),
      { stdout: stream },
    );

    await tick();
    const output = getOutput();

    // Should show formatted durations
    expect(output).toContain('15s'); // sm: 15s
    expect(output).toContain('2m 0s'); // dev: 120s = 2m 0s
    expect(output).toContain('45s'); // review: 45s
    expect(output).toContain('3m 0s'); // total: 180s = 3m 0s

    result.unmount();
  });

  it('displays total duration and attempts correctly', async () => {
    const { stream, getOutput } = makeStream();

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: 'Another test',
        stageDurations: [],
        totalDurationMs: 90000,
        totalAttempts: 3,
      }),
      { stdout: stream },
    );

    await tick();
    const output = getOutput();

    expect(output).toContain('1m 30s'); // 90s formatted
    expect(output).toContain('Attempts: 3');

    result.unmount();
  });

  it('renders with empty stage durations', async () => {
    const { stream, getOutput } = makeStream();

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: 'Single stage story',
        stageDurations: [],
        totalDurationMs: 30000,
        totalAttempts: 1,
      }),
      { stdout: stream },
    );

    await tick();
    const output = getOutput();

    expect(output).toContain('COMPLETED');
    expect(output).toContain('Single stage story');
    expect(output).toContain('30s');

    result.unmount();
  });

  it('renders multiple stages in order', async () => {
    const { stream, getOutput } = makeStream();

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: 'Multi-stage story',
        stageDurations: [
          { stageName: 'sm', durationMs: 10000 },
          { stageName: 'dev', durationMs: 60000 },
          { stageName: 'review', durationMs: 20000 },
          { stageName: 'tester', durationMs: 30000 },
        ],
        totalDurationMs: 120000,
        totalAttempts: 1,
      }),
      { stdout: stream },
    );

    await tick();
    const output = getOutput();

    // Verify stages appear in order with proper formatting
    const smIndex = output.indexOf('sm');
    const devIndex = output.indexOf('dev');
    const reviewIndex = output.indexOf('review');
    const testerIndex = output.indexOf('tester');

    expect(smIndex).toBeLessThan(devIndex);
    expect(devIndex).toBeLessThan(reviewIndex);
    expect(reviewIndex).toBeLessThan(testerIndex);

    // Verify durations are formatted correctly
    expect(output).toContain('10s'); // sm
    expect(output).toContain('1m 0s'); // dev: 60s
    expect(output).toContain('20s'); // review
    expect(output).toContain('30s'); // tester

    result.unmount();
  });

  it('renders with high attempt count', async () => {
    const { stream, getOutput } = makeStream();

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: 'Retried story',
        stageDurations: [{ stageName: 'review', durationMs: 300000 }],
        totalDurationMs: 300000,
        totalAttempts: 5,
      }),
      { stdout: stream },
    );

    await tick();
    const output = getOutput();

    expect(output).toContain('Attempts: 5');
    expect(output).toContain('5m 0s'); // 300s = 5m 0s

    result.unmount();
  });

  it('renders long story title without crashing', async () => {
    const { stream, getOutput } = makeStream();

    const longTitle = 'Implement comprehensive user authentication system with OAuth2 and JWT tokens';

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: longTitle,
        stageDurations: [],
        totalDurationMs: 60000,
        totalAttempts: 1,
      }),
      { stdout: stream },
    );

    await tick();
    expect(getOutput()).toContain('COMPLETED');
    expect(getOutput()).toContain(longTitle.substring(0, 50));

    result.unmount();
  });

  it('renders with zero duration without crashing', async () => {
    const { stream, getOutput } = makeStream();

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: 'Instant story',
        stageDurations: [{ stageName: 'sm', durationMs: 0 }],
        totalDurationMs: 0,
        totalAttempts: 1,
      }),
      { stdout: stream },
    );

    await tick();
    const output = getOutput();

    expect(output).toContain('0s');

    result.unmount();
  });

  it('uses formatDuration for consistent time formatting', async () => {
    const { stream, getOutput } = makeStream();

    const testDuration = 125000; // Should be 2m 5s
    const expectedFormatted = formatDuration(testDuration);

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: 'Format test',
        stageDurations: [{ stageName: 'dev', durationMs: testDuration }],
        totalDurationMs: testDuration,
        totalAttempts: 1,
      }),
      { stdout: stream },
    );

    await tick();
    expect(getOutput()).toContain(expectedFormatted);

    result.unmount();
  });

  it('renders with special characters in stage name', async () => {
    const { stream, getOutput } = makeStream();

    const result = render(
      React.createElement(CompletionCard, {
        storyTitle: 'Test story',
        stageDurations: [
          { stageName: 'qa-review', durationMs: 30000 },
          { stageName: 'final_check', durationMs: 20000 },
        ],
        totalDurationMs: 50000,
        totalAttempts: 1,
      }),
      { stdout: stream },
    );

    await tick();
    const output = getOutput();

    expect(output).toContain('qa-review');
    expect(output).toContain('final_check');

    result.unmount();
  });

  it('renders completed state consistently across multiple calls', async () => {
    const props = {
      storyTitle: 'Consistent story',
      stageDurations: [{ stageName: 'dev', durationMs: 90000 }],
      totalDurationMs: 90000,
      totalAttempts: 2,
    };

    const { stream: stream1, getOutput: getOutput1 } = makeStream();
    const result1 = render(React.createElement(CompletionCard, props), { stdout: stream1 });
    await tick();
    const output1 = getOutput1();

    const { stream: stream2, getOutput: getOutput2 } = makeStream();
    const result2 = render(React.createElement(CompletionCard, props), { stdout: stream2 });
    await tick();
    const output2 = getOutput2();

    // Both renders should produce the same formatted output
    expect(output1).toContain('1m 30s');
    expect(output2).toContain('1m 30s');

    result1.unmount();
    result2.unmount();
  });
});
