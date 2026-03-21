import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

import { RobotChar } from '@ui/dashboard/crew/RobotChar.js';
import type { RobotEntry, RobotState, CrewState } from '@ui/dashboard/crew/CrewTypes.js';

const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 80;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 10): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('RobotChar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC1: should verify CrewTypes are exportable', () => {
    // This test ensures that the types are at least importable and follow the specified names
    // CrewState and RobotState are imported above.
    const mockRobot: RobotEntry = {
      name: 'sm',
      displayName: 'SM',
      state: 'idle',
      blinkPhase: false
    };
    const mockCrew: CrewState = {
      orchestrator: mockRobot,
      workers: [mockRobot],
      healthStatus: 'healthy'
    };
    expect(mockCrew.healthStatus).toBe('healthy');
  });

  it('AC2: should render worker robot with single-line borders and 5 lines', async () => {
    const robot: RobotEntry = {
      name: 'worker',
      displayName: 'WORKR',
      state: 'idle',
      blinkPhase: false
    };
    const { stream, getOutput } = makeStream();
    const { unmount } = render(
      React.createElement(RobotChar, { robot }),
      { stdout: stream }
    );
    await tick();
    const output = getOutput();
    
    // Check for 5 lines (frame top, head, body, frame bottom, name)
    const lines = output.trim().split('\n');
    expect(lines.length).toBe(5);
    
    // Exact verification of each line for Worker (single-line border)
    expect(lines[0]).toContain('┌───┐'); // top
    expect(lines[1]).toContain('│ ○ │'); // head (idle)
    expect(lines[2]).toContain('│/█\\│'); // body
    expect(lines[3]).toContain('└─┬─┘'); // bottom
    expect(lines[4]).toContain('WORKR'); // label
    unmount();
  });

  it('AC3: should render orchestrator robot with double-line borders', async () => {
    const robot: RobotEntry = {
      name: 'sm',
      displayName: 'SM',
      state: 'idle',
      blinkPhase: false
    };
    const { stream, getOutput } = makeStream();
    const { unmount } = render(
      React.createElement(RobotChar, { robot, isOrchestrator: true }),
      { stdout: stream }
    );
    await tick();
    const output = getOutput();
    
    const lines = output.trim().split('\n');
    expect(lines.length).toBe(5);

    // Exact verification of each line for Orchestrator (double-line border)
    expect(lines[0]).toContain('╔═══╗'); // top
    expect(lines[1]).toContain('║ ○ ║'); // head (idle)
    expect(lines[2]).toContain('║/█\\║'); // body
    expect(lines[3]).toContain('╚═╦═╝'); // bottom
    expect(lines[4]).toContain('SM'); // label
    unmount();
  });

  it('AC4: should render correct head icons for each state', async () => {
    const testCases: { state: RobotState; icon: string }[] = [
      { state: 'idle', icon: '○' },
      { state: 'queued', icon: '◎' },
      { state: 'running', icon: '◉' },
      { state: 'done', icon: '✓' },
      { state: 'error', icon: '✗' },
    ];

    for (const { state, icon } of testCases) {
      const robot: RobotEntry = { name: 'test', displayName: 'TEST', state, blinkPhase: false };
      const { stream, getOutput } = makeStream();
      const { unmount } = render(
        React.createElement(RobotChar, { robot }),
        { stdout: stream }
      );
      await tick();
      expect(getOutput()).toContain(icon);
      unmount();
    }
  });

  it('AC5: should respect blinkPhase for running state', async () => {
    const robotBright: RobotEntry = { name: 'test', displayName: 'TEST', state: 'running', blinkPhase: false };
    const robotDim: RobotEntry = { name: 'test', displayName: 'TEST', state: 'running', blinkPhase: true };

    const { stream: s1, getOutput: g1 } = makeStream();
    const { unmount: u1 } = render(
      React.createElement(RobotChar, { robot: robotBright }),
      { stdout: s1 }
    );
    await tick();
    expect(g1()).toContain('◉');
    u1();

    const { stream: s2, getOutput: g2 } = makeStream();
    const { unmount: u2 } = render(
      React.createElement(RobotChar, { robot: robotDim }),
      { stdout: s2 }
    );
    await tick();
    expect(g2()).toContain('◎');
    u2();
  });

  it('AC6: should support dimmed prop', async () => {
    const robot: RobotEntry = { name: 'test', displayName: 'TEST', state: 'done', blinkPhase: false };
    const { stream, getOutput } = makeStream();
    const { unmount } = render(
      React.createElement(RobotChar, { robot, dimmed: true }),
      { stdout: stream }
    );
    await tick();
    // Component should still render correctly when dimmed
    expect(getOutput()).toContain('✓');
    unmount();
  });

  it('Edge Case: should truncate display names longer than 5 characters', async () => {
    const robot: RobotEntry = { name: 'test', displayName: 'VERYLONGNAME', state: 'idle', blinkPhase: false };
    const { stream, getOutput } = makeStream();
    const { unmount } = render(
      React.createElement(RobotChar, { robot }),
      { stdout: stream }
    );
    await tick();
    const output = getOutput();
    const lines = output.trim().split('\n');
    const labelLine = lines[4];
    
    // The total width should not exceed 5 columns for the label
    // The frame is ┌───┐ which is 5 characters wide.
    // The label should be aligned with it and not exceed 5 chars.
    expect(labelLine.trim().length).toBeLessThanOrEqual(5);
    unmount();
  });

  it('Edge Case: should fallback to idle for unknown RobotState', async () => {
    const robot = { name: 'test', displayName: 'TEST', state: 'unknown', blinkPhase: false } as unknown as RobotEntry;
    const { stream, getOutput } = makeStream();
    const { unmount } = render(
      React.createElement(RobotChar, { robot }),
      { stdout: stream }
    );
    await tick();
    // Fallback icon for idle is '○'
    expect(getOutput()).toContain('○');
    unmount();
  });
});
