// UI-layer types for the trace browser feature
import type { EpicNode, StoryNode, TaskNode } from '@core/TraceTypes.js';

export type { EpicNode, StoryNode, TaskNode };

export type VisibleLineKind = 'epic' | 'story' | 'task';

export interface VisibleLineEpic {
  kind: 'epic';
  depth: number;
  node: EpicNode;
  isExpanded: boolean;
}

export interface VisibleLineStory {
  kind: 'story';
  depth: number;
  node: StoryNode;
  isExpanded: boolean;
}

export interface VisibleLineTask {
  kind: 'task';
  depth: number;
  node: TaskNode;
}

export type VisibleLine = VisibleLineEpic | VisibleLineStory | VisibleLineTask;

export interface TraceWizardProps {
  onComplete: () => void;
  // Legacy props — now read from appStore. Kept optional for backwards compat.
  traceService?: import('@core/TraceTypes.js').ITraceService;
  projectId?: number;
  db?: import('@core/db/Connection.js').DrizzleDB;
  pipelineConfig?: import('@core/ConfigTypes.js').PipelineConfig;
  eventBus?: import('@core/EventBus.js').EventBus;
}

export interface TraceTreePanelProps {
  lines: VisibleLine[];
  focusedLine: number;
  showTeamOnTask?: boolean;
  height?: number;
}

export interface TraceDetailPanelProps {
  task: TaskNode;
  scrollIndex?: number;
  availableHeight?: number;
}

export interface TraceLogsPanelProps {
  logs: import('@core/TraceTypes.js').TraceTaskLog[];
  scrollIndex?: number;
  height?: number;
}

export interface TraceStatusBarProps {
  totalEpics: number;
  totalStories: number;
  totalTasks: number;
}
