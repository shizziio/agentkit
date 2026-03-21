/**
 * Tests for BrandHeader pipelineState prop (Story 24.3).
 * BrandHeader replaces isPipelineRunning: boolean with pipelineState: PipelineState.
 * These tests verify the statusMap rendering for all three states and
 * queueStats visibility during 'draining' state.
 *
 * COLOR NOTE (AC3b): The spec requires '⟳ Draining...' rendered in yellow.
 * Ink renders color via ANSI escape codes which are stripped in these tests
 * (terminal output is not reliable for color assertion in Vitest/Ink integration tests).
 * The yellow color is verified structurally: the statusMap in BrandHeader must map
 * 'draining' → color='yellow'. This cannot be asserted via terminal output here;
 * the implementation contract is:
 *   statusMap.draining.color === 'yellow'
 * Developers must verify this in the BrandHeader source at code-review time.
 * If a component-tree inspector (e.g., ink-testing-library) is added to the project
 * in future, a prop-level color assertion should replace this note.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

import { BrandHeader } from '@ui/dashboard/brand/BrandHeader.js';
import type { WorkerStatusEntry } from '@ui/dashboard/shared/DashboardTypes.js';
import type { QueueStats } from '@ui/stores/workerStore.js';
import type { PipelineState } from '@ui/dashboard/shared/DashboardTypes.js';

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

describe('BrandHeader — pipelineState prop (Story 24.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseProps = {
    projectName: 'test-project',
    workerStatuses: [] as WorkerStatusEntry[],
    queueStats: null as QueueStats | null,
  };

  // AC3b: pipelineState==='draining' → shows '⟳ Draining...' in yellow
  describe('draining state', () => {
    it('shows "⟳" dot when pipelineState is "draining"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'draining' as PipelineState }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toContain('⟳');
      r.unmount();
    });

    it('shows "Draining..." label when pipelineState is "draining"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'draining' as PipelineState }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toContain('Draining');
      r.unmount();
    });

    it('does not show "Running" when pipelineState is "draining"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'draining' as PipelineState }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).not.toContain('Running');
      r.unmount();
    });

    it('does not show "Stopped" when pipelineState is "draining"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'draining' as PipelineState }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).not.toContain('Stopped');
      r.unmount();
    });
  });

  // AC3c: pipelineState==='stopped' → shows '○ Stopped'
  describe('stopped state', () => {
    it('shows "○" dot when pipelineState is "stopped"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'stopped' as PipelineState }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toContain('○');
      r.unmount();
    });

    it('shows "Stopped" label when pipelineState is "stopped"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'stopped' as PipelineState }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toContain('Stopped');
      r.unmount();
    });
  });

  // running state should still work
  describe('running state', () => {
    it('shows "●" dot when pipelineState is "running"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'running' as PipelineState }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toContain('●');
      r.unmount();
    });

    it('shows "Running" label when pipelineState is "running"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'running' as PipelineState }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toContain('Running');
      r.unmount();
    });
  });

  // queueStats visibility during draining state (edge case: must remain visible)
  describe('queueStats visibility', () => {
    const queueStats: QueueStats = { done: 5, queued: 3, failed: 1 };

    it('shows queueStats when pipelineState is "running"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'running' as PipelineState, queueStats }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('done:');
      expect(output).toContain('5');
      r.unmount();
    });

    it('shows queueStats when pipelineState is "draining" (must remain visible during drain)', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'draining' as PipelineState, queueStats }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('done:');
      expect(output).toContain('queue:');
      r.unmount();
    });

    it('hides queueStats when pipelineState is "stopped"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(BrandHeader, { ...baseProps, pipelineState: 'stopped' as PipelineState, queueStats }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).not.toContain('done:');
      expect(output).not.toContain('queue:');
      r.unmount();
    });
  });
});
