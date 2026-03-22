import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
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

vi.mock('@ui/dashboard/command-menu/TLPanel.js', async () => {
  const { Text: InkText } = await vi.importActual<typeof import('ink')>('ink');
  return {
    TLPanel: () => React.createElement(InkText, null, 'panel:tl'),
  };
});
vi.mock('@ui/dashboard/layouts/PanelSlot.js', async () => {
  const { Box: InkBox } = await vi.importActual<typeof import('ink')>('ink');
  return {
    PanelSlot: ({ children, width, height }: { children: React.ReactNode; width: number; height: number; index: number }) =>
      React.createElement(InkBox, { width, height }, children),
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

const mockStages: string[] = ['sm', 'dev'];

const INITIAL_STORE_STATE = {
  dashboardMode: 'overview' as const,
  actionMode: 'none' as const,
  isFullscreen: false,
  focusedPanel: 0,
  focusModePanel: null,
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

// GridLayout now takes only terminalRows, terminalColumns, stages.
function makeProps(overrides: Partial<Parameters<typeof GridLayout>[0]> = {}): Parameters<typeof GridLayout>[0] {
  return {
    stages: mockStages,
    terminalRows: 40,
    terminalColumns: 120,
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

  describe('renders all four panels', () => {
    it('renders all four panel slots', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:tl');
      expect(frame).toContain('panel:stories');
      expect(frame).toContain('panel:activity');
      expect(frame).toContain('panel:diagnose');
      result.unmount();
    });

    it('renders LiveActivityPanel in normal mode', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      const frame = getOutput();
      expect(frame).toContain('panel:activity');
      result.unmount();
    });
  });

  describe('stages prop', () => {
    it('passes stages to DiagnosePanel', async () => {
      const { stream } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ stages: mockStages })),
        { stdout: stream },
      );
      await tick();
      expect(vi.mocked(DiagnosePanel)).toHaveBeenCalledWith(
        expect.objectContaining({
          stages: ['sm', 'dev']
        }),
        expect.anything()
      );
      result.unmount();
    });
  });

  describe('GridLayoutProps', () => {
    it('accepts terminalRows and terminalColumns', async () => {
      const { stream } = makeStream();
      const result = render(
        React.createElement(GridLayout, makeProps({ terminalRows: 50, terminalColumns: 160 })),
        { stdout: stream },
      );
      await tick();
      result.unmount();
    });

    it('accepts stages as string[]', async () => {
      const props = makeProps();
      expect(props.stages).toEqual(['sm', 'dev']);
    });
  });

  describe('dimmed prop removed', () => {
    it('renders without dimmed prop (not supported)', async () => {
      const { stream } = makeStream();
      const result = render(React.createElement(GridLayout, makeProps()), { stdout: stream });
      await tick();
      result.unmount();
    });
  });
});
