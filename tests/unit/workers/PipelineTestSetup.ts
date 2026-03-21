import { vi } from 'vitest';
import type { StageConfig, PipelineConfig } from '@core/ConfigTypes';
import type { BaseProvider } from '@providers/interfaces/BaseProvider';

// Mock StageWorker
vi.mock('@workers/StageWorker.js', () => ({
  StageWorker: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({ stageName: 'mock', workerIndex: 0, status: 'stopped', currentTaskId: null, uptime: 0 }),
  })),
}));

// Mock Router
vi.mock('@workers/Router.js', () => ({
  Router: vi.fn().mockImplementation(() => ({
    routeCompletedTask: vi.fn(),
    routeRejectedTask: vi.fn().mockReturnValue('routed'),
    detectLoop: vi.fn().mockReturnValue({ isLoop: false, chainLength: 1, stageCounts: {} }),
    completeStory: vi.fn(),
  })),
}));

// Mock CompletionHandler
vi.mock('@workers/CompletionHandler.js', () => ({
  CompletionHandler: vi.fn().mockImplementation(() => ({
    handleTaskCompletion: vi.fn(),
  })),
}));

// Mock OutputFileManager
vi.mock('@workers/OutputFileManager.js', () => ({
  cleanupStaleOutputs: vi.fn(),
}));

// Mock TaskLogWriter
vi.mock('@workers/TaskLogWriter.js', () => ({
  TaskLogWriter: vi.fn().mockImplementation(() => ({
    write: vi.fn(),
    flush: vi.fn(),
    drain: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock EventBus
vi.mock('@core/EventBus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  EventBus: vi.fn(),
  default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

// Mock ProcessManager
vi.mock('@providers/agent/ProcessManager.js', () => ({
  processManager: { killAll: vi.fn() },
  ProcessManager: vi.fn(),
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

// Mock schema
vi.mock('@core/db/schema.js', () => ({
  tasks: { id: 'id', storyId: 'story_id', stageName: 'stage_name', status: 'status' },
  stories: { id: 'id', status: 'status', storyKey: 'story_key', epicId: 'epic_id' },
  epics: { id: 'id', epicKey: 'epic_key' },
}));

// Mock defaults
vi.mock('@config/defaults.js', () => ({
  DEFAULT_POLL_INTERVAL: 3000,
  MAX_POLL_INTERVAL: 30000,
  BACKOFF_MULTIPLIER: 1.5,
  MAX_CHAIN_LENGTH: 10,
}));

// Mock Errors
vi.mock('@core/Errors.js', () => ({
  AgentKitError: class AgentKitError extends Error {
    code: string;
    constructor(message: string, code: string) { super(message); this.code = code; }
  },
  QueueError: class QueueError extends Error {
    constructor(message: string) { super(message); this.name = 'QueueError'; }
  },
}));

// Mock StateManager
vi.mock('@core/StateManager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    getTaskChain: vi.fn().mockReturnValue([]),
  })),
}));

// Mock EventTypes (needed for type import, no runtime mock needed)
vi.mock('@core/EventTypes.js', () => ({}));

export function createPipelineConfig(stages: StageConfig[]): PipelineConfig {
  return {
    team: 'agentkit',
    displayName: 'Software Development Pipeline',
    provider: 'claude-cli',
    project: { name: 'test-project' },
    stages,
    models: {
      allowed: ['opus', 'sonnet', 'haiku'],
      resolved: { sm: 'sonnet', dev: 'opus', review: 'sonnet', tester: 'haiku' },
    },
  };
}

export function createMockProvider(): BaseProvider {
  return {
    name: 'mock-provider',
    type: 'agent',
    capabilities: { streaming: true, nativeToolUse: false, supportedModels: ['sonnet'] },
    execute: vi.fn().mockImplementation(async function* () { /* noop */ }),
    isAvailable: vi.fn().mockResolvedValue(true),
    validateConfig: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  };
}

export const defaultStages: StageConfig[] = [
  { name: 'sm', displayName: 'Scrum Master', icon: '📋', prompt: 'agentkit/prompts/sm.md', timeout: 300000, workers: 1, retries: 3, next: 'dev' },
  { name: 'dev', displayName: 'Developer', icon: '🔨', prompt: 'agentkit/prompts/dev.md', timeout: 300000, workers: 1, retries: 3, next: 'review' },
  { name: 'review', displayName: 'Reviewer', icon: '👁', prompt: 'agentkit/prompts/review.md', timeout: 300000, workers: 1, retries: 3, next: 'tester', reject_to: 'dev' },
  { name: 'tester', displayName: 'Tester', icon: '🧪', prompt: 'agentkit/prompts/tester.md', timeout: 300000, workers: 2, retries: 3, reject_to: 'dev' },
];

export function createMockDb() {
  const getFn = vi.fn().mockReturnValue(undefined);
  const allFn = vi.fn().mockReturnValue([]);
  const runFn = vi.fn();
  const whereFn = vi.fn().mockReturnValue({ run: runFn, get: getFn, all: allFn });
  const setFn = vi.fn().mockReturnValue({ where: whereFn });
  const updateFn = vi.fn().mockReturnValue({ set: setFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });

  return {
    update: updateFn,
    select: selectFn,
    transaction: vi.fn(),
  };
}
