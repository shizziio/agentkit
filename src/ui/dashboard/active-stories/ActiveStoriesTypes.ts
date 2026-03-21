import type { DrizzleDB } from '@core/db/Connection.js';
import type { EventBus } from '@core/EventBus.js';

export type ActiveStoryDisplayStatus = 'RUN' | 'QUEUE' | 'DONE' | 'FAIL' | 'WAIT';

export interface ActiveStoryEntry {
  storyId: number;
  storyKey: string;
  storyTitle: string;
  stageName: string;
  displayStatus: ActiveStoryDisplayStatus;
  firstStartedAt: number | null;
  completedAt: number | null;
  priority: number;
  dependsOn: string[];
  depStatuses: Record<string, string>;
  team?: string;
}

export interface ActiveStoriesSummary {
  doneTodayCount: number;
  failedCount: number;
  averageDurationMs: number | null;
}

export interface ActiveStoriesPanelProps {
  db: DrizzleDB;
  eventBus: EventBus;
  isFocused: boolean;
}

export interface UseActiveStoriesResult {
  entries: ActiveStoryEntry[];
  summary: ActiveStoriesSummary;
}
