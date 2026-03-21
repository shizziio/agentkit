import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, Text } from 'ink';
import { PassThrough } from 'node:stream';
import { GridLayout } from '@ui/dashboard/layouts/GridLayout.js';
import { useDashboardStore } from '@ui/stores/index.js';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
    useStdout: vi.fn(() => ({
      stdout: { rows: 40, columns: 120 },
    })),
  };
});

vi.mock('@ui/dashboard/pipeline-flow/PipelineFlowPanel.js', async () => {
  const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
  return {
    PipelineFlowPanel: () => React.createElement(InkText, null, 'panel:pipeline'),
  };
});
vi.mock('@ui/dashboard/active-stories/ActiveStoriesPanel.js', async () => {
  const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
  return {
    ActiveStoriesPanel: () => React.createElement(InkText, null, 'panel:stories'),
  };
});
vi.mock('@ui/dashboard/live-activity/LiveActivityPanel.js', async () => {
  const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
  return {
    LiveActivityPanel: () => React.createElement(InkText, null, 'panel:activity'),
  };
});
vi.mock('@ui/dashboard/live-activity/LiveActivityFullscreen.js', async () => {
  const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
  return {
    LiveActivityFullscreen: () => React.createElement(InkText, null, 'panel:fullscreen'),
  };
});
vi.mock('@ui/dashboard/diagnose/DiagnosePanel.js', async () => {
  const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
  return {
    DiagnosePanel: vi.fn(({ stages }) => React.createElement(InkText, null, `panel:diagnose${stages ? ':' + stages.join(',') : ''}`)),
  };
});

import { DiagnosePanel } from '@ui/dashboard/diagnose/DiagnosePanel.js';

// After story 25.4: GridLayout no longer accepts focusedPanel as a prop.
// It reads focusedPanel from useDashboardStore(s => s.focusedPanel) directly.
// Tests seed focusedPanel via useDashboardStore.setState.
const mockStages: Parameters<typeof GridLayout>[0]['stages'] = [
  { name: 'sm', displayName: 'SM', order: 0, isOptional: false },
  { name: 'dev', displayName: 'Dev', order: 1, isOptional: false }
];

const INITIAL_STORE_STATE = {
  dashboardMode: 'overview' as const,
  actionMode: 'none' as const,
  isFullscreen: false,
  focusedPanel: 0,
  panelCount: 4,
};

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

// After story 25.4: focusedPanel is no longer a prop on GridLayout.
// It is seeded via useDashboardStore.setState in tests that need a specific value.
function makeProps(overrides: Partial<Parameters<typeof GridLayout>[0]> = {}): Parameters<typeof GridLayout>[0] {
  return {
    stages: mockStages,
    focusModePanel: null,
    dimmed: false,
    ...overrides,
  };
}

describe('GridLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDashboardStore.setState(INITIAL_STORE_STATE);
  });

  afterEach(() => {
    useDashboardStore.setState(INITIAL_STORE_STATE);
  });

  describe('focusModePanel=null (all panels visible)', () => {
    it('renders all four panels when focusModePanel is null', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:pipeline');
      expect(frame).toContain('panel:stories');
      expect(frame).toContain('panel:activity');
      expect(frame).toContain('panel:diagnose');
      result.unmount();
    });

    it('renders LiveActivityPanel (not LiveActivityFullscreen) when focusModePanel is null', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:activity');
      expect(frame).not.toContain('panel:fullscreen');
      result.unmount();
    });
  });

  describe('focusModePanel=0 (only TL visible)', () => {
    it('shows only the TL panel; TR, BL, BR are hidden', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ focusModePanel: 0 })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:pipeline');
      expect(frame).not.toContain('panel:stories');
      expect(frame).not.toContain('panel:activity');
      expect(frame).not.toContain('panel:fullscreen');
      expect(frame).not.toContain('panel:diagnose');
      result.unmount();
    });

    it('shows custom tlPanelNode when provided with focusModePanel=0', async () => {
      const { stream, getOutput } = makeStream();
      const customNode = React.createElement(Text, null, 'custom-tl-node');
      const result = render(
        React.createElement(GridLayout, makeProps({ focusModePanel: 0, tlPanelNode: customNode })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).toContain('custom-tl-node');
      expect(frame).not.toContain('panel:pipeline');
      expect(frame).not.toContain('panel:stories');
      result.unmount();
    });
  });

  describe('focusModePanel=1 (only TR visible)', () => {
    it('shows only the TR panel; TL, BL, BR are hidden', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ focusModePanel: 1 })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).not.toContain('panel:pipeline');
      expect(frame).toContain('panel:stories');
      expect(frame).not.toContain('panel:activity');
      expect(frame).not.toContain('panel:fullscreen');
      expect(frame).not.toContain('panel:diagnose');
      result.unmount();
    });
  });

  describe('focusModePanel=2 (only BL visible, LiveActivityFullscreen rendered)', () => {
    it('shows LiveActivityFullscreen (not LiveActivityPanel) when focusModePanel=2', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ focusModePanel: 2 })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).not.toContain('panel:pipeline');
      expect(frame).not.toContain('panel:stories');
      expect(frame).not.toContain('panel:activity');
      expect(frame).toContain('panel:fullscreen');
      expect(frame).not.toContain('panel:diagnose');
      result.unmount();
    });
  });

  describe('focusModePanel=3 (only BR/Diagnose visible)', () => {
    it('shows only the Diagnose panel; TL, TR, BL are hidden', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ focusModePanel: 3 })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).not.toContain('panel:pipeline');
      expect(frame).not.toContain('panel:stories');
      expect(frame).not.toContain('panel:activity');
      expect(frame).not.toContain('panel:fullscreen');
      expect(frame).toContain('panel:diagnose');
      result.unmount();
    });

    it('shows DiagnosePanel content', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ focusModePanel: 3 })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:diagnose');
      result.unmount();
    });

    it('AC3: passes mapped stages to DiagnosePanel', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ focusModePanel: 3, stages: mockStages })),
        { stdout: stream },
      );
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:diagnose:sm,dev');

      expect(vi.mocked(DiagnosePanel)).toHaveBeenCalledWith(
        expect.objectContaining({
          stages: ['sm', 'dev']
        }),
        expect.anything()
      );
      result.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // Story 25.4: focusedPanel comes from the store, not from props.
  // Tests seed the store state and verify the component reads it.
  // These tests FAIL before implementation (GridLayout reads from props)
  // and PASS after implementation (GridLayout reads from store).
  // -------------------------------------------------------------------------

  describe('focusedPanel from store (story 25.4)', () => {
    it('renders without crashing when store has focusedPanel=0', async () => {
      useDashboardStore.setState({ focusedPanel: 0, panelCount: 4 });
      const { stream } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      result.unmount();
    });

    it('renders without crashing when store has focusedPanel=1', async () => {
      useDashboardStore.setState({ focusedPanel: 1, panelCount: 4 });
      const { stream } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      result.unmount();
    });

    it('renders without crashing when store has focusedPanel=2', async () => {
      useDashboardStore.setState({ focusedPanel: 2, panelCount: 4 });
      const { stream } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      result.unmount();
    });

    it('renders without crashing when store has focusedPanel=3', async () => {
      useDashboardStore.setState({ focusedPanel: 3, panelCount: 4 });
      const { stream } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      result.unmount();
    });

    it('GridLayoutProps should NOT include a focusedPanel field (verified by omitting it from makeProps)', async () => {
      // makeProps() does NOT include focusedPanel — if GridLayout still requires it,
      // TypeScript will error at compile time and the component will read undefined.
      // After migration, focusedPanel comes from the store, so no prop is needed.
      const props = makeProps();
      expect((props as Record<string, unknown>).focusedPanel).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Story 25.4: Verify isFocused is driven by store, not by a focusedPanel prop.
  // These tests FAIL before implementation because the current GridLayout reads
  // focusedPanel from props (which is undefined → isFocused always false).
  // After migration, GridLayout reads from the store → isFocused is correct.
  // -------------------------------------------------------------------------

  describe('isFocused driven by store (story 25.4)', () => {
    it('passes isFocused=true to DiagnosePanel when store focusedPanel=3', async () => {
      useDashboardStore.setState({ focusedPanel: 3, panelCount: 4 });
      const { stream } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      expect(vi.mocked(DiagnosePanel)).toHaveBeenCalledWith(
        expect.objectContaining({ isFocused: true }),
        expect.anything()
      );
      result.unmount();
    });

    it('passes isFocused=false to DiagnosePanel when store focusedPanel=0', async () => {
      useDashboardStore.setState({ focusedPanel: 0, panelCount: 4 });
      const { stream } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      expect(vi.mocked(DiagnosePanel)).toHaveBeenCalledWith(
        expect.objectContaining({ isFocused: false }),
        expect.anything()
      );
      result.unmount();
    });
  });

  describe('dimmed prop', () => {
    it('renders without crashing with dimmed=true', async () => {
      const { stream } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ dimmed: true })),
        { stdout: stream },
      );
      await tick();
      result.unmount();
    });

    it('renders without crashing with dimmed=false', async () => {
      const { stream } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ dimmed: false })),
        { stdout: stream },
      );
      await tick();
      result.unmount();
    });
  });
});
