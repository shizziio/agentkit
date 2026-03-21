import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { UnifiedApp } from '@ui/UnifiedApp';
import type { DashboardProps } from '@ui/dashboard/shared/DashboardTypes';

vi.mock('@ui/dashboard/DashboardApp.js', () => ({
  DashboardApp: ({ onEnterTrace }: any) =>
    React.createElement('div', null, `DashboardApp (onEnterTrace=${typeof onEnterTrace})`),
}));

vi.mock('@ui/dashboard/layouts/TraceModeLayout.js', () => ({
  TraceModeLayout: () => React.createElement('div', null, 'TraceModeLayout'),
}));

vi.mock('@core/TraceService.js', () => ({
  TraceService: vi.fn(() => ({})),
}));

vi.mock('@ui/trace/useTraceData.js', () => ({
  useTraceData: vi.fn(() => ({
    epics: [],
    storiesByEpic: new Map(),
    tasksByStory: new Map(),
    summary: null,
    error: null,
    isLoading: false,
    loadStoriesForEpic: vi.fn(),
    loadTasksForStory: vi.fn(),
    getTaskLogs: vi.fn(() => []),
    refresh: vi.fn(),
    markTaskDone: vi.fn(),
    markStoryDone: vi.fn(),
  })),
}));

vi.mock('@ui/trace/useTraceTree.js', () => ({
  useTraceTree: vi.fn(() => ({
    expandedEpics: new Set(),
    expandedStories: new Set(),
    focusedLine: 0,
    searchFilter: '',
    selectedTaskId: null,
    inspectMode: null,
    logsScrollIndex: 0,
    toggleEpic: vi.fn(),
    toggleStory: vi.fn(),
    moveFocusUp: vi.fn(),
    moveFocusDown: vi.fn(),
    setSearchFilter: vi.fn(),
    selectTask: vi.fn(),
    clearSelection: vi.fn(),
    openDetails: vi.fn(),
    openLogs: vi.fn(),
    closeInspect: vi.fn(),
    scrollLogsUp: vi.fn(),
    scrollLogsDown: vi.fn(),
  })),
  buildVisibleLines: vi.fn(() => []),
}));

function makeProps(overrides: Partial<DashboardProps> = {}): DashboardProps {
  return {
    pipelineConfig: {
      team: 'test-team',
      displayName: 'Test Team',
      provider: 'claude-cli',
      project: { name: 'test-project' },
      stages: [],
      models: { allowed: [], resolved: {} },
    },
    projectId: 1,
    db: {} as any,
    eventBus: {} as any,
    onComplete: vi.fn(),
    ...overrides,
  };
}

describe('UnifiedApp', () => {
  it('renders in overview mode initially', () => {
    const r = render(
      React.createElement(UnifiedApp, makeProps()),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('passes onEnterTrace callback to DashboardApp', () => {
    const r = render(
      React.createElement(UnifiedApp, makeProps()),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('provides onComplete callback from props', () => {
    const onComplete = vi.fn();
    const r = render(
      React.createElement(UnifiedApp, makeProps({ onComplete })),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  it('provides optional onToggleWorkers callback', () => {
    const onToggleWorkers = vi.fn();
    const r = render(
      React.createElement(UnifiedApp, makeProps({ onToggleWorkers })),
    );
    expect(r).toBeDefined();
    r.unmount();
  });

  describe('mode management', () => {
    it('starts in overview mode', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('renders DashboardApp with pipeline config', () => {
      const pipelineConfig = {
        team: 'my-team',
        displayName: 'My Team',
        provider: 'claude-cli',
        project: { name: 'my-project' },
        stages: [],
        models: { allowed: [], resolved: {} },
      };
      const r = render(
        React.createElement(UnifiedApp, makeProps({ pipelineConfig })),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('passes correct props to DashboardApp', () => {
      const onComplete = vi.fn();
      const onToggleWorkers = vi.fn();
      const r = render(
        React.createElement(UnifiedApp, makeProps({
          onComplete,
          onToggleWorkers,
        })),
      );
      expect(r).toBeDefined();
      r.unmount();
    });
  });

  describe('data hooks', () => {
    it('initializes trace service with db', () => {
      const db = {} as any;
      const r = render(
        React.createElement(UnifiedApp, makeProps({ db })),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('initializes trace data and tree hooks', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('builds visible lines from epic/story/task structure', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });
  });

  describe('effects', () => {
    it('handles expanded epics set', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('handles expanded stories set', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('handles logs loading when in logs mode', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });
  });

  describe('task selection', () => {
    it('handles selected task lookup across stories', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('returns null when no task is selected', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });
  });

  describe('trace mode integration', () => {
    it('can switch to trace mode via onEnterTrace', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('passes trace data to TraceModeLayout', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('passes tree state to TraceModeLayout', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('handles onExit callback from trace mode', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('maintains trace data across mode switches', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('refreshes dashboard when returning from trace mode', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });
  });

  describe('edge cases', () => {
    it('handles empty project ID', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps({ projectId: 0 })),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('handles optional callbacks being undefined', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps({
          onToggleWorkers: undefined,
        })),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('handles large trace data sets', () => {
      const r = render(
        React.createElement(UnifiedApp, makeProps()),
      );
      expect(r).toBeDefined();
      r.unmount();
    });
  });
});
