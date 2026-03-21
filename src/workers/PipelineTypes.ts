import type { DrizzleDB } from '@core/db/Connection.js';
import type { PipelineConfig } from '@core/ConfigTypes.js';
import type { BaseProvider } from '@providers/interfaces/BaseProvider.js';

export interface PipelineOptions {
  db: DrizzleDB;
  pipelineConfig: PipelineConfig;
  provider: BaseProvider;
  projectRoot: string;
  /** Multi-team: Map of team name → PipelineConfig. If provided, workers are spawned for all teams. */
  teamConfigs?: Map<string, PipelineConfig>;
  /** Global cap on concurrent AI sessions across all teams. */
  maxConcurrentSessions?: number;
}

export type ShutdownState = 'running' | 'graceful' | 'force' | 'terminated';

export type RoutingDecision =
  | 'route_next'
  | 'route_reject'
  | 'block_max_attempts'
  | 'block_loop'
  | 'complete_story';

export interface TaskChainInfo {
  chainLength: number;
  stageCounts: Record<string, number>;
  isLoop: boolean;
  reason?: string;
}
