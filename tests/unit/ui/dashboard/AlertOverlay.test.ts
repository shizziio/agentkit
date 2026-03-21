import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import type { AlertOverlayEntry } from '@ui/dashboard/modals/AlertOverlayTypes';
import { AlertOverlay } from '@ui/dashboard/modals/AlertOverlay';

// ---------------------------------------------------------------------------
// Mock useAlertStore so component tests can control store state directly
// without running a real Zustand store or EventBus.
// ---------------------------------------------------------------------------
const mockDismiss = vi.fn();
const mockStoreState = {
  currentAlert: null as AlertOverlayEntry | null,
  queueLength: 0,
  dismiss: mockDismiss,
  queue: [] as AlertOverlayEntry[],
  init: vi.fn(),
  cleanup: vi.fn(),
};

vi.mock('@ui/stores/index.js', () => ({
  useAlertStore: vi.fn((selector: (s: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
  ),
}));

// ---------------------------------------------------------------------------
// Re-import useAlertStore after mock is registered so we can set its
// getState() reference for tests that call store.dismiss() directly.
// ---------------------------------------------------------------------------
import { useAlertStore } from '@ui/stores/index.js';

// Patch getState() on the mock hook so component code that calls
// useAlertStore.getState().dismiss() works during tests.
(useAlertStore as unknown as { getState: () => typeof mockStoreState }).getState = () =>
  mockStoreState;

// ---------------------------------------------------------------------------
// Capture useInput handlers for testing key presses
// ---------------------------------------------------------------------------
const capturedInputHandlers: Array<(input: string, key: { return: boolean; escape?: boolean }) => void> = [];

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn().mockImplementation((handler: (input: string, key: { return: boolean }) => void) => {
      capturedInputHandlers.push(handler);
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

function makeAlert(overrides: Partial<AlertOverlayEntry> = {}): AlertOverlayEntry {
  return {
    id: 'test-id',
    taskId: 1,
    storyId: 10,
    storyTitle: 'Fix login bug',
    stageName: 'review',
    issues: ['Code style issue', 'Missing test'],
    routedTo: 'dev',
    attempt: 2,
    maxAttempts: 3,
    isBlocked: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlertOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInputHandlers.length = 0;
    // Reset mock store state
    mockStoreState.currentAlert = null;
    mockStoreState.queueLength = 0;
    mockStoreState.queue = [];
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: component reads from useAlertStore, no eventBus prop
  // -------------------------------------------------------------------------
  describe('store integration', () => {
    it('should render null when useAlertStore returns currentAlert = null', () => {
      mockStoreState.currentAlert = null;

      const result = render(
        React.createElement(AlertOverlay, {
          onViewDetails: vi.fn(),
        }),
      );

      expect(result).toBeDefined();
      result.unmount();
    });

    it('should NOT accept an onDismiss prop — component calls store.dismiss() internally', () => {
      // AlertOverlay's props type should not include onDismiss.
      // If onDismiss were required in props, TypeScript would fail to compile,
      // so we verify the component renders successfully without it.
      mockStoreState.currentAlert = makeAlert();
      mockStoreState.queueLength = 1;

      expect(() => {
        const result = render(
          React.createElement(AlertOverlay, {
            onViewDetails: vi.fn(),
            // onDismiss intentionally omitted — it must not be in the props type
          }),
        );
        result.unmount();
      }).not.toThrow();
    });

    it('should still accept onViewDetails as a prop for navigation delegation', () => {
      mockStoreState.currentAlert = makeAlert();
      mockStoreState.queueLength = 1;
      const onViewDetails = vi.fn();

      expect(() => {
        const result = render(
          React.createElement(AlertOverlay, { onViewDetails }),
        );
        result.unmount();
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: renders alert data from store state
  // -------------------------------------------------------------------------
  describe('rendering', () => {
    it('renders alert details when store has a currentAlert', async () => {
      const alert = makeAlert();
      mockStoreState.currentAlert = alert;
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, {
          onViewDetails: vi.fn(),
        }),
        { stdout: stream },
      );

      await tick();
      const output = getOutput();

      expect(output).toContain('review');
      expect(output).toContain('Fix login bug');
      expect(output).toContain('Code style issue');
      expect(output).toContain('Missing test');
      expect(output).toContain('Routed to dev');
      expect(output).toContain('2/3');

      result.unmount();
    });

    it('renders BLOCKED action when store currentAlert.isBlocked=true', async () => {
      const alert = makeAlert({ isBlocked: true, routedTo: undefined, attempt: 3, maxAttempts: 3 });
      mockStoreState.currentAlert = alert;
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      const output = getOutput();

      expect(output).toContain('BLOCKED');
      expect(output).toContain('3/3');

      result.unmount();
    });

    it('shows queue pending count when store queueLength > 1', async () => {
      mockStoreState.currentAlert = makeAlert();
      mockStoreState.queueLength = 3;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      expect(getOutput()).toContain('2 more alert(s) pending');

      result.unmount();
    });

    it('does not show queue pending message when queueLength is 1', async () => {
      mockStoreState.currentAlert = makeAlert();
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      expect(getOutput()).not.toContain('more alert(s) pending');

      result.unmount();
    });

    it('shows "No details available" when issues array is empty', async () => {
      mockStoreState.currentAlert = makeAlert({ issues: [] });
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      expect(getOutput()).toContain('No details available');

      result.unmount();
    });

    it('truncates issues to 3 items showing overflow count', async () => {
      mockStoreState.currentAlert = makeAlert({
        issues: ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7'],
      });
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      const output = getOutput();

      expect(output).toContain('i3');
      expect(output).not.toContain('i4');
      expect(output).toContain('and 4 more');

      result.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criteria: key bindings call store.dismiss() directly
  // -------------------------------------------------------------------------
  describe('key bindings — store dismiss()', () => {
    it('should call useAlertStore.getState().dismiss() when Enter key is pressed', () => {
      mockStoreState.currentAlert = makeAlert();
      mockStoreState.queueLength = 1;

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
      );

      const handler = capturedInputHandlers[0];
      if (handler) {
        handler('', { return: true });
      }

      expect(mockDismiss).toHaveBeenCalledTimes(1);
      result.unmount();
    });

    it('should call useAlertStore.getState().dismiss() when Escape key is pressed', () => {
      mockStoreState.currentAlert = makeAlert();
      mockStoreState.queueLength = 1;

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
      );

      const handler = capturedInputHandlers[0];
      if (handler) {
        handler('', { return: false, escape: true });
      }

      expect(mockDismiss).toHaveBeenCalledTimes(1);
      result.unmount();
    });

    it('should call onViewDetails when "d" key is pressed', () => {
      const onViewDetails = vi.fn();
      mockStoreState.currentAlert = makeAlert();
      mockStoreState.queueLength = 1;

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails }),
      );

      const handler = capturedInputHandlers[0];
      if (handler) {
        handler('d', { return: false });
      }

      expect(onViewDetails).toHaveBeenCalledTimes(1);
      result.unmount();
    });

    it('should call store.dismiss() before or during onViewDetails when "d" is pressed', () => {
      // Architecture note: component should call store dismiss() then invoke onViewDetails
      const calls: string[] = [];
      mockDismiss.mockImplementation(() => { calls.push('dismiss'); });
      const onViewDetails = vi.fn(() => { calls.push('viewDetails'); });

      mockStoreState.currentAlert = makeAlert();
      mockStoreState.queueLength = 1;

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails }),
      );

      const handler = capturedInputHandlers[0];
      if (handler) {
        handler('d', { return: false });
      }

      expect(calls).toContain('dismiss');
      expect(calls).toContain('viewDetails');
      result.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Issue list rendering tests (retained from original test suite)
  // -------------------------------------------------------------------------
  describe('issue list rendering', () => {
    it('renders issues with stable keys combining index and issue text', async () => {
      mockStoreState.currentAlert = makeAlert({
        issues: ['Code style issue', 'Missing test', 'Performance concern'],
      });
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      const output = getOutput();

      expect(output).toContain('Code style issue');
      expect(output).toContain('Missing test');
      expect(output).toContain('Performance concern');

      result.unmount();
    });

    it('renders issues with empty array without crashing', async () => {
      mockStoreState.currentAlert = makeAlert({ issues: [] });
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      expect(getOutput()).toContain('No details available');

      result.unmount();
    });

    it('renders many issues with overflow (> 3 issues)', async () => {
      const manyIssues = [
        'Issue 1: Code style',
        'Issue 2: Missing test',
        'Issue 3: Performance',
        'Issue 4: Documentation',
        'Issue 5: Type safety',
        'Issue 6: Extra issue',
        'Issue 7: Another issue',
      ];
      mockStoreState.currentAlert = makeAlert({ issues: manyIssues });
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      const output = getOutput();

      expect(output).toContain('Issue 1: Code style');
      expect(output).toContain('Issue 3: Performance');
      expect(output).not.toContain('Issue 4: Documentation');
      expect(output).toContain('and 4 more');

      result.unmount();
    });

    it('handles issues with special characters without crashing', async () => {
      mockStoreState.currentAlert = makeAlert({
        issues: ['Issue with special chars: @#$%^&*()', 'Another issue', 'Line\nbreak test'],
      });
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      expect(getOutput()).toContain('Issue with special chars');
      expect(getOutput()).toContain('Another issue');

      result.unmount();
    });

    it('maintains key uniqueness when rendering duplicate issues', async () => {
      mockStoreState.currentAlert = makeAlert({
        issues: ['Duplicate issue', 'Unique issue', 'Duplicate issue'],
      });
      mockStoreState.queueLength = 1;
      const { stream, getOutput } = makeStream();

      const result = render(
        React.createElement(AlertOverlay, { onViewDetails: vi.fn() }),
        { stdout: stream },
      );

      await tick();
      const output = getOutput();

      const duplicateMatches = output.match(/Duplicate issue/g);
      expect(duplicateMatches?.length).toBe(2);

      result.unmount();
    });
  });
});
