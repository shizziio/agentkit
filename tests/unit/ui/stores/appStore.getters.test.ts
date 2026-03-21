/**
 * Tests for the new appStore getter helpers added in Story 27.3.
 *
 * These getters follow the same pattern as the existing useDb/useEventBus/usePipelineConfig:
 * - Throw AgentKitError with code 'STORE_NOT_INITIALIZED' when the value is null
 * - Return the stored value after init() is called
 * - Are plain functions callable outside React components
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DrizzleDB } from '@core/db/Connection.js';
import type { EventBus } from '@core/EventBus.js';
import type { PipelineConfig, IConfigService } from '@core/ConfigTypes.js';
import type { IResetService } from '@core/ResetTypes.js';
import type { IMarkDoneService } from '@core/MarkDoneTypes.js';
import type { ITeamSwitchService } from '@core/TeamSwitchTypes.js';
import type { IDiagnoseService } from '@core/DiagnoseTypes.js';
import type { ILoadService, IMarkdownParser } from '@core/LoadTypes.js';
import type { DashboardProps } from '@ui/dashboard/shared/DashboardTypes.js';
import type { ITraceService } from '@core/TraceTypes.js';
import { AgentKitError } from '@core/Errors.js';

// ---------------------------------------------------------------------------
// Module under test — will fail to import until new getters are added to appStore.ts
// ---------------------------------------------------------------------------
import {
  useAppStore,
  useProjectId,
  useResetService,
  useMarkDoneService,
  useConfigService,
  useTeamSwitchService,
  useLoadService,
  useMarkdownParser,
  useDiagnoseService,
} from '@stores/appStore.js';

// ---------------------------------------------------------------------------
// Helpers — minimal mock objects
// ---------------------------------------------------------------------------
const mockDb = { _isMockDb: true } as unknown as DrizzleDB;
const mockEventBus = { _isMockEventBus: true } as unknown as EventBus;
const mockPipelineConfig = { stages: [] } as unknown as PipelineConfig;
const mockResetService = { getResetableStories: () => [] } as unknown as IResetService;
const mockMarkDoneService = { getMarkableStories: async () => [] } as unknown as IMarkDoneService;
const mockConfigService = { loadSettings: () => ({}) } as unknown as IConfigService;
const mockTeamSwitchService = { switchTeam: async () => {} } as unknown as ITeamSwitchService;
const mockTraceService = { getEpics: () => [] } as unknown as ITraceService;
const mockDiagnoseService = { diagnose: () => ({}) } as unknown as IDiagnoseService;
const mockLoadService = { normalizePath: (p: string) => p } as unknown as ILoadService;
const mockMarkdownParser = { parseEpicsAndStories: () => ({}) } as unknown as IMarkdownParser;
const mockOnComplete = () => {};

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
};

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

describe('useAppStore — new getter helpers (Story 27.3)', () => {
  beforeEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // useProjectId()
  // -------------------------------------------------------------------------
  describe('useProjectId()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useProjectId()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useProjectId();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message mentioning projectId before init()', () => {
      expect(() => useProjectId()).toThrowError(/projectId/i);
    });

    it('should return the projectId (42) after init()', () => {
      getState().init(fullProps);
      expect(useProjectId()).toBe(42);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useProjectId()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = useProjectId();
      expect(result).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // useResetService()
  // -------------------------------------------------------------------------
  describe('useResetService()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useResetService()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useResetService();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message mentioning resetService before init()', () => {
      expect(() => useResetService()).toThrowError(/resetService/i);
    });

    it('should return the resetService instance after init()', () => {
      getState().init(fullProps);
      expect(useResetService()).toBe(mockResetService);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useResetService()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = useResetService();
      expect(result).toBe(mockResetService);
    });
  });

  // -------------------------------------------------------------------------
  // useMarkDoneService()
  // -------------------------------------------------------------------------
  describe('useMarkDoneService()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useMarkDoneService()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useMarkDoneService();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message mentioning markDoneService before init()', () => {
      expect(() => useMarkDoneService()).toThrowError(/markDoneService/i);
    });

    it('should return the markDoneService instance after init()', () => {
      getState().init(fullProps);
      expect(useMarkDoneService()).toBe(mockMarkDoneService);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useMarkDoneService()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = useMarkDoneService();
      expect(result).toBe(mockMarkDoneService);
    });
  });

  // -------------------------------------------------------------------------
  // useConfigService()
  // -------------------------------------------------------------------------
  describe('useConfigService()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useConfigService()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useConfigService();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message mentioning configService before init()', () => {
      expect(() => useConfigService()).toThrowError(/configService/i);
    });

    it('should return the configService instance after init()', () => {
      getState().init(fullProps);
      expect(useConfigService()).toBe(mockConfigService);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useConfigService()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = useConfigService();
      expect(result).toBe(mockConfigService);
    });
  });

  // -------------------------------------------------------------------------
  // useTeamSwitchService()
  // -------------------------------------------------------------------------
  describe('useTeamSwitchService()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useTeamSwitchService()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useTeamSwitchService();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message mentioning teamSwitchService before init()', () => {
      expect(() => useTeamSwitchService()).toThrowError(/teamSwitchService/i);
    });

    it('should return the teamSwitchService instance after init()', () => {
      getState().init(fullProps);
      expect(useTeamSwitchService()).toBe(mockTeamSwitchService);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useTeamSwitchService()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = useTeamSwitchService();
      expect(result).toBe(mockTeamSwitchService);
    });
  });

  // -------------------------------------------------------------------------
  // useLoadService()
  // -------------------------------------------------------------------------
  describe('useLoadService()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useLoadService()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useLoadService();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message mentioning loadService before init()', () => {
      expect(() => useLoadService()).toThrowError(/loadService/i);
    });

    it('should return the loadService instance after init()', () => {
      getState().init(fullProps);
      expect(useLoadService()).toBe(mockLoadService);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useLoadService()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = useLoadService();
      expect(result).toBe(mockLoadService);
    });
  });

  // -------------------------------------------------------------------------
  // useMarkdownParser()
  // -------------------------------------------------------------------------
  describe('useMarkdownParser()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useMarkdownParser()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useMarkdownParser();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message mentioning markdownParser before init()', () => {
      expect(() => useMarkdownParser()).toThrowError(/markdownParser/i);
    });

    it('should return the markdownParser instance after init()', () => {
      getState().init(fullProps);
      expect(useMarkdownParser()).toBe(mockMarkdownParser);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useMarkdownParser()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = useMarkdownParser();
      expect(result).toBe(mockMarkdownParser);
    });
  });

  // -------------------------------------------------------------------------
  // useDiagnoseService()
  // -------------------------------------------------------------------------
  describe('useDiagnoseService()', () => {
    it('should throw AgentKitError before init() is called', () => {
      expect(() => useDiagnoseService()).toThrow(AgentKitError);
    });

    it('should throw with code "STORE_NOT_INITIALIZED" before init()', () => {
      let caughtError: AgentKitError | undefined;
      try {
        useDiagnoseService();
      } catch (e) {
        caughtError = e as AgentKitError;
      }
      expect(caughtError).toBeDefined();
      expect(caughtError!.code).toBe('STORE_NOT_INITIALIZED');
    });

    it('should throw with a descriptive message mentioning diagnoseService before init()', () => {
      expect(() => useDiagnoseService()).toThrowError(/diagnoseService/i);
    });

    it('should return the diagnoseService instance after init()', () => {
      getState().init(fullProps);
      expect(useDiagnoseService()).toBe(mockDiagnoseService);
    });

    it('should not throw after init() is called', () => {
      getState().init(fullProps);
      expect(() => useDiagnoseService()).not.toThrow();
    });

    it('should be callable outside a React component (plain function)', () => {
      getState().init(fullProps);
      const result = useDiagnoseService();
      expect(result).toBe(mockDiagnoseService);
    });
  });

  // -------------------------------------------------------------------------
  // All new getters are exported from @stores/appStore
  // -------------------------------------------------------------------------
  describe('exports', () => {
    it('should export useProjectId as a function', () => {
      expect(typeof useProjectId).toBe('function');
    });

    it('should export useResetService as a function', () => {
      expect(typeof useResetService).toBe('function');
    });

    it('should export useMarkDoneService as a function', () => {
      expect(typeof useMarkDoneService).toBe('function');
    });

    it('should export useConfigService as a function', () => {
      expect(typeof useConfigService).toBe('function');
    });

    it('should export useTeamSwitchService as a function', () => {
      expect(typeof useTeamSwitchService).toBe('function');
    });

    it('should export useLoadService as a function', () => {
      expect(typeof useLoadService).toBe('function');
    });

    it('should export useMarkdownParser as a function', () => {
      expect(typeof useMarkdownParser).toBe('function');
    });

    it('should export useDiagnoseService as a function', () => {
      expect(typeof useDiagnoseService).toBe('function');
    });
  });
});
