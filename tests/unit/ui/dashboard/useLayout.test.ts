import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useStdout, render } from 'ink';
import { PassThrough } from 'node:stream';
import { useLayout } from '@ui/dashboard/hooks/useLayout.js';
import { useDashboardStore } from '@ui/stores/index.js';

let mockColumns = 120;

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useStdout: vi.fn(() => ({
      stdout: { columns: mockColumns },
    })),
  };
});

type UseStdoutReturn = ReturnType<typeof useStdout>;

const INITIAL_STORE_STATE = {
  dashboardMode: 'overview' as const,
  actionMode: 'none' as const,
  isFullscreen: false,
  focusedPanel: 0,
  panelCount: 4,
};

describe('useLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useStdout).mockImplementation(() => ({
      stdout: { columns: mockColumns },
    }) as UseStdoutReturn);
    useDashboardStore.setState(INITIAL_STORE_STATE);
  });

  it('should return compact when columns < 80', () => {
    mockColumns = 79;
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 79 } } as UseStdoutReturn);
    const result = useLayout();
    expect(result.layoutMode).toBe('compact');
    expect(result.columns).toBe(79);
  });

  it('should return grid when columns === 80', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 80 } } as UseStdoutReturn);
    const result = useLayout();
    expect(result.layoutMode).toBe('grid');
    expect(result.columns).toBe(80);
  });

  it('should return grid when columns === 120', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as UseStdoutReturn);
    const result = useLayout();
    expect(result.layoutMode).toBe('grid');
    expect(result.columns).toBe(120);
  });

  it('should return grid when columns === 300', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 300 } } as UseStdoutReturn);
    const result = useLayout();
    expect(result.layoutMode).toBe('grid');
    expect(result.columns).toBe(300);
  });

  it('should return compact for very narrow terminals', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 30 } } as UseStdoutReturn);
    const result = useLayout();
    expect(result.layoutMode).toBe('compact');
    expect(result.columns).toBe(30);
  });

  it('should return grid for very wide terminals', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 300 } } as UseStdoutReturn);
    const result = useLayout();
    expect(result.layoutMode).toBe('grid');
    expect(result.columns).toBe(300);
  });

  it('should default to 80 columns when stdout is undefined and return grid', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: undefined } as UseStdoutReturn);
    const result = useLayout();
    expect(result.layoutMode).toBe('grid');
    expect(result.columns).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Side-effect tests: useLayout must call useDashboardStore.getState().setPanelCount
// when layoutMode changes. These tests render a harness component with ink so
// that React's useEffect fires.
// ---------------------------------------------------------------------------

function makeStream(): NodeJS.WriteStream & { columns: number } {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 120;
  return stream;
}

function UseLayoutHarness(): null {
  useLayout();
  return null;
}

const tick = (ms = 50): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

describe('useLayout — setPanelCount side effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset panelCount to 0 so we can detect when the effect sets it
    useDashboardStore.setState({ panelCount: 0, focusedPanel: 0 });
  });

  afterEach(() => {
    // Restore default state
    useDashboardStore.setState(INITIAL_STORE_STATE);
  });

  it('should call setPanelCount(4) on mount when layoutMode is grid (>= 80 cols)', async () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as UseStdoutReturn);
    const stream = makeStream();
    const result = render(React.createElement(UseLayoutHarness), { stdout: stream });
    await tick();
    expect(useDashboardStore.getState().panelCount).toBe(4);
    result.unmount();
  });

  it('should call setPanelCount(2) on mount when layoutMode is compact (< 80 cols)', async () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 79 } } as UseStdoutReturn);
    const stream = makeStream();
    const result = render(React.createElement(UseLayoutHarness), { stdout: stream });
    await tick();
    expect(useDashboardStore.getState().panelCount).toBe(2);
    result.unmount();
  });

  it('should call setPanelCount(4) when layoutMode is exactly at boundary (80 cols)', async () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 80 } } as UseStdoutReturn);
    const stream = makeStream();
    const result = render(React.createElement(UseLayoutHarness), { stdout: stream });
    await tick();
    expect(useDashboardStore.getState().panelCount).toBe(4);
    result.unmount();
  });

  it('should call setPanelCount(2) when layoutMode is compact (30 cols)', async () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 30 } } as UseStdoutReturn);
    const stream = makeStream();
    const result = render(React.createElement(UseLayoutHarness), { stdout: stream });
    await tick();
    expect(useDashboardStore.getState().panelCount).toBe(2);
    result.unmount();
  });

  it('should call setPanelCount(4) when stdout is undefined (defaults to 80 cols → grid)', async () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: undefined } as UseStdoutReturn);
    const stream = makeStream();
    const result = render(React.createElement(UseLayoutHarness), { stdout: stream });
    await tick();
    expect(useDashboardStore.getState().panelCount).toBe(4);
    result.unmount();
  });
});
