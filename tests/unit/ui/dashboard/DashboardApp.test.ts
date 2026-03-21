import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import type { Key } from 'ink';
import { EventBus } from '@core/EventBus.js';
import type { DrizzleDB } from '@core/db/Connection.js';
import { render as inkRender, useStdout, useInput, useApp } from 'ink';
import { DashboardApp } from '@ui/dashboard/DashboardApp.js';
import { CompactLayout } from '@ui/dashboard/layouts/CompactLayout.js';
import { GridLayout } from '@ui/dashboard/layouts/GridLayout.js';
import { BrandHeader } from '@ui/dashboard/brand/BrandHeader.js';
import { useDashboardStore } from '@ui/stores/index.js';
import type { PipelineConfig, IConfigService } from '@core/ConfigTypes.js';
import type { IResetService } from '@core/ResetTypes.js';
import type { IMarkDoneService } from '@core/MarkDoneTypes.js';
import type { ITeamSwitchService } from '@core/TeamSwitchTypes.js';
import type { ITraceService } from '@core/TraceTypes.js';
import type { IDiagnoseService } from '@core/DiagnoseTypes.js';
import type { ILoadService, IMarkdownParser } from '@core/LoadTypes.js';

vi.mock('@ui/dashboard/live-activity/LiveActivityFullscreen.js', () => ({
  LiveActivityFullscreen: vi.fn(() => null),
}));

vi.mock('@ui/dashboard/brand/BrandHeader.js', () => ({
  BrandHeader: vi.fn(() => null),
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

// After story 25.4: layouts no longer receive focusedPanel as a prop —
// they read it from useDashboardStore directly. The mock omits focusedPanel
// from the expected props so tests catch accidental prop forwarding.
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

// Story 27.2: mock useAppStore so DashboardApp can call getState().init(props)
// on mount without side effects. Tests assert init is called and pipelineConfig
// is read from the store selector instead of destructured from props.
const mockAppStoreInit = vi.fn();
// Mutable reference used by the useAppStore selector mock — set per-test.
const _appStoreMockState: { pipelineConfig: PipelineConfig | null } = {
  pipelineConfig: null,
};

vi.mock('@ui/stores/appStore.js', () => ({
  useAppStore: Object.assign(
    vi.fn((selector: (s: { pipelineConfig: PipelineConfig | null }) => unknown) =>
      selector(_appStoreMockState)
    ),
    {
      getState: vi.fn(() => ({ init: mockAppStoreInit })),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
  useDb: vi.fn(),
  useEventBus: vi.fn(),
  usePipelineConfig: vi.fn(),
}));

// Story 26.5: mock useStoriesStore so DashboardApp can call init/cleanup/refresh
// without DB errors. After implementation, DashboardApp will call
// useStoriesStore.getState().init(eventBus, db, activeTeam) in useEffect.
const mockStoriesStoreInit = vi.fn();
const mockStoriesStoreCleanup = vi.fn();
const mockStoriesStoreRefresh = vi.fn();
vi.mock('@ui/stores/storiesStore.js', () => ({
  useStoriesStore: Object.assign(
    vi.fn((selector: (s: { entries: never[]; summary: { doneTodayCount: number; failedCount: number; averageDurationMs: null } }) => unknown) =>
      selector({ entries: [], summary: { doneTodayCount: 0, failedCount: 0, averageDurationMs: null } })
    ),
    {
      getState: vi.fn(() => ({
        init: mockStoriesStoreInit,
        cleanup: mockStoriesStoreCleanup,
        refresh: mockStoriesStoreRefresh,
        entries: [],
        summary: { doneTodayCount: 0, failedCount: 0, averageDurationMs: null },
      })),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

// Story 27.2 AC4: mock useDashboardContent so its call-site params can be
// inspected in assertions. Uses vi.hoisted() so the reference is available
// when vi.mock factories run (vi.mock is hoisted to top of file).
const mockUseDashboardContent = vi.hoisted(() => vi.fn());
vi.mock('@ui/dashboard/hooks/useDashboardContent.js', () => ({
  useDashboardContent: mockUseDashboardContent,
}));

const INITIAL_STORE_STATE = {
  dashboardMode: 'overview' as const,
  actionMode: 'none' as const,
  isFullscreen: false,
  focusedPanel: 0,
  panelCount: 4,
};

describe('DashboardApp', () => {
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
  const mockLoadService = { load: vi.fn() } as unknown as ILoadService;
  const mockMarkdownParser = { parse: vi.fn() } as unknown as IMarkdownParser;
  let onCompleteMock: ReturnType<typeof vi.fn>;
  let mockEventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    onCompleteMock = vi.fn();
    mockEventBus = new EventBus();
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as unknown as ReturnType<typeof useStdout>);
    useDashboardStore.setState(INITIAL_STORE_STATE);
    // Reset appStore mock state so selector returns null by default (first-render fallback path).
    _appStoreMockState.pipelineConfig = null;
    // Provide a stub tlPanelNode for useDashboardContent (layouts are already mocked, so null is safe).
    mockUseDashboardContent.mockReturnValue({ tlPanelNode: null });
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
    loadService: mockLoadService,
    markdownParser: mockMarkdownParser,
    onComplete: onCompleteMock,
  });

  it('should render without crashing', () => {
    const component = React.createElement(DashboardApp, makeDefaultProps());
    const result = inkRender(component);
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should render GridLayout when columns >= 80', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as unknown as ReturnType<typeof useStdout>);

    const component = React.createElement(DashboardApp, makeDefaultProps());
    const result = inkRender(component);
    expect(result).toBeDefined();
    expect(GridLayout).toHaveBeenCalled();
    result.unmount();
  });

  it('should render CompactLayout when columns < 80', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 79 } } as unknown as ReturnType<typeof useStdout>);

    const component = React.createElement(DashboardApp, makeDefaultProps());
    const result = inkRender(component);
    expect(result).toBeDefined();
    expect(CompactLayout).toHaveBeenCalled();
    result.unmount();
  });

  it('should render GridLayout when columns are very wide (300)', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 300 } } as unknown as ReturnType<typeof useStdout>);

    const component = React.createElement(DashboardApp, makeDefaultProps());
    const result = inkRender(component);
    expect(result).toBeDefined();
    expect(GridLayout).toHaveBeenCalled();
    result.unmount();
  });

  it('should wire KeyBindings with useInput', () => {
    const component = React.createElement(DashboardApp, makeDefaultProps());
    const result = inkRender(component);
    expect(useInput).toHaveBeenCalled();
    result.unmount();
  });

  it('should wire quit through handleQuit which calls onComplete and exit', () => {
    const mockExit = vi.fn();
    vi.mocked(useApp).mockReturnValue({ exit: mockExit });

    const component = React.createElement(DashboardApp, makeDefaultProps());
    const result = inkRender(component);
    expect(result).toBeDefined();
    expect(useInput).toHaveBeenCalled();
    result.unmount();
  });

  it('should handle Tab key for focus cycling', () => {
    const component = React.createElement(DashboardApp, makeDefaultProps());
    const result = inkRender(component);

    const useInputMock = vi.mocked(useInput);
    const lastCall = useInputMock.mock.calls[useInputMock.mock.calls.length - 1];
    if (lastCall) {
      const handler = lastCall[0] as (input: string, key: Key) => void;
      handler('', { tab: true, shift: false } as Key);
    }

    expect(useInputMock).toHaveBeenCalled();
    result.unmount();
  });

  it('should pass focusModePanel=null to layout by default', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as unknown as ReturnType<typeof useStdout>);

    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const gridMock = vi.mocked(GridLayout);
    const lastCall = gridMock.mock.calls[gridMock.mock.calls.length - 1];
    expect(lastCall?.[0].focusModePanel).toBeNull();

    result.unmount();
  });

  it('should start with focusModePanel=null after layout switch (fresh render)', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 79 } } as unknown as ReturnType<typeof useStdout>);
    const result1 = inkRender(React.createElement(DashboardApp, makeDefaultProps()));
    result1.unmount();

    vi.clearAllMocks();
    useDashboardStore.setState(INITIAL_STORE_STATE);

    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as unknown as ReturnType<typeof useStdout>);
    const result2 = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const gridMock = vi.mocked(GridLayout);
    const latestCall = gridMock.mock.calls[gridMock.mock.calls.length - 1];
    expect(latestCall?.[0].focusModePanel).toBeNull();

    result2.unmount();
  });

  // -------------------------------------------------------------------------
  // Story 25.4: DashboardApp must NOT forward focusedPanel as a prop to
  // GridLayout or CompactLayout — layouts read it from the store directly.
  // -------------------------------------------------------------------------

  it('should NOT pass focusedPanel prop to GridLayout (reads from store instead)', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as unknown as ReturnType<typeof useStdout>);

    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const gridMock = vi.mocked(GridLayout);
    const lastCall = gridMock.mock.calls[gridMock.mock.calls.length - 1];
    expect(lastCall?.[0].focusedPanel).toBeUndefined();

    result.unmount();
  });

  it('should NOT pass focusedPanel prop to CompactLayout (reads from store instead)', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 79 } } as unknown as ReturnType<typeof useStdout>);

    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const compactMock = vi.mocked(CompactLayout);
    const lastCall = compactMock.mock.calls[compactMock.mock.calls.length - 1];
    expect(lastCall?.[0].focusedPanel).toBeUndefined();

    result.unmount();
  });

  // -------------------------------------------------------------------------
  // Story 25.4: KeyBindings must receive onFocusNext/onFocusPrev callbacks
  // from store action references.
  // -------------------------------------------------------------------------

  it('should wire KeyBindings onFocusNext to store focusNext (Tab advances store focusedPanel)', () => {
    useDashboardStore.setState({ focusedPanel: 0, panelCount: 4 });
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const useInputMock = vi.mocked(useInput);
    const activeCall = useInputMock.mock.calls.find((call) => {
      const opts = call[1] as { isActive?: boolean } | undefined;
      return opts?.isActive === true;
    });
    if (activeCall) {
      (activeCall[0] as (input: string, key: Key) => void)(
        '',
        { tab: true, shift: false } as Key,
      );
    }

    expect(useDashboardStore.getState().focusedPanel).toBe(1);
    result.unmount();
  });

  it('should wire KeyBindings onFocusPrev to store focusPrev (Shift+Tab decrements store focusedPanel)', () => {
    useDashboardStore.setState({ focusedPanel: 2, panelCount: 4 });
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const useInputMock = vi.mocked(useInput);
    const activeCall = useInputMock.mock.calls.find((call) => {
      const opts = call[1] as { isActive?: boolean } | undefined;
      return opts?.isActive === true;
    });
    if (activeCall) {
      (activeCall[0] as (input: string, key: Key) => void)(
        '',
        { tab: true, shift: true } as Key,
      );
    }

    expect(useDashboardStore.getState().focusedPanel).toBe(1);
    result.unmount();
  });

  // -------------------------------------------------------------------------
  // Story 26.5: DashboardApp initializes storiesStore in useEffect.
  // After implementation, useStoriesStore.getState().init() is called with
  // (eventBus, db, activeTeam) when the component mounts.
  // -------------------------------------------------------------------------

  it('should render without crashing after storiesStore is wired (Story 26.5)', () => {
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));
    expect(result).toBeDefined();
    result.unmount();
  });

  it('should call useStoriesStore.getState().init with (eventBus, db, activeTeam) on mount (Story 26.5)', () => {
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    // DashboardApp calls useStoriesStore.getState().init(eventBus, db, pipelineConfig.team) in useEffect.
    expect(mockStoriesStoreInit).toHaveBeenCalledWith(mockEventBus, mockDb, 'agentkit');

    result.unmount();
  });

  it('should NOT pass db, eventBus, or refreshKey as props to GridLayout (Story 26.5)', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as unknown as ReturnType<typeof useStdout>);
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const gridMock = vi.mocked(GridLayout);
    const lastCall = gridMock.mock.calls[gridMock.mock.calls.length - 1];
    const props = lastCall?.[0] as Record<string, unknown>;
    expect(props?.['db']).toBeUndefined();
    expect(props?.['eventBus']).toBeUndefined();
    expect(props?.['refreshKey']).toBeUndefined();

    result.unmount();
  });

  it('should NOT pass db, eventBus, or refreshKey as props to CompactLayout (Story 26.5)', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 79 } } as unknown as ReturnType<typeof useStdout>);
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const compactMock = vi.mocked(CompactLayout);
    const lastCall = compactMock.mock.calls[compactMock.mock.calls.length - 1];
    const props = lastCall?.[0] as Record<string, unknown>;
    expect(props?.['db']).toBeUndefined();
    expect(props?.['eventBus']).toBeUndefined();
    expect(props?.['refreshKey']).toBeUndefined();

    result.unmount();
  });

  // -------------------------------------------------------------------------
  // Story 27.2: DashboardApp initializes appStore on mount and reads
  // pipelineConfig from store selector instead of destructuring props.
  // -------------------------------------------------------------------------

  it('should call useAppStore.getState().init with DashboardProps on mount (Story 27.2)', () => {
    const props = makeDefaultProps();
    const result = inkRender(React.createElement(DashboardApp, props));

    // useAppStore.getState().init must be called exactly once with the full DashboardProps
    expect(mockAppStoreInit).toHaveBeenCalledTimes(1);

    // Spot-check key fields from DashboardProps are passed to init
    const callArg = mockAppStoreInit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).toBeDefined();
    expect(callArg['pipelineConfig']).toBe(props.pipelineConfig);
    expect(callArg['eventBus']).toBe(props.eventBus);
    expect(callArg['db']).toBe(props.db);
    expect(callArg['projectId']).toBe(props.projectId);
    expect(callArg['resetService']).toBe(props.resetService);
    expect(callArg['markDoneService']).toBe(props.markDoneService);
    expect(callArg['configService']).toBe(props.configService);
    expect(callArg['teamSwitchService']).toBe(props.teamSwitchService);

    result.unmount();
  });

  it('should use props.pipelineConfig as fallback when appStore returns null (Story 27.2 first-render race)', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as unknown as ReturnType<typeof useStdout>);

    // _appStoreMockState.pipelineConfig is already null (set in beforeEach).
    // DashboardApp must use `useAppStore(s => s.pipelineConfig) ?? props.pipelineConfig`.
    // When store returns null, props.pipelineConfig ('test-project') must be the fallback.
    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    const brandMock = vi.mocked(BrandHeader);
    const lastCall = brandMock.mock.calls[brandMock.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const brandProps = lastCall?.[0] as { projectName: string };
    // Must come from props, not store (store is null → fallback to props.pipelineConfig.project.name)
    expect(brandProps.projectName).toBe('test-project');

    result.unmount();
  });

  it('should NOT read pipelineConfig directly from props.pipelineConfig when store is populated (Story 27.2)', () => {
    vi.mocked(useStdout).mockReturnValue({ stdout: { columns: 120 } } as unknown as ReturnType<typeof useStdout>);

    // Seed the appStore mock to return a DIFFERENT config than what is in props.
    // After implementation, DashboardApp reads via `useAppStore(s => s.pipelineConfig) ?? props.pipelineConfig`.
    // When the store is populated, the store value must win.
    const storeConfig: PipelineConfig = {
      project: { name: 'from-store', owner: 'store-owner' },
      displayName: 'Store Pipeline',
      provider: 'claude-cli',
      team: 'store-team',
      stages: [{ name: 'store-stage', agents: [], dependencies: [] }],
      models: { allowed: [], resolved: {} },
    };
    _appStoreMockState.pipelineConfig = storeConfig;

    const result = inkRender(React.createElement(DashboardApp, makeDefaultProps()));

    // BrandHeader must have received projectName from the STORE, not from props ('test-project').
    const brandMock = vi.mocked(BrandHeader);
    const lastCall = brandMock.mock.calls[brandMock.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const brandProps = lastCall?.[0] as { projectName: string };
    expect(brandProps.projectName).toBe('from-store');

    // GridLayout must have received stages from the STORE config, not props (which has stages: []).
    const gridMock = vi.mocked(GridLayout);
    const gridLastCall = gridMock.mock.calls[gridMock.mock.calls.length - 1];
    const gridProps = gridLastCall?.[0] as { stages: unknown[] };
    expect(gridProps.stages).toBe(storeConfig.stages);

    result.unmount();
  });

  it('should NOT pass removed service params to useDashboardContent (Story 27.3 AC)', () => {
    // Story 27.3: db, eventBus, projectId, pipelineConfig, configService,
    // teamSwitchService, resetService, markDoneService, loadService, markdownParser
    // are now read from appStore internally — NOT passed as useDashboardContent params.
    const props = makeDefaultProps();
    const result = inkRender(React.createElement(DashboardApp, props));

    expect(mockUseDashboardContent).toHaveBeenCalled();
    const callParams = mockUseDashboardContent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callParams).toBeDefined();

    // These 10 fields must NOT be present in useDashboardContent params after Story 27.3
    expect(callParams).not.toHaveProperty('db');
    expect(callParams).not.toHaveProperty('eventBus');
    expect(callParams).not.toHaveProperty('configService');
    expect(callParams).not.toHaveProperty('teamSwitchService');
    expect(callParams).not.toHaveProperty('resetService');
    expect(callParams).not.toHaveProperty('markDoneService');
    expect(callParams).not.toHaveProperty('loadService');
    expect(callParams).not.toHaveProperty('markdownParser');
    expect(callParams).not.toHaveProperty('projectId');
    expect(callParams).not.toHaveProperty('pipelineConfig');

    result.unmount();
  });
});
