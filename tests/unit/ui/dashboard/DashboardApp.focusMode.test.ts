import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import type { Key } from 'ink';
import { EventBus } from '@core/EventBus.js';
import type { DrizzleDB } from '@core/db/Connection.js';
import { render as inkRender, useStdout, useInput } from 'ink';
import { DashboardApp } from '@ui/dashboard/DashboardApp.js';
import { useDashboardStore } from '@ui/stores/index.js';
import type { PipelineConfig, IConfigService } from '@core/ConfigTypes.js';
import type { IResetService } from '@core/ResetTypes.js';
import type { IMarkDoneService } from '@core/MarkDoneTypes.js';
import type { ITeamSwitchService } from '@core/TeamSwitchTypes.js';
import type { ITraceService } from '@core/TraceTypes.js';
import type { IDiagnoseService } from '@core/DiagnoseTypes.js';

vi.mock('@ui/dashboard/live-activity/LiveActivityFullscreen.js', () => ({
  LiveActivityFullscreen: vi.fn(() => null),
}));

// Story 27.2: DashboardApp now calls useAppStore.getState().init(props) on mount.
// Mock the store so it does not throw when init is called during renders.
vi.mock('@ui/stores/appStore.js', () => ({
  useAppStore: Object.assign(
    vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
      selector({ pipelineConfig: null }),
    ),
    {
      getState: vi.fn(() => ({ init: vi.fn() })),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
  useDb: vi.fn(),
  useEventBus: vi.fn(),
  usePipelineConfig: vi.fn(),
}));

// Story 26.5: mock useStoriesStore to guarantee test isolation — prevents real
// DB access or event-bus side effects from the init() call DashboardApp makes.
vi.mock('@ui/stores/storiesStore.js', () => ({
  useStoriesStore: Object.assign(
    vi.fn((selector: (s: { entries: never[]; summary: { doneTodayCount: number; failedCount: number; averageDurationMs: null } }) => unknown) =>
      selector({ entries: [], summary: { doneTodayCount: 0, failedCount: 0, averageDurationMs: null } })
    ),
    {
      getState: vi.fn(() => ({
        init: vi.fn(),
        cleanup: vi.fn(),
        refresh: vi.fn(),
        entries: [],
        summary: { doneTodayCount: 0, failedCount: 0, averageDurationMs: null },
      })),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
    useApp: vi.fn(() => ({
      exit: vi.fn(),
    })),
    useStdout: vi.fn(() => ({
      stdout: { columns: 120 },
    })),
  };
});

// After story 25.4: layouts no longer receive focusedPanel as a prop.
vi.mock('@ui/dashboard/layouts/CompactLayout.js', () => ({
  CompactLayout: vi.fn(({ focusModePanel }: { focusModePanel: number | null }) =>
    React.createElement('div', { 'data-testid': 'compact', 'data-focus-mode': focusModePanel }),
  ),
}));

vi.mock('@ui/dashboard/layouts/GridLayout.js', () => ({
  GridLayout: vi.fn(({ focusModePanel }: { focusModePanel: number | null }) =>
    React.createElement('div', { 'data-testid': 'grid', 'data-focus-mode': focusModePanel }),
  ),
}));

const INITIAL_STORE_STATE = {
  dashboardMode: 'overview' as const,
  actionMode: 'none' as const,
  isFullscreen: false,
  focusedPanel: 0,
  panelCount: 4,
};

describe('DashboardApp — focus mode key bindings', () => {
  const mockConfig: PipelineConfig = {
    project: { name: 'test-project', owner: 'test-owner' },
    displayName: 'Software Development Pipeline',
    provider: 'claude-cli',
    team: 'agentkit',
    stages: [],
    models: { allowed: [], resolved: {} },
  };

  const mockDb = {} as unknown as DrizzleDB;
  const mockResetService = { resetStory: vi.fn(), resetPipeline: vi.fn(), startListening: vi.fn() } as unknown as IResetService;
  const mockMarkDoneService = { startListening: vi.fn() } as unknown as IMarkDoneService;
  const mockConfigService = { getConfig: vi.fn(), setConfig: vi.fn() } as unknown as IConfigService;
  const mockTeamSwitchService = { switchTeam: vi.fn() } as unknown as ITeamSwitchService;
  const mockTraceService = { getTrace: vi.fn() } as unknown as ITraceService;
  const mockDiagnoseService = { diagnose: vi.fn() } as unknown as IDiagnoseService;
  let mockEventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventBus = new EventBus();
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as unknown as ReturnType<typeof useStdout>);
    useDashboardStore.setState(INITIAL_STORE_STATE);
  });

  const makeDefaultProps = () => ({
    pipelineConfig: mockConfig,
    projectId: 1,
    db: mockDb,
    eventBus: mockEventBus,
    resetService: mockResetService,
    markDoneService: mockMarkDoneService,
    configService: mockConfigService,
    teamSwitchService: mockTeamSwitchService,
    traceService: mockTraceService,
    diagnoseService: mockDiagnoseService,
    onComplete: vi.fn(),
  });

  it('should invoke F key handler without crashing (enters focus mode)', () => {
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const useInputMock = vi.mocked(useInput);
    expect(useInputMock.mock.calls.length).toBeGreaterThan(0);

    const gatedCall = useInputMock.mock.calls[useInputMock.mock.calls.length - 1];
    expect(() => {
      if (gatedCall) {
        (gatedCall[0] as (input: string, key: Key) => void)('f', { tab: false, shift: false } as Key);
      }
    }).not.toThrow();

    result.unmount();
  });

  it('should invoke F key handler twice without crashing (toggle focus mode)', () => {
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const useInputMock = vi.mocked(useInput);
    const gatedCall = useInputMock.mock.calls[useInputMock.mock.calls.length - 1];

    expect(() => {
      if (gatedCall) {
        (gatedCall[0] as (input: string, key: Key) => void)('f', { tab: false, shift: false } as Key);
      }
      const latestCall = useInputMock.mock.calls[useInputMock.mock.calls.length - 1];
      if (latestCall) {
        (latestCall[0] as (input: string, key: Key) => void)('f', { tab: false, shift: false } as Key);
      }
    }).not.toThrow();

    result.unmount();
  });

  it('should invoke Q handler without crashing (replaces Esc for exiting focus mode)', () => {
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const useInputMock = vi.mocked(useInput);

    expect(() => {
      const gatedCall = useInputMock.mock.calls[useInputMock.mock.calls.length - 1];
      if (gatedCall) {
        (gatedCall[0] as (input: string, key: Key) => void)('f', { tab: false, shift: false } as Key);
      }
      const qCall = useInputMock.mock.calls.find((call) => {
        const opts = call[1] as { isActive?: boolean } | undefined;
        return opts?.isActive === true;
      });
      if (qCall) {
        (qCall[0] as (input: string, key: Key) => void)('q', { tab: false, shift: false } as Key);
      }
    }).not.toThrow();

    result.unmount();
  });

  // -------------------------------------------------------------------------
  // Story 25.4: Focus cycling must use the store's focusNext/focusPrev actions.
  // After pressing Tab, the store's focusedPanel should advance.
  // FAILS before migration: Tab calls usePanelFocus hook's local state, not store.
  // PASSES after migration: Tab calls useDashboardStore.focusNext.
  // -------------------------------------------------------------------------

  it('should advance store focusedPanel when Tab is pressed (focusNext from store)', () => {
    useDashboardStore.setState({ focusedPanel: 0, panelCount: 4 });

    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const useInputMock = vi.mocked(useInput);
    const lastCall = useInputMock.mock.calls[useInputMock.mock.calls.length - 1];
    if (lastCall) {
      (lastCall[0] as (input: string, key: Key) => void)('', { tab: true, shift: false } as Key);
    }

    // After Tab press, store's focusedPanel should have advanced to 1
    expect(useDashboardStore.getState().focusedPanel).toBe(1);

    result.unmount();
  });

  it('should wrap store focusedPanel from last panel to 0 when Tab is pressed', () => {
    useDashboardStore.setState({ focusedPanel: 3, panelCount: 4 });

    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const useInputMock = vi.mocked(useInput);
    const lastCall = useInputMock.mock.calls[useInputMock.mock.calls.length - 1];
    if (lastCall) {
      (lastCall[0] as (input: string, key: Key) => void)('', { tab: true, shift: false } as Key);
    }

    expect(useDashboardStore.getState().focusedPanel).toBe(0);

    result.unmount();
  });
});
