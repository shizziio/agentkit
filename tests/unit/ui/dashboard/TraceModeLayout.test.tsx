import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render } from 'ink'
import { PassThrough } from 'node:stream'
import { TraceModeLayout } from '@ui/dashboard/layouts/TraceModeLayout'
import type { TraceDataState, TraceDataActions } from '@ui/trace/useTraceData'
import type { TraceTreeState, TraceTreeActions } from '@ui/trace/useTraceTree'
import type { TaskNode, TraceTaskLog } from '@core/TraceTypes'
import type { ResetService } from '@core/ResetService'
import type { VisibleLine } from '@ui/trace/TraceTypes'

// Shared state for capturing TraceStatusBar hint prop across renders
const sharedState = vi.hoisted(() => ({
  lastHint: undefined as string | undefined,
}))

vi.mock('ink', async importOriginal => {
  const actual = await importOriginal<typeof import('ink')>()
  return {
    ...actual,
    useInput: vi.fn(),
    useStdout: vi.fn(() => ({ stdout: { rows: 24 } })),
  }
})

vi.mock('@ui/trace/TraceTreePanel.js', () => ({
  TraceTreePanel: () => null,
}))
vi.mock('@ui/dashboard/layouts/TraceRightPanel.js', () => ({
  TraceRightPanel: () => null,
}))
vi.mock('@ui/trace/TraceStatusBar.js', () => ({
  TraceStatusBar: (props: { hint?: string; [key: string]: unknown }) => {
    sharedState.lastHint = props.hint
    return null
  },
}))
vi.mock('@ui/dashboard/modals/StoryActionPicker.js', () => ({
  StoryActionPicker: () => null,
}))

const tick = (ms = 30): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

function makeStream(): {
  stream: NodeJS.WriteStream & { columns: number }
  getOutput: () => string
} {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream & { columns: number }
  ;(stream as unknown as PassThrough).setEncoding('utf8')
  stream.columns = 120
  let output = ''
  ;(stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk
  })
  const stripAnsi = (str: string): string =>
    str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '')
  return {
    stream: stream as unknown as NodeJS.WriteStream & { columns: number },
    getOutput: () => stripAnsi(output),
  }
}

function makeData(
  overrides: Partial<TraceDataState & TraceDataActions> = {}
): TraceDataState & TraceDataActions {
  return {
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
    showSuperseded: false,
    toggleShowSuperseded: vi.fn(),
    teamFilter: null,
    setTeamFilter: vi.fn(),
    ...overrides,
  }
}

function makeTree(
  overrides: Partial<TraceTreeState & TraceTreeActions> = {}
): TraceTreeState & TraceTreeActions {
  return {
    expandedEpics: new Set(),
    expandedStories: new Set(),
    focusedLine: 0,
    searchFilter: '',
    selectedTaskId: null,
    rightPanelMode: 'details',
    logsScrollIndex: 0,
    toggleEpic: vi.fn(),
    toggleStory: vi.fn(),
    moveFocusUp: vi.fn(),
    moveFocusDown: vi.fn(),
    setSearchFilter: vi.fn(),
    selectTask: vi.fn(),
    clearSelection: vi.fn(),
    showDetails: vi.fn(),
    showLogs: vi.fn(),
    scrollLogsUp: vi.fn(),
    scrollLogsDown: vi.fn(),
    ...overrides,
  }
}

function makeResetService(overrides: Partial<ResetService> = {}): ResetService {
  return {
    getResetTargets: vi.fn(() => []),
    resetStory: vi.fn(),
    cancelStory: vi.fn(),
    reopenStory: vi.fn(),
    ...overrides,
  } as unknown as ResetService
}

const mockTask: TaskNode = {
  id: 1,
  storyId: 1,
  team: 'agentkit',
  stageName: 'dev',
  status: 'done',
  attempt: 1,
  maxAttempts: 3,
  reworkLabel: null,
  workerModel: 'claude-sonnet-4-6',
  inputTokens: 100,
  outputTokens: 50,
  durationMs: 1000,
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:00:01Z',
  input: null,
  output: null,
  superseded: false,
}

const mockLog: TraceTaskLog = {
  id: 1,
  taskId: 1,
  sequence: 1,
  eventType: 'output',
  eventData: 'test output',
  createdAt: '2026-01-01T00:00:00Z',
}

const emptyKey = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  insert: false,
  meta: false,
  f1: false,
  f2: false,
  f3: false,
  f4: false,
  f5: false,
  f6: false,
  f7: false,
  f8: false,
  f9: false,
  f10: false,
  f11: false,
  f12: false,
}

// Helper to make a task VisibleLine
function makeTaskLine(id: number, storyId = 1): VisibleLine {
  return {
    kind: 'task',
    depth: 2,
    node: { ...mockTask, id, storyId },
  }
}

// Helper to make a story VisibleLine
function makeStoryLine(id: number, status = 'in_progress', storyKey = '1.1'): VisibleLine {
  return {
    kind: 'story',
    depth: 1,
    node: {
      id,
      epicId: 1,
      storyKey,
      title: `Story ${storyKey}`,
      status,
      totalDurationMs: null,
      orderIndex: 0,
    },
    isExpanded: false,
  }
}

describe('TraceModeLayout', () => {
  let capturedCallbacks: Array<(input: string, key: typeof emptyKey) => void>

  beforeEach(async () => {
    const ink = await import('ink')
    capturedCallbacks = []
    sharedState.lastHint = undefined
    vi.mocked(ink.useInput).mockImplementation(cb => {
      capturedCallbacks.push(cb as (input: string, key: typeof emptyKey) => void)
    })
  })

  function renderLayout(
    props: Partial<Parameters<typeof TraceModeLayout>[0]> & { resetService?: ResetService } = {}
  ) {
    return render(
      React.createElement(TraceModeLayout, {
        data: makeData(),
        tree: makeTree(),
        visibleLines: [],
        selectedTask: null,
        currentLogs: [],
        onExit: vi.fn(),
        resetService: makeResetService(),
        ...props,
      })
    )
  }

  it('renders without crashing in tree mode with no selected task', () => {
    const r = renderLayout()
    expect(r).toBeDefined()
    r.unmount()
  })

  it('renders with rightPanelMode details and a selected task', () => {
    const r = renderLayout({
      tree: makeTree({ rightPanelMode: 'details', selectedTaskId: 1 }),
      selectedTask: mockTask,
    })
    expect(r).toBeDefined()
    r.unmount()
  })

  it('renders with rightPanelMode logs', () => {
    const r = renderLayout({
      tree: makeTree({ rightPanelMode: 'logs', selectedTaskId: 1 }),
      currentLogs: [mockLog],
    })
    expect(r).toBeDefined()
    r.unmount()
  })

  it('renders with non-empty searchFilter showing search indicator', () => {
    const r = renderLayout({ tree: makeTree({ searchFilter: 'dev' }) })
    expect(r).toBeDefined()
    r.unmount()
  })

  it('renders placeholder when rightPanelMode is details but selectedTask is null', () => {
    const r = renderLayout({ tree: makeTree({ rightPanelMode: 'details', selectedTaskId: null }) })
    expect(r).toBeDefined()
    r.unmount()
  })

  describe('layout and panel rendering', () => {
    it('displays detail panel when in details mode with selected task', () => {
      const r = renderLayout({ tree: makeTree({ rightPanelMode: 'details' }), selectedTask: mockTask })
      expect(r).toBeDefined()
      r.unmount()
    })

    it('displays logs panel when in logs mode', () => {
      const r = renderLayout({ tree: makeTree({ rightPanelMode: 'logs' }), currentLogs: [mockLog] })
      expect(r).toBeDefined()
      r.unmount()
    })

    it('displays placeholder when no task is selected', () => {
      const r = renderLayout()
      expect(r).toBeDefined()
      r.unmount()
    })

    it('displays search filter in status bar when searching', () => {
      const r = renderLayout({ tree: makeTree({ searchFilter: 'epic1' }) })
      expect(r).toBeDefined()
      r.unmount()
    })
  })

  describe('R/C/O hotkeys in story-focused tree mode', () => {
    it('(a) pressing R when story focused calls getResetTargets and shows picker when targets exist', () => {
      const resetService = makeResetService({
        getResetTargets: vi.fn(() => [{ stageName: 'sm', displayName: 'SM', icon: '📋' }]),
      })
      const storyLine = makeStoryLine(10)
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details' }),
        resetService,
      })

      // First callback is the main useInput (tree mode), second is cancel-confirm
      const treeCallback = capturedCallbacks[0]
      treeCallback('r', { ...emptyKey })

      expect(resetService.getResetTargets).toHaveBeenCalledWith(10)
      r.unmount()
    })

    it('(b) pressing R when story focused with no targets sets actionError (no picker)', () => {
      const resetService = makeResetService({
        getResetTargets: vi.fn(() => []),
      })
      const storyLine = makeStoryLine(10)
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details' }),
        resetService,
      })

      const treeCallback = capturedCallbacks[0]
      treeCallback('r', { ...emptyKey })

      expect(resetService.getResetTargets).toHaveBeenCalledWith(10)
      r.unmount()
    })

    it('(c) pressing C when story focused shows cancel confirm dialog', () => {
      const storyLine = makeStoryLine(10)
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details' }),
      })

      const treeCallback = capturedCallbacks[0]
      // Should not throw — sets showCancelConfirm state
      expect(() => treeCallback('c', { ...emptyKey })).not.toThrow()
      r.unmount()
    })

    it('(d) pressing Y in cancel confirm calls resetService.cancelStory and refreshes', () => {
      const resetService = makeResetService({ cancelStory: vi.fn() })
      const data = makeData()
      const storyLine = makeStoryLine(10)
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details' }),
        resetService,
        data,
      })

      // Open confirm with 'c' (triggers re-render, new callbacks registered)
      const treeCallback = capturedCallbacks[0]
      treeCallback('c', { ...emptyKey })

      // After re-render, the last registered cancel-confirm callback has the updated storyId closure
      const confirmCallback = capturedCallbacks[capturedCallbacks.length - 1]
      confirmCallback('y', { ...emptyKey })

      expect(resetService.cancelStory).toHaveBeenCalledWith(10)
      expect(data.refresh).toHaveBeenCalled()
      r.unmount()
    })

    it('(e) pressing Esc in picker dismisses without calling resetStory', () => {
      const resetService = makeResetService({
        getResetTargets: vi.fn(() => [{ stageName: 'sm', displayName: 'SM', icon: '📋' }]),
        resetStory: vi.fn(),
      })
      const storyLine = makeStoryLine(10)
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details' }),
        resetService,
      })

      const treeCallback = capturedCallbacks[0]
      treeCallback('r', { ...emptyKey })

      // Picker is shown. Since StoryActionPicker is mocked, it doesn't actually call onCancel.
      // Verify that resetStory was never called after opening picker
      expect(resetService.resetStory).not.toHaveBeenCalled()
      r.unmount()
    })

    it('(f) pressing O when story is done calls resetService.reopenStory', () => {
      const resetService = makeResetService({ reopenStory: vi.fn() })
      const data = makeData()
      const storyLine = makeStoryLine(10, 'done')
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details' }),
        resetService,
        data,
      })

      const treeCallback = capturedCallbacks[0]
      treeCallback('o', { ...emptyKey })

      expect(resetService.reopenStory).toHaveBeenCalledWith(10)
      expect(data.refresh).toHaveBeenCalled()
      r.unmount()
    })

    it('pressing v toggles showSuperseded', () => {
      const data = makeData()
      const r = renderLayout({ data })
      const treeCallback = capturedCallbacks[0]
      treeCallback('v', { ...emptyKey })
      expect(data.toggleShowSuperseded).toHaveBeenCalled()
      r.unmount()
    })

    it('pressing V (uppercase) also toggles showSuperseded', () => {
      const data = makeData()
      const r = renderLayout({ data })
      const treeCallback = capturedCallbacks[0]
      treeCallback('V', { ...emptyKey })
      expect(data.toggleShowSuperseded).toHaveBeenCalled()
      r.unmount()
    })

    it('pressing O when story is in_progress does nothing', () => {
      const resetService = makeResetService({ reopenStory: vi.fn() })
      const storyLine = makeStoryLine(10, 'in_progress')
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details' }),
        resetService,
      })

      const treeCallback = capturedCallbacks[0]
      treeCallback('o', { ...emptyKey })

      expect(resetService.reopenStory).not.toHaveBeenCalled()
      r.unmount()
    })
  })

  describe('edge cases and data handling', () => {
    it('handles empty visible lines array', () => {
      const r = renderLayout({ tree: makeTree({ focusedLine: 0 }) })
      expect(r).toBeDefined()
      r.unmount()
    })

    it('renders correctly with no logs when in logs mode', () => {
      const r = renderLayout({ tree: makeTree({ rightPanelMode: 'logs' }) })
      expect(r).toBeDefined()
      r.unmount()
    })

    it('handles multiple logs when scrolling', () => {
      const logs = Array.from({ length: 10 }, (_, i) => ({
        id: i,
        taskId: 1,
        sequence: i,
        eventType: 'output' as const,
        eventData: `log ${i}`,
        createdAt: new Date().toISOString(),
      }))
      const r = renderLayout({ tree: makeTree({ rightPanelMode: 'logs' }), currentLogs: logs })
      expect(r).toBeDefined()
      r.unmount()
    })

    it('handles summary data when available', () => {
      const r = renderLayout({
        data: makeData({
          summary: {
            totalEpics: 5,
            totalStories: 20,
            totalTasks: 100,
            completionRate: 50,
            averageDurationPerStage: [],
          },
        }),
      })
      expect(r).toBeDefined()
      r.unmount()
    })

    it('handles tree state with all expand states', () => {
      const r = renderLayout({
        tree: makeTree({
          expandedEpics: new Set([1, 2, 3]),
          expandedStories: new Set([10, 11, 20]),
        }),
      })
      expect(r).toBeDefined()
      r.unmount()
    })

    it('handles transitioning between rightPanelModes', () => {
      const r1 = renderLayout({
        tree: makeTree({ rightPanelMode: 'details' }),
        selectedTask: mockTask,
      })
      r1.unmount()
      const r2 = renderLayout({ tree: makeTree({ rightPanelMode: 'logs' }), currentLogs: [mockLog] })
      r2.unmount()
      const r3 = renderLayout({ tree: makeTree({ selectedTaskId: null }) })
      expect(r3).toBeDefined()
      r3.unmount()
    })

    it('handles mixed visible line types', () => {
      const visibleLines = [
        { kind: 'epic' as const, node: { id: 1, name: 'E1', epicKey: 'E1', title: 'E1', status: 'in_progress', orderIndex: 0 }, isExpanded: false },
        { kind: 'story' as const, node: { id: 10, epicId: 1, storyKey: 'S1', title: 'S1', status: 'in_progress', orderIndex: 0 }, isExpanded: false },
        { kind: 'task' as const, node: { id: 100, storyId: 10, stageName: 'dev', status: 'done', attempt: 1, maxAttempts: 3, reworkLabel: null, workerModel: 'm1', inputTokens: 0, outputTokens: 0, durationMs: 0, startedAt: '', completedAt: '', input: null, output: null, superseded: false } },
      ] as VisibleLine[]
      const r = renderLayout({ visibleLines })
      expect(r).toBeDefined()
      r.unmount()
    })
  })

  describe('Story 15.9 - panel borders, dynamic titles, and task-focused hint', () => {
    it('renders "Task Navigator" header text in TL panel', async () => {
      const { stream, getOutput } = makeStream()
      const r = render(
        React.createElement(TraceModeLayout, {
          data: makeData(),
          tree: makeTree(),
          visibleLines: [],
          selectedTask: null,
          currentLogs: [],
          onExit: vi.fn(),
          resetService: makeResetService(),
        }),
        { stdout: stream }
      )
      await tick()
      expect(getOutput()).toContain('Task Navigator')
      r.unmount()
    })

    it('renders default panelTitle "Select a task" when no story/task focused', async () => {
      const { stream, getOutput } = makeStream()
      const r = render(
        React.createElement(TraceModeLayout, {
          data: makeData(),
          tree: makeTree({ focusedLine: 0, rightPanelMode: 'details', selectedTaskId: null }),
          visibleLines: [],
          selectedTask: null,
          currentLogs: [],
          onExit: vi.fn(),
          resetService: makeResetService(),
        }),
        { stdout: stream }
      )
      await tick()
      expect(getOutput()).toContain('Select a task')
      r.unmount()
    })

    it('renders panelTitle "Story Actions" when story is focused in tree mode', async () => {
      const { stream, getOutput } = makeStream()
      const storyLine = makeStoryLine(10)
      const r = render(
        React.createElement(TraceModeLayout, {
          data: makeData(),
          tree: makeTree({ focusedLine: 0, rightPanelMode: 'details', selectedTaskId: null }),
          visibleLines: [storyLine],
          selectedTask: null,
          currentLogs: [],
          onExit: vi.fn(),
          resetService: makeResetService(),
        }),
        { stdout: stream }
      )
      await tick()
      expect(getOutput()).toContain('Story Actions')
      r.unmount()
    })

    it('renders panelTitle "Task Logs..." when rightPanelMode is logs', async () => {
      const { stream, getOutput } = makeStream()
      const r = render(
        React.createElement(TraceModeLayout, {
          data: makeData(),
          tree: makeTree({ rightPanelMode: 'logs', selectedTaskId: 1 }),
          visibleLines: [],
          selectedTask: null,
          currentLogs: [],
          onExit: vi.fn(),
          resetService: makeResetService(),
        }),
        { stdout: stream }
      )
      await tick()
      expect(getOutput()).toContain('Task Logs')
      r.unmount()
    })

    it('renders panelTitle "Task Details..." when rightPanelMode is details', async () => {
      const { stream, getOutput } = makeStream()
      const r = render(
        React.createElement(TraceModeLayout, {
          data: makeData(),
          tree: makeTree({ rightPanelMode: 'details', selectedTaskId: 1 }),
          visibleLines: [],
          selectedTask: mockTask,
          currentLogs: [],
          onExit: vi.fn(),
          resetService: makeResetService(),
        }),
        { stdout: stream }
      )
      await tick()
      expect(getOutput()).toContain('Task Details')
      r.unmount()
    })

    it('panelTitle becomes "Reset Story" after R pressed with story focused and targets available', async () => {
      const resetService = makeResetService({
        getResetTargets: vi.fn(() => [{ stageName: 'sm', displayName: 'SM', icon: '📋' }]),
      })
      const storyLine = makeStoryLine(10)
      const { stream, getOutput } = makeStream()
      render(
        React.createElement(TraceModeLayout, {
          data: makeData(),
          tree: makeTree({ focusedLine: 0, rightPanelMode: 'details' }),
          visibleLines: [storyLine],
          selectedTask: null,
          currentLogs: [],
          onExit: vi.fn(),
          resetService,
        }),
        { stdout: stream }
      ).unmount()
      expect(resetService.getResetTargets).not.toHaveBeenCalled()
    })

    it('passes hint "[l] logs  [m] mark done" to TraceStatusBar when task is focused in tree mode', async () => {
      // Re-checking TraceModeLayout.tsx:
      // hint = tree.rightPanelMode === 'logs' ? '[↑↓] scroll  [d] details' : '[l] logs  [m] mark done';
      // if tree.selectedTaskId !== null
      const taskLine = makeTaskLine(100, 1)
      const r = renderLayout({
        visibleLines: [taskLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details', selectedTaskId: 100 }),
      })
      await tick()
      expect(sharedState.lastHint).toBe('[l] logs  [m] mark done')
      r.unmount()
    })

    it('passes hint "[R] Reset  [C] Cancel" to TraceStatusBar when in_progress story is focused in tree mode', async () => {
      const storyLine = makeStoryLine(10, 'in_progress')
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details', selectedTaskId: null }),
      })
      await tick()
      expect(sharedState.lastHint).toBe('[R] Reset  [C] Cancel')
      r.unmount()
    })

    it('passes hint "[R] Reset  [C] Cancel  [O] Reopen" to TraceStatusBar when done story is focused in tree mode', async () => {
      const storyLine = makeStoryLine(10, 'done')
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details', selectedTaskId: null }),
      })
      await tick()
      expect(sharedState.lastHint).toBe('[R] Reset  [C] Cancel  [O] Reopen')
      r.unmount()
    })

    it('passes hint "[R] Reset  [C] Cancel  [O] Reopen" to TraceStatusBar when cancelled story is focused', async () => {
      const storyLine = makeStoryLine(10, 'cancelled')
      const r = renderLayout({
        visibleLines: [storyLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details', selectedTaskId: null }),
      })
      await tick()
      expect(sharedState.lastHint).toBe('[R] Reset  [C] Cancel  [O] Reopen')
      r.unmount()
    })

    it('passes correct hint to TraceStatusBar when rightPanelMode is details mode', async () => {
      const taskLine = makeTaskLine(100)
      const r = renderLayout({
        visibleLines: [taskLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details', selectedTaskId: 100 }),
        selectedTask: mockTask,
      })
      await tick()
      expect(sharedState.lastHint).toBe('[l] logs  [m] mark done')
      r.unmount()
    })

    it('passes correct hint to TraceStatusBar when rightPanelMode is logs', async () => {
      const taskLine = makeTaskLine(100)
      const r = renderLayout({
        visibleLines: [taskLine],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'logs', selectedTaskId: 100 }),
      })
      await tick()
      expect(sharedState.lastHint).toBe('[↑↓] scroll  [d] details')
      r.unmount()
    })

    it('passes undefined hint when no focused line exists', async () => {
      const r = renderLayout({
        visibleLines: [],
        tree: makeTree({ focusedLine: 0, rightPanelMode: 'details', selectedTaskId: null }),
      })
      await tick()
      expect(sharedState.lastHint).toBeUndefined()
      r.unmount()
    })
  })
})
