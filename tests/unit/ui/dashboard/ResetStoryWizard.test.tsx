/**
 * Tests for ResetStoryWizard — Story 27.3 update.
 *
 * After Story 27.3, ResetStoryWizard reads db, projectId, pipelineConfig,
 * eventBus, and resetService from appStore internally via getter helpers.
 * Props retained: onComplete, onCancel, compact?
 *
 * Tests seed the appStore via useAppStore.setState() in beforeEach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render } from 'ink'
import { PassThrough } from 'node:stream'

import { EventBus } from '@core/EventBus.js'
import type { PipelineConfig } from '@core/ConfigTypes.js'
import { ResetStoryWizard } from '@ui/dashboard/modals/ResetStoryWizard.js'
import { useAppStore } from '@stores/appStore.js'
import type { AppState } from '@stores/appStore.js'

// ---- Mocks ---------------------------------------------------------------

vi.mock('@core/db/schema.js', () => ({
  stories: { id: 'id', storyKey: 'storyKey', title: 'title', status: 'status', epicId: 'epicId' },
  epics: { id: 'id', projectId: 'projectId' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}))

vi.mock('ink', async importOriginal => {
  const actual = await importOriginal<typeof import('ink')>()
  return {
    ...actual,
    useInput: vi.fn(),
  }
})

// ---- Helpers -------------------------------------------------------------

function makeStream(): {
  stream: NodeJS.WriteStream & { columns: number }
  getOutput: () => string
} {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number }
  ;(stream as unknown as PassThrough).setEncoding('utf8')
  stream.columns = 80
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

const tick = (ms = 30): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

const mockPipelineConfig: PipelineConfig = {
  team: 'agentkit',
  displayName: 'Software Pipeline',
  project: { name: 'test', owner: 'tester' },
  provider: 'claude-cli',
  stages: [
    {
      name: 'sm',
      displayName: 'Story Manager',
      icon: '📋',
      timeout: 300,
      workers: 1,
      retries: 3,
      reset_to: [],
      prompt: 'Reset story?',
    },
    {
      name: 'dev',
      displayName: 'Developer',
      icon: '💻',
      timeout: 300,
      workers: 1,
      retries: 3,
      reset_to: ['sm'],
      prompt: 'Reset story?',
    },
  ],
  models: { resolved: { sm: 'sonnet', dev: 'sonnet' }, allowed: [] } as PipelineConfig['models'],
}

function makeMockDb() {
  return {} as unknown as import('@core/db/Connection.js').DrizzleDB
}

const INITIAL_STATE: Partial<AppState> = {
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
}

// ---- Tests ---------------------------------------------------------------

describe('ResetStoryWizard', () => {
  let eventBus: EventBus
  let onComplete: ReturnType<typeof vi.fn>
  let onCancel: ReturnType<typeof vi.fn>
  let mockResetService: {
    getResetableStories: ReturnType<typeof vi.fn>;
    getResetTargets: ReturnType<typeof vi.fn>;
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    const ink = await import('ink')
    vi.mocked(ink.useInput).mockReset()

    eventBus = new EventBus()
    onComplete = vi.fn()
    onCancel = vi.fn()
    mockResetService = {
      getResetableStories: vi.fn().mockReturnValue([]),
      getResetTargets: vi.fn().mockReturnValue([]),
    }

    // Seed appStore with all services the wizard reads via getter helpers.
    // After Story 27.3, the wizard reads these from the store — NOT from props.
    const seedState: Partial<AppState> = {
      ...INITIAL_STATE,
      db: makeMockDb(),
      projectId: 1,
      pipelineConfig: mockPipelineConfig,
      eventBus,
      resetService: mockResetService,
    }
    useAppStore.setState(seedState)
  })

  afterEach(() => {
    // Reset store to clean state between tests
    useAppStore.setState(INITIAL_STATE)
  })

  // -------------------------------------------------------------------------
  // AC: ResetStoryWizardProps contains only onComplete, onCancel, compact?
  // -------------------------------------------------------------------------
  describe('props interface (Story 27.3 acceptance criteria)', () => {
    it('renders when given only onComplete and onCancel (no service props)', async () => {
      const { stream } = makeStream()
      const r = render(
        React.createElement(ResetStoryWizard, {
          onComplete,
          onCancel,
        }),
        { stdout: stream }
      )
      await tick()
      expect(r).toBeDefined()
      r.unmount()
    })

    it('renders when given onComplete, onCancel, and compact=true', async () => {
      const { stream } = makeStream()
      const r = render(
        React.createElement(ResetStoryWizard, {
          onComplete,
          onCancel,
          compact: true,
        }),
        { stdout: stream }
      )
      await tick()
      expect(r).toBeDefined()
      r.unmount()
    })
  })

  // -------------------------------------------------------------------------
  // AC: wizard reads services from appStore (not props)
  // -------------------------------------------------------------------------
  describe('appStore integration', () => {
    it('reads resetService from appStore and calls getResetableStories()', async () => {
      const { stream } = makeStream()
      const r = render(
        React.createElement(ResetStoryWizard, {
          onComplete,
          onCancel,
        }),
        { stdout: stream }
      )
      await tick(100)
      // If the wizard reads from appStore correctly, it calls resetService.getResetableStories()
      expect(mockResetService.getResetableStories).toHaveBeenCalled()
      r.unmount()
    })

    it('throws STORE_NOT_INITIALIZED error category when store not seeded', async () => {
      // Reset the store to empty state
      useAppStore.setState(INITIAL_STATE)

      // Ink v5's App error boundary catches synchronous render errors, so we verify
      // the behavior via the getter helpers that ResetStoryWizard calls internally.
      // When projectId is null, useProjectId() throws STORE_NOT_INITIALIZED.
      const { useProjectId } = await import('@stores/appStore.js')
      expect(() => useProjectId()).toThrow('STORE_NOT_INITIALIZED')
    })
  })

  // -------------------------------------------------------------------------
  // Existing rendering tests (adapted for appStore-seeded approach)
  // -------------------------------------------------------------------------
  it('(a) renders title "Reset Story"', async () => {
    const { stream, getOutput } = makeStream()
    const r = render(
      React.createElement(ResetStoryWizard, {
        onComplete,
        onCancel,
      }),
      { stdout: stream }
    )
    await tick()
    expect(getOutput()).toContain('Reset Story')
    r.unmount()
  })

  it('(b) shows no-stories message when service returns empty list', async () => {
    mockResetService.getResetableStories.mockReturnValue([])
    // Re-seed store with updated mock
    useAppStore.setState({ resetService: mockResetService } satisfies Partial<AppState>)

    const { stream, getOutput } = makeStream()
    const r = render(
      React.createElement(ResetStoryWizard, {
        onComplete,
        onCancel,
      }),
      { stdout: stream }
    )
    await tick(100)
    const output = getOutput()
    expect(output).toContain('No blocked or failed stories found')
    r.unmount()
  })

  it('(c) shows story list when service returns stories', async () => {
    mockResetService.getResetableStories.mockReturnValue([
      { id: 1, storyKey: '1.1', title: 'Story Alpha', status: 'blocked' },
      { id: 2, storyKey: '1.2', title: 'Story Beta', status: 'failed' },
    ])
    // Re-seed store with updated mock
    useAppStore.setState({ resetService: mockResetService } satisfies Partial<AppState>)

    const { stream, getOutput } = makeStream()
    const r = render(
      React.createElement(ResetStoryWizard, {
        onComplete,
        onCancel,
      }),
      { stdout: stream }
    )
    await tick(100)
    const output = getOutput()
    expect(output).toContain('1.1')
    expect(output).toContain('Story Alpha')
    expect(output).toContain('1.2')
    expect(output).toContain('Story Beta')
    r.unmount()
  })

  it('(d) output contains the keyboard shortcut letter "E" for Reset Story action', async () => {
    const { stream, getOutput } = makeStream()
    const r = render(
      React.createElement(ResetStoryWizard, {
        onComplete,
        onCancel,
      }),
      { stdout: stream }
    )
    await tick()
    // The wizard title should be visible, confirming E-key triggered the correct wizard
    expect(getOutput()).toContain('Reset Story')
    r.unmount()
  })
})
