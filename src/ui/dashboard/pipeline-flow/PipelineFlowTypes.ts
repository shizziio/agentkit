import type { StageConfig } from '@core/ConfigTypes.js';
import type { EventBus } from '@core/EventBus.js';
import type { DrizzleDB } from '@core/db/Connection.js';

export interface StageFlowState {
  stageName: string;
  displayName: string;
  icon: string;
  status: 'idle' | 'busy';
  queuedCount: number;
  estimatedTimeMs: number | null;
}

export interface PipelineFlowPanelProps {
  stages: StageConfig[];
  eventBus?: EventBus;
  db?: DrizzleDB;
  activeTeam?: string;
  width?: number;
  height?: number;
}
