import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { CompactLayout } from '@ui/dashboard/layouts/CompactLayout.js';
import { useDashboardStore } from '@ui/stores/index.js';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
    useStdout: vi.fn(() => ({
      stdout: { rows: 24, columns: 60 },
    })),
  };
});

vi.mock('@ui/dashboard/active-stories/ActiveStoriesPanel.js', async () => {
  const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
  return {
    ActiveStoriesPanel: vi.fn(({ isFocused }: { isFocused: boolean }) =>
      React.createElement(InkText, null, `panel:stories:focused=${String(isFocused)}`),
    ),
  };
});

vi.mock('@ui/dashboard/live-activity/LiveActivityPanel.js', async () => {
  const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
  return {
    LiveActivityPanel: vi.fn(({ isFocused }: { isFocused: boolean }) =>
      React.createElement(InkText, null, `panel:activity:focused=${String(isFocused)}`),
    ),
  };
});

vi.mock('@ui/dashboard/live-activity/LiveActivityFullscreen.js', async () => {
  const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
  return {
    LiveActivityFullscreen: () => React.createElement(InkText, null, 'panel:fullscreen'),
  };
});

import { ActiveStoriesPanel } from '@ui/dashboard/active-stories/ActiveStoriesPanel.js';
import { LiveActivityPanel } from '@ui/dashboard/live-activity/LiveActivityPanel.js';

const INITIAL_STORE_STATE = {
  dashboardMode: 'overview' as const,
  actionMode: 'none' as const,
  isFullscreen: false,
  focusedPanel: 0,
  panelCount: 2,
};

const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 60;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

// After story 25.4: CompactLayout no longer accepts focusedPanel as a prop.
// It reads focusedPanel from useDashboardStore(s => s.focusedPanel) directly.
// Tests seed focusedPanel via useDashboardStore.setState.
function makeProps(overrides: Partial<Parameters<typeof CompactLayout>[0]> = {}): Parameters<typeof CompactLayout>[0] {
  return {
    focusModePanel: null,
    dimmed: false,
    ...overrides,
  };
}

describe('CompactLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDashboardStore.setState(INITIAL_STORE_STATE);
  });

  afterEach(() => {
    useDashboardStore.setState(INITIAL_STORE_STATE);
  });

  describe('focusModePanel=null (both panels visible)', () => {
    it('renders both panels when focusModePanel is null', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(CompactLayout, makeProps()), { stdout: stream });
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:stories');
      expect(frame).toContain('panel:activity');
      result.unmount();
    });

    it('renders LiveActivityPanel (not LiveActivityFullscreen) when focusModePanel is null', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(CompactLayout, makeProps()), { stdout: stream });
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:activity');
      expect(frame).not.toContain('panel:fullscreen');
      result.unmount();
    });
  });

  describe('focusModePanel=0 (only top panel visible)', () => {
    it('shows only ActiveStoriesPanel; LiveActivity is hidden', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(CompactLayout, makeProps({ focusModePanel: 0 })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:stories');
      expect(frame).not.toContain('panel:activity');
      expect(frame).not.toContain('panel:fullscreen');
      result.unmount();
    });

    it('shows custom tlPanelNode instead of ActiveStoriesPanel when provided', async () => {
      const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
      const customNode = React.createElement(InkText, null, 'custom-top-panel');
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(CompactLayout, makeProps({ focusModePanel: 0, tlPanelNode: customNode })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).toContain('custom-top-panel');
      expect(frame).not.toContain('panel:stories');
      result.unmount();
    });
  });

  describe('focusModePanel=1 (only bottom panel visible, LiveActivityFullscreen rendered)', () => {
    it('shows LiveActivityFullscreen when focusModePanel=1', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(CompactLayout, makeProps({ focusModePanel: 1 })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).not.toContain('panel:stories');
      expect(frame).not.toContain('panel:activity');
      expect(frame).toContain('panel:fullscreen');
      result.unmount();
    });
  });

  describe('dimmed prop', () => {
    it('renders without crashing with dimmed=true', async () => {
      const { stream } = makeStream();
      const result = render(
        React.createElement(CompactLayout, makeProps({ dimmed: true })),
        { stdout: stream },
      );
      await tick();
      result.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Story 25.4: focusedPanel comes from the store, not from props.
  // CompactLayoutProps should NOT include focusedPanel; it reads from store.
  // These tests FAIL before implementation (CompactLayout reads from props,
  // which is undefined when not passed → isFocused always false).
  // PASS after implementation (CompactLayout reads from useDashboardStore).
  // -------------------------------------------------------------------------

  describe('isFocused driven by store (story 25.4)', () => {
    it('passes isFocused=true to ActiveStoriesPanel when store focusedPanel=0', async () => {
      useDashboardStore.setState({ focusedPanel: 0, panelCount: 2 });
      const { stream } = makeStream();
      const result = render(React.createElement(CompactLayout, makeProps()), { stdout: stream });
      await tick();
      expect(vi.mocked(ActiveStoriesPanel)).toHaveBeenCalledWith(
        expect.objectContaining({ isFocused: true }),
        expect.anything(),
      );
      result.unmount();
    });

    it('passes isFocused=false to ActiveStoriesPanel when store focusedPanel=1', async () => {
      useDashboardStore.setState({ focusedPanel: 1, panelCount: 2 });
      const { stream } = makeStream();
      const result = render(React.createElement(CompactLayout, makeProps()), { stdout: stream });
      await tick();
      expect(vi.mocked(ActiveStoriesPanel)).toHaveBeenCalledWith(
        expect.objectContaining({ isFocused: false }),
        expect.anything(),
      );
      result.unmount();
    });

    it('passes isFocused=true to LiveActivityPanel when store focusedPanel=1', async () => {
      useDashboardStore.setState({ focusedPanel: 1, panelCount: 2 });
      const { stream } = makeStream();
      const result = render(React.createElement(CompactLayout, makeProps()), { stdout: stream });
      await tick();
      expect(vi.mocked(LiveActivityPanel)).toHaveBeenCalledWith(
        expect.objectContaining({ isFocused: true }),
        expect.anything(),
      );
      result.unmount();
    });

    it('passes isFocused=false to LiveActivityPanel when store focusedPanel=0', async () => {
      useDashboardStore.setState({ focusedPanel: 0, panelCount: 2 });
      const { stream } = makeStream();
      const result = render(React.createElement(CompactLayout, makeProps()), { stdout: stream });
      await tick();
      expect(vi.mocked(LiveActivityPanel)).toHaveBeenCalledWith(
        expect.objectContaining({ isFocused: false }),
        expect.anything(),
      );
      result.unmount();
    });

    it('CompactLayoutProps should NOT include a focusedPanel field (verified by omitting from makeProps)', async () => {
      // makeProps() does NOT include focusedPanel. If CompactLayout still requires it,
      // TypeScript will error at compile time. After migration, focusedPanel comes
      // from the store so no prop is needed.
      const props = makeProps();
      expect((props as Record<string, unknown>).focusedPanel).toBeUndefined();
    });
  });
});
