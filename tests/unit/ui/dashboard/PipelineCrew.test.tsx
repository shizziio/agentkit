/**
 * PipelineCrew.test.tsx
 *
 * Updated in story 26.3: useCrewState hook deleted; PipelineCrew now reads from
 * useCrewStore. Removed vi.mock for the deleted hook. Added store reset in
 * beforeEach/afterEach. Updated display-name expectations to match
 * deriveDisplayName output (SM, Dev, Rev, Tes instead of SM, DEV, REVIEW, TESTER).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, Box, Text } from 'ink';
import { PassThrough } from 'node:stream';

import { PipelineCrew } from '@ui/dashboard/crew/PipelineCrew.js';
import { EventBus } from '@core/EventBus.js';
import { useCrewStore } from '@ui/stores/index.js';

// Mock RobotChar to check for re-renders and return expected strings for output assertions
vi.mock('@ui/dashboard/crew/RobotChar.js', () => ({
  RobotChar: vi.fn(({ robot, isOrchestrator }) => (
    <Box>
      <Text>{robot.displayName}</Text>
      {isOrchestrator ? <Text>║╚═╦═╝</Text> : <Text>│└─┬─┘</Text>}
    </Box>
  )),
}));

import { RobotChar } from '@ui/dashboard/crew/RobotChar.js';

const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '').replace(/\x1B[()][A-Z]/g, '');

function makeStream(columns = 80): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = columns;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 50): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('PipelineCrew', () => {
  let eventBus: EventBus;
  const stages = ['sm', 'dev', 'review', 'tester'];

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();
    // Reset store so tests don't leak state
    useCrewStore.getState().cleanup();
    useCrewStore.setState({ workers: [], globalBlinkPhase: false });
  });

  afterEach(() => {
    useCrewStore.getState().cleanup();
    useCrewStore.setState({ workers: [], globalBlinkPhase: false });
  });

  it('AC1: should render orchestrator with label "AgentKit"', async () => {
    const { stream, getOutput } = makeStream();
    const { unmount } = render(
      React.createElement(PipelineCrew, { eventBus, stages }),
      { stdout: stream }
    );
    await tick();
    const output = getOutput();

    expect(output).toContain('AgentKit');
    // Orchestrator uses double borders
    expect(output).toContain('║');
    expect(output).toContain('╚═╦═╝');
    unmount();
  });

  it('AC1: should render N worker robots matching the stages list', async () => {
    const { stream, getOutput } = makeStream();
    const { unmount } = render(
      React.createElement(PipelineCrew, { eventBus, stages }),
      { stdout: stream }
    );
    await tick();
    const output = getOutput();

    // deriveDisplayName: 'sm'→'SM', 'dev'→'Dev', 'review'→'Rev', 'tester'→'Tes'
    expect(output).toContain('SM');
    expect(output).toContain('Dev');
    expect(output).toContain('Rev');
    expect(output).toContain('Tes');
    // Worker robots use single borders
    expect(output).toContain('│');
    expect(output).toContain('└─┬─┘');
    unmount();
  });

  it('AC1/AC2: should render connection tree lines between orchestrator and workers', async () => {
    const { stream, getOutput } = makeStream();
    const { unmount } = render(
      React.createElement(PipelineCrew, { eventBus, stages }),
      { stdout: stream }
    );
    await tick();
    const output = getOutput();

    // Check for branching tree lines
    expect(output).toContain('┌');
    expect(output).toContain('┐');
    unmount();
  });

  it('AC4: should use compact connection layout when width < 40', async () => {
    const { stream, getOutput } = makeStream(35);
    const { unmount } = render(
      React.createElement(PipelineCrew, { eventBus, stages, width: 35 }),
      { stdout: stream }
    );
    await tick();
    const output = getOutput();

    // Compact layout uses tighter lines
    // Standard: ┌────────┼────────┐
    // Compact:  ┌─┴─┐
    const lines = output.split('\n');
    const branchLine = lines.find(l => l.includes('┌') && l.includes('┐'));
    expect(branchLine).toBeDefined();
    if (branchLine) {
        // Count dashes or spaces to verify compactness
        const dashCount = (branchLine.match(/─/g) || []).length;
        expect(dashCount).toBeLessThan(15);
    }
    unmount();
  });

  it('AC5: should propagate dimmed prop to robots', async () => {
    const { stream } = makeStream();
    const { unmount } = render(
      React.createElement(PipelineCrew, { eventBus, stages, dimmed: true }),
      { stdout: stream }
    );
    await tick();

    // Verify RobotChar was called with dimmed: true
    expect(vi.mocked(RobotChar)).toHaveBeenCalledWith(
      expect.objectContaining({ dimmed: true }),
      expect.anything()
    );
    unmount();
  });

  it('AC6: should not re-render RobotChar if its specific state is unchanged', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(PipelineCrew, { eventBus, stages }),
      { stdout: stream }
    );
    await tick();

    const initialCallCount = vi.mocked(RobotChar).mock.calls.length;

    // Re-render parent with same props/state from store
    result.rerender(React.createElement(PipelineCrew, { eventBus, stages }));
    await tick();

    // Should still be initialCallCount (one for each robot rendered)
    expect(vi.mocked(RobotChar).mock.calls.length).toBe(initialCallCount);
    result.unmount();
  });
  describe('Edge Cases', () => {
    it('should handle zero workers gracefully (only orchestrator)', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(
        React.createElement(PipelineCrew, { eventBus, stages: [] }),
        { stdout: stream }
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('AgentKit');
      expect(output).not.toContain('┌'); // No branch line
      unmount();
    });

    it('should render a simple vertical line for a single worker', async () => {
      const singleStage = ['dev'];
      const { stream, getOutput } = makeStream();
      const { unmount } = render(
        React.createElement(PipelineCrew, { eventBus, stages: singleStage }),
        { stdout: stream }
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('AgentKit');
      // deriveDisplayName('dev') = 'Dev'
      expect(output).toContain('Dev');
      // Should have a vertical connector but no branching
      expect(output).toContain('│');
      expect(output).not.toContain('┌');
      unmount();
    });

    it('should handle extreme narrow width (< 20 columns) gracefully', async () => {
      const { stream, getOutput } = makeStream(15);
      const { unmount } = render(
        React.createElement(PipelineCrew, { eventBus, stages, width: 15 }),
        { stdout: stream }
      );
      await tick();
      const output = getOutput();

      // Should still render orchestrator
      expect(output).toContain('AgentKit');
      // No crash, and some form of robots still present
      expect(output).toContain('║');
      unmount();
    });
  });
});
