import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { EventBus } from '@core/EventBus';

// Mock useDiagnosePolling so we control state and can track calls
vi.mock('@ui/dashboard/hooks/useDiagnosePolling.js', () => ({
  useDiagnosePolling: vi.fn(),
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

import { useDiagnosePolling } from '@ui/dashboard/hooks/useDiagnosePolling';
import { DiagnosePanel } from '@ui/dashboard/diagnose/DiagnosePanel';

function makeStream(): { stream: NodeJS.WriteStream & { columns: number } } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 120;
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number } };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function defaultPollingState() {
  return {
    lastResult: null,
    lastPollAt: null,
    nextPollIn: 30,
    isPolling: false,
    pollError: null,
  };
}

describe('DiagnosePanel — React.memo isolation', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();
    vi.mocked(useDiagnosePolling).mockReturnValue(defaultPollingState());
  });

  it('does NOT re-render when parent re-renders with same isFocused, dimmed, width, height', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false, dimmed: false, width: 40, height: 12 }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useDiagnosePolling).mock.calls.length;

    // Re-render with SAME memo-relevant props — React.memo should skip
    result.rerender(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false, dimmed: false, width: 40, height: 12 }),
    );
    await tick();

    // useDiagnosePolling should NOT have been called again (memo skipped re-render)
    expect(vi.mocked(useDiagnosePolling).mock.calls.length).toBe(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when isFocused changes', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false, dimmed: false, width: 40, height: 12 }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useDiagnosePolling).mock.calls.length;

    // Change isFocused — comparator detects difference, triggers re-render
    result.rerender(
      React.createElement(DiagnosePanel, { eventBus, isFocused: true, dimmed: false, width: 40, height: 12 }),
    );
    await tick();

    expect(vi.mocked(useDiagnosePolling).mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when dimmed changes', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false, dimmed: false, width: 40, height: 12 }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useDiagnosePolling).mock.calls.length;

    result.rerender(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false, dimmed: true, width: 40, height: 12 }),
    );
    await tick();

    expect(vi.mocked(useDiagnosePolling).mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when width changes (terminal resize)', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false, dimmed: false, width: 40, height: 12 }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useDiagnosePolling).mock.calls.length;

    result.rerender(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false, dimmed: false, width: 60, height: 12 }),
    );
    await tick();

    expect(vi.mocked(useDiagnosePolling).mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('DOES re-render when height changes (terminal resize)', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false, dimmed: false, width: 40, height: 12 }),
      { stdout: stream },
    );
    await tick();

    const callCountAfterMount = vi.mocked(useDiagnosePolling).mock.calls.length;

    result.rerender(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false, dimmed: false, width: 40, height: 20 }),
    );
    await tick();

    expect(vi.mocked(useDiagnosePolling).mock.calls.length).toBeGreaterThan(callCountAfterMount);
    result.unmount();
  });

  it('renders correctly without width/height props (optional)', async () => {
    const { stream } = makeStream();
    const result = render(
      React.createElement(DiagnosePanel, { eventBus, isFocused: false }),
      { stdout: stream },
    );
    await tick();
    expect(result).toBeDefined();
    result.unmount();
  });
});
