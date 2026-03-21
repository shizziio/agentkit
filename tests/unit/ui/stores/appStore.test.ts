import { describe, it, expect, beforeEach } from 'vitest';
import type { DrizzleDB } from '@core/db/Connection.js';
import type { EventBus } from '@core/EventBus.js';
import type { PipelineConfig } from '@core/ConfigTypes.js';
import type { IResetService } from '@core/ResetTypes.js';
import type { IMarkDoneService } from '@core/MarkDoneTypes.js';
import type { IConfigService } from '@core/ConfigTypes.js';
import type { ITeamSwitchService } from '@core/TeamSwitchTypes.js';
import type { ITraceService } from '@core/TraceTypes.js';
import type { IDiagnoseService } from '@core/DiagnoseTypes.js';
import type { ILoadService, IMarkdownParser } from '@core/LoadTypes.js';
import type { DashboardProps } from '@ui/dashboard/shared/DashboardTypes.js';
import { AgentKitError } from '@core/Errors.js';

// ---------------------------------------------------------------------------
// Module under test — will fail to import until appStore.ts is created.
// ---------------------------------------------------------------------------
import { useAppStore, useDb, useEventBus, usePipelineConfig } from '@stores/appStore.js';

// ---------------------------------------------------------------------------
// Helpers — minimal mock objects implementing the service interfaces
// ---------------------------------------------------------------------------

const mockDb = { _isMockDb: true } as unknown as DrizzleDB;
const mockEventBus = { _isMockEventBus: true } as unknown as EventBus;
const mockPipelineConfig = { stages: [], teams: [] } as unknown as PipelineConfig;
const mockResetService = { resetStory: () => ({}) } as unknown as IResetService;
const mockMarkDoneService = { markStoriesDone: () => ({}) } as unknown as IMarkDoneService;
const mockConfigService = { getConfig: () => ({}) } as unknown as IConfigService;
const mockTeamSwitchService = { switchTeam: async () => {} } as unknown as ITeamSwitchService;
const mockTraceService = { getEpics: () => [] } as unknown as ITraceService;
const mockDiagnoseService = { diagnose: () => ({}) } as unknown as IDiagnoseService;
const mockLoadService = { normalizePath: (p: string) => p } as unknown as ILoadService;
const mockMarkdownParser = { parseEpicsAndStories: () => ({}) } as unknown as IMarkdownParser;
const mockOnComplete = () => {};

/** Full props with all optional callbacks present */
const fullProps: DashboardProps = {
  pipelineConfig: mockPipelineConfig,
  projectId: 42,
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
  onComplete: mockOnComplete,
  onToggleWorkers: () => {},
  onEnterTrace: () => {},
  onTerminateWorkers: () => {},
  onDrain: () => {},
};

/** Minimal initial state used to reset the store between tests */
const INITIAL_STATE = {
  db: null,
  eventBus: null,
  pipelineConfig: null,
  projectId: null,
  resetService: null,
  markDoneService: null,
  configService: null,
  teamSwitchService: null,
  traceService: null,
  diagnoseService: null,
  loadService: null,
  markdownParser: null,
  onComplete: null,
  onToggleWorkers: null,
  onEnterTrace: null,
  onTerminateWorkers: null,
  onDrain: null,
};

function resetStore(): void {
  useAppStore.setState(INITIAL_STATE, true);
}

function getState() {
  return useAppStore.getState();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAppStore', () => {
  beforeEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // Initial state — all fields null before init()
  // -------------------------------------------------------------------------
  describe('initial state (before init())', () => {
    it('should have db as null before init()', () => {
      expect(getState().db).toBeNull();
    });

    it('should have eventBus as null before init()', () => {
      expect(getState().eventBus).toBeNull();
    });

    it('should have pipelineConfig as null before init()', () => {
      expect(getState().pipelineConfig).toBeNull();
    });

    it('should have projectId as null before init()', () => {
      expect(getState().projectId).toBeNull();
    });

    it('should have resetService as null before init()', () => {
      expect(getState().resetService).toBeNull();
    });

    it('should have markDoneService as null before init()', () => {
      expect(getState().markDoneService).toBeNull();
    });

    it('should have configService as null before init()', () => {
      expect(getState().configService).toBeNull();
    });

    it('should have teamSwitchService as null before init()', () => {
      expect(getState().teamSwitchService).toBeNull();
    });

    it('should have traceService as null before init()', () => {
      expect(getState().traceService).toBeNull();
    });

    it('should have diagnoseService as null before init()', () => {
      expect(getState().diagnoseService).toBeNull();
    });

    it('should have loadService as null before init()', () => {
      expect(getState().loadService).toBeNull();
    });

    it('should have markdownParser as null before init()', () => {
      expect(getState().markdownParser).toBeNull();
    });

    it('should have onComplete as null before init()', () => {
      expect(getState().onComplete).toBeNull();
    });

    it('should have onToggleWorkers as null before init()', () => {
      expect(getState().onToggleWorkers).toBeNull();
    });

    it('should have onEnterTrace as null before init()', () => {
      expect(getState().onEnterTrace).toBeNull();
    });

    it('should have onTerminateWorkers as null before init()', () => {
      expect(getState().onTerminateWorkers).toBeNull();
    });

    it('should have onDrain as null before init()', () => {
      expect(getState().onDrain).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // After init() — all fields populated from props
  // -------------------------------------------------------------------------
  describe('after init() with full props', () => {
    beforeEach(() => {
      getState().init(fullProps);
    });

    it('should set db to the db instance from props', () => {
      expect(getState().db).toBe(mockDb);
    });

    it('should set eventBus to the eventBus instance from props', () => {
      expect(getState().eventBus).toBe(mockEventBus);
    });

    it('should set pipelineConfig to the pipelineConfig from props', () => {
      expect(getState().pipelineConfig).toBe(mockPipelineConfig);
    });

    it('should set projectId to 42 from props', () => {
      expect(getState().projectId).toBe(42);
    });

    it('should set resetService to the resetService instance from props', () => {
      expect(getState().resetService).toBe(mockResetService);
    });

    it('should set markDoneService to the markDoneService instance from props', () => {
      expect(getState().markDoneService).toBe(mockMarkDoneService);
    });

    it('should set configService to the configService instance from props', () => {
      expect(getState().configService).toBe(mockConfigService);
    });

    it('should set teamSwitchService to the teamSwitchService instance from props', () => {
      expect(getState().teamSwitchService).toBe(mockTeamSwitchService);
    });

    it('should set traceService to the traceService instance from props', () => {
      expect(getState().traceService).toBe(mockTraceService);
    });

    it('should set diagnoseService to the diagnoseService instance from props', () => {
      expect(getState().diagnoseService).toBe(mockDiagnoseService);
    });

    it('should set loadService to the loadService instance from props', () => {
      expect(getState().loadService).toBe(mockLoadService);
    });

    it('should set markdownParser to the markdownParser instance from props', () => {
      expect(getState().markdownParser).toBe(mockMarkdownParser);
    });

    it('should set onComplete to the onComplete callback from props', () => {
      expect(getState().onComplete).toBe(mockOnComplete);
    });

    it('should set onToggleWorkers to the onToggleWorkers callback from props', () => {
      expect(getState().onToggleWorkers).toBe(fullProps.onToggleWorkers);
    });

    it('should set onEnterTrace to the onEnterTrace callback from props', () => {
      expect(getState().onEnterTrace).toBe(fullProps.onEnterTrace);
    });

    it('should set onTerminateWorkers to the onTerminateWorkers callback from props', () => {
      expect(getState().onTerminateWorkers).toBe(fullProps.onTerminateWorkers);
    });

    it('should set onDrain to the onDrain callback from props', () => {
      expect(getState().onDrain).toBe(fullProps.onDrain);
    });
  });

  // -------------------------------------------------------------------------
  // Optional callbacks — undefined in props must become null in store
  // -------------------------------------------------------------------------
  describe('optional callbacks — coerce undefined to null', () => {
    const minimalProps: DashboardProps = {
      pipelineConfig: mockPipelineConfig,
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
      onComplete: mockOnComplete,
      // onToggleWorkers, onEnterTrace, onTerminateWorkers, onDrain intentionally omitted
    };

    beforeEach(() => {
      getState().init(minimalProps);
    });

    it('should set onToggleWorkers to null when omitted from props', () => {
      expect(getState().onToggleWorkers).toBeNull();
    });

    it('should set onEnterTrace to null when omitted from props', () => {
      expect(getState().onEnterTrace).toBeNull();
    });

    it('should set onTerminateWorkers to null when omitted from props', () => {
      expect(getState().onTerminateWorkers).toBeNull();
    });

    it('should set onDrain to null when omitted from props', () => {
      expect(getState().onDrain).toBeNull();
    });

    it('should still set db correctly when optional callbacks are omitted', () => {
      expect(getState().db).toBe(mockDb);
    });
  });

  // -------------------------------------------------------------------------
  // Second init() call — overwrites existing values
  // -------------------------------------------------------------------------
  describe('init() called twice — second call overwrites first', () => {
    it('should overwrite db when init() is called a second time with different props', () => {
      getState().init(fullProps);
      const anotherDb = { _isAnotherDb: true } as unknown as DrizzleDB;
      getState().init({ ...fullProps, db: anotherDb });
      expect(getState().db).toBe(anotherDb);
    });

    it('should overwrite projectId when init() is called a second time', () => {
      getState().init(fullProps); // projectId = 42
      getState().init({ ...fullProps, projectId: 99 });
      expect(getState().projectId).toBe(99);
    });

    it('should overwrite pipelineConfig when init() is called a second time', () => {
      getState().init(fullProps);
      const newConfig = { stages: [{ name: 'new' }] } as unknown as PipelineConfig;
      getState().init({ ...fullProps, pipelineConfig: newConfig });
      expect(getState().pipelineConfig).toBe(newConfig);
    });
  });

  // -------------------------------------------------------------------------
  // Store integrity — action methods survive setState resets
  // -------------------------------------------------------------------------
  describe('store integrity', () => {
    it('should have init() as a function after setState reset', () => {
      resetStore();
      expect(typeof getState().init).toBe('function');
    });

    it('should have getState() as a function (Zustand API)', () => {
      expect(typeof useAppStore.getState).toBe('function');
    });

    it('should have setState() as a function (Zustand API)', () => {
      expect(typeof useAppStore.setState).toBe('function');
    });

    it('should have subscribe() as a function (Zustand API)', () => {
      expect(typeof useAppStore.subscribe).toBe('function');
    });

    it('should be usable without mounting a React component', () => {
      expect(() => getState()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // useDb() convenience selector
  // -------------------------------------------------------------------------
  describe('useDb()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useDb()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useDb();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message before init()', () => {
      expect(() => useDb()).toThrowError(/db/i);
    });

    it('should return the db instance after init()', () => {
      getState().init(fullProps);
      expect(useDb()).toBe(mockDb);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useDb()).not.toThrow();
    });

    it('should return a non-null value after init()', () => {
      getState().init(fullProps);
      expect(useDb()).not.toBeNull();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      // If it were a React hook, calling outside React would throw a hooks error
      const result = useDb();
      expect(result).toBe(mockDb);
    });
  });

  // -------------------------------------------------------------------------
  // useEventBus() convenience selector
  // -------------------------------------------------------------------------
  describe('useEventBus()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useEventBus()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useEventBus();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message before init()', () => {
      expect(() => useEventBus()).toThrowError(/eventBus/i);
    });

    it('should return the eventBus instance after init()', () => {
      getState().init(fullProps);
      expect(useEventBus()).toBe(mockEventBus);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useEventBus()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = useEventBus();
      expect(result).toBe(mockEventBus);
    });
  });

  // -------------------------------------------------------------------------
  // usePipelineConfig() convenience selector
  // -------------------------------------------------------------------------
  describe('usePipelineConfig()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => usePipelineConfig()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        usePipelineConfig();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message before init()', () => {
      expect(() => usePipelineConfig()).toThrowError(/pipelineConfig/i);
    });

    it('should return the pipelineConfig after init()', () => {
      getState().init(fullProps);
      expect(usePipelineConfig()).toBe(mockPipelineConfig);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => usePipelineConfig()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = usePipelineConfig();
      expect(result).toBe(mockPipelineConfig);
    });
  });
});
