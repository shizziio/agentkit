import { create } from 'zustand';
import { AgentKitError } from '@core/Errors.js';
import type { DrizzleDB } from '@core/db/Connection.js';
import type { EventBus } from '@core/EventBus.js';
import type { PipelineConfig, ProjectConfig, IConfigService } from '@core/ConfigTypes.js';
import type { IResetService } from '@core/ResetTypes.js';
import type { IMarkDoneService } from '@core/MarkDoneTypes.js';
import type { ITeamSwitchService } from '@core/TeamSwitchTypes.js';
import type { ITraceService } from '@core/TraceTypes.js';
import type { IDiagnoseService } from '@core/DiagnoseTypes.js';
import type { ILoadService, IMarkdownParser } from '@core/LoadTypes.js';
import type { DashboardProps } from '@ui/dashboard/shared/DashboardTypes.js';

export interface AppState {
  db: DrizzleDB | null;
  eventBus: EventBus | null;
  pipelineConfig: PipelineConfig | null;
  projectConfig: ProjectConfig | null;
  projectId: number | null;
  resetService: IResetService | null;
  markDoneService: IMarkDoneService | null;
  configService: IConfigService | null;
  teamSwitchService: ITeamSwitchService | null;
  traceService: ITraceService | null;
  diagnoseService: IDiagnoseService | null;
  loadService: ILoadService | null;
  markdownParser: IMarkdownParser | null;
  onComplete: (() => void) | null;
  onToggleWorkers: (() => void) | null;
  onEnterTrace: (() => void) | null;
  onTerminateWorkers: (() => void) | null;
  onDrain: (() => void) | null;
}

export interface AppActions {
  init(props: DashboardProps): void;
}

const _store = create<AppState & AppActions>()((set) => ({
  db: null,
  eventBus: null,
  pipelineConfig: null,
  projectConfig: null,
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

  init: (props: DashboardProps) => {
    set({
      db: props.db,
      eventBus: props.eventBus,
      pipelineConfig: props.pipelineConfig,
      projectConfig: props.projectConfig ?? null,
      projectId: props.projectId,
      resetService: props.resetService,
      markDoneService: props.markDoneService,
      configService: props.configService,
      teamSwitchService: props.teamSwitchService,
      traceService: props.traceService,
      diagnoseService: props.diagnoseService,
      loadService: props.loadService,
      markdownParser: props.markdownParser,
      onComplete: props.onComplete,
      onToggleWorkers: props.onToggleWorkers ?? null,
      onEnterTrace: props.onEnterTrace ?? null,
      onTerminateWorkers: props.onTerminateWorkers ?? null,
      onDrain: props.onDrain ?? null,
    });
  },
}));

// Patch external setState to always merge (never replace).
// When tests reset state via setState(INITIAL_STATE, true), replace mode would
// erase action methods from the store. By always merging, state fields are
// reset while action methods are preserved.
const _origSetState = _store.setState;
_store.setState = (partial, _replace) => _origSetState(partial);

export const useAppStore = _store;

export function useDb(): DrizzleDB {
  const db = useAppStore.getState().db;
  if (db === null) {
    throw new AgentKitError('appStore not initialized: db is null', 'STORE_NOT_INITIALIZED');
  }
  return db;
}

export function useEventBus(): EventBus {
  const eventBus = useAppStore.getState().eventBus;
  if (eventBus === null) {
    throw new AgentKitError('appStore not initialized: eventBus is null', 'STORE_NOT_INITIALIZED');
  }
  return eventBus;
}

export function usePipelineConfig(): PipelineConfig {
  const pipelineConfig = useAppStore.getState().pipelineConfig;
  if (pipelineConfig === null) {
    throw new AgentKitError(
      'appStore not initialized: pipelineConfig is null',
      'STORE_NOT_INITIALIZED',
    );
  }
  return pipelineConfig;
}

export function useProjectId(): number {
  const projectId = useAppStore.getState().projectId;
  if (projectId === null) {
    throw new AgentKitError('appStore not initialized: projectId is null', 'STORE_NOT_INITIALIZED');
  }
  return projectId;
}

export function useResetService(): IResetService {
  const resetService = useAppStore.getState().resetService;
  if (resetService === null) {
    throw new AgentKitError(
      'appStore not initialized: resetService is null',
      'STORE_NOT_INITIALIZED',
    );
  }
  return resetService;
}

export function useMarkDoneService(): IMarkDoneService {
  const markDoneService = useAppStore.getState().markDoneService;
  if (markDoneService === null) {
    throw new AgentKitError(
      'appStore not initialized: markDoneService is null',
      'STORE_NOT_INITIALIZED',
    );
  }
  return markDoneService;
}

export function useConfigService(): IConfigService {
  const configService = useAppStore.getState().configService;
  if (configService === null) {
    throw new AgentKitError(
      'appStore not initialized: configService is null',
      'STORE_NOT_INITIALIZED',
    );
  }
  return configService;
}

export function useTeamSwitchService(): ITeamSwitchService {
  const teamSwitchService = useAppStore.getState().teamSwitchService;
  if (teamSwitchService === null) {
    throw new AgentKitError(
      'appStore not initialized: teamSwitchService is null',
      'STORE_NOT_INITIALIZED',
    );
  }
  return teamSwitchService;
}

export function useLoadService(): ILoadService {
  const loadService = useAppStore.getState().loadService;
  if (loadService === null) {
    throw new AgentKitError(
      'appStore not initialized: loadService is null',
      'STORE_NOT_INITIALIZED',
    );
  }
  return loadService;
}

export function useMarkdownParser(): IMarkdownParser {
  const markdownParser = useAppStore.getState().markdownParser;
  if (markdownParser === null) {
    throw new AgentKitError(
      'appStore not initialized: markdownParser is null',
      'STORE_NOT_INITIALIZED',
    );
  }
  return markdownParser;
}

export function useDiagnoseService(): IDiagnoseService {
  const diagnoseService = useAppStore.getState().diagnoseService;
  if (diagnoseService === null) {
    throw new AgentKitError(
      'appStore not initialized: diagnoseService is null',
      'STORE_NOT_INITIALIZED',
    );
  }
  return diagnoseService;
}
