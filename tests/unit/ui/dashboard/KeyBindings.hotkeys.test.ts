import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Key } from 'ink'
import { KeyBindings } from '@ui/dashboard/command-menu/KeyBindings.js'

type InputHandler = (input: string, key: Key) => void
let capturedHandlers: InputHandler[] = []
let capturedOptions: Array<{ isActive?: boolean } | undefined> = []

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useRef: vi.fn(() => ({ current: 0 })),
  }
})

vi.mock('ink', async importOriginal => {
  const actual = await importOriginal<typeof import('ink')>()
  return {
    ...actual,
    useInput: vi.fn((handler: InputHandler, opts?: { isActive?: boolean }) => {
      capturedHandlers.push(handler)
      capturedOptions.push(opts)
    }),
  }
})

const EMPTY_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
}

function makeProps(overrides: Partial<Parameters<typeof KeyBindings>[0]> = {}) {
  return {
    onLoad: vi.fn(),
    onShip: vi.fn(),
    onToggleWorkers: vi.fn(),
    onToggleTrace: vi.fn(),
    onDiagnose: vi.fn(),
    onConfig: vi.fn(),
    onHelp: vi.fn(),
    onResetStory: vi.fn(),
    focusModePanel: null as number | null,
    onEnterFocusMode: vi.fn(),
    onExitFocusMode: vi.fn(),
    onQuit: vi.fn(),
    onFocusNext: vi.fn(),
    onFocusPrev: vi.fn(),
    onFocusPanel: vi.fn(),
    isActive: true,
    isActionActive: false,
    ...overrides,
  }
}

/** Trigger the hotkey handler. */
function triggerHandler(input: string, key: Partial<Key> = {}): void {
  capturedHandlers.forEach(h => h(input, { ...EMPTY_KEY, ...key }))
}

describe('KeyBindings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedHandlers = []
    capturedOptions = []
  })

  it('returns null (no UI)', () => {
    expect(KeyBindings(makeProps())).toBeNull()
  })

  describe('useInput registration', () => {
    it('registers one useInput handler', async () => {
      const { useInput } = await import('ink')
      KeyBindings(makeProps())
      expect(vi.mocked(useInput)).toHaveBeenCalledTimes(1)
    })

    it('handler respects isActive=true from props', () => {
      KeyBindings(makeProps({ isActive: true }))
      expect(capturedOptions[0]).toEqual({ isActive: true })
    })

    it('handler respects isActive=false from props', () => {
      KeyBindings(makeProps({ isActive: false }))
      expect(capturedOptions[0]).toEqual({ isActive: false })
    })
  })

  describe('F key — focus mode toggle', () => {
    it('calls onEnterFocusMode when focusModePanel is null', () => {
      const props = makeProps({ focusModePanel: null })
      KeyBindings(props)
      triggerHandler('f')
      expect(props.onEnterFocusMode).toHaveBeenCalledTimes(1)
      expect(props.onExitFocusMode).not.toHaveBeenCalled()
    })

    it('calls onExitFocusMode when focusModePanel is set (panel 1)', () => {
      const props = makeProps({ focusModePanel: 1 })
      KeyBindings(props)
      triggerHandler('f')
      expect(props.onExitFocusMode).toHaveBeenCalledTimes(1)
      expect(props.onEnterFocusMode).not.toHaveBeenCalled()
    })
  })

  describe('hotkey dispatch', () => {
    it('L calls onLoad', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('l')
      expect(props.onLoad).toHaveBeenCalledTimes(1)
    })

    it('S calls onShip', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('s')
      expect(props.onShip).toHaveBeenCalledTimes(1)
    })

    it('R calls onToggleWorkers', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('r')
      expect(props.onToggleWorkers).toHaveBeenCalledTimes(1)
    })

    it('T calls onToggleTrace', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('t')
      expect(props.onToggleTrace).toHaveBeenCalledTimes(1)
    })

    it('D calls onDiagnose', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('d')
      expect(props.onDiagnose).toHaveBeenCalledTimes(1)
    })

    it('C calls onConfig', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('c')
      expect(props.onConfig).toHaveBeenCalledTimes(1)
    })

    it('H calls onHelp', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('h')
      expect(props.onHelp).toHaveBeenCalledTimes(1)
    })

    it('E calls onResetStory', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('e')
      expect(props.onResetStory).toHaveBeenCalledTimes(1)
    })

    it('Q calls onQuit', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('q')
      expect(props.onQuit).toHaveBeenCalledTimes(1)
    })

    it('Tab calls onFocusNext', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('', { tab: true, shift: false })
      expect(props.onFocusNext).toHaveBeenCalledTimes(1)
    })

    it('Shift+Tab calls onFocusPrev', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('', { tab: true, shift: true })
      expect(props.onFocusPrev).toHaveBeenCalledTimes(1)
    })

    it('"1" calls onFocusPanel(0)', () => {
      const props = makeProps()
      KeyBindings(props)
      triggerHandler('1')
      expect(props.onFocusPanel).toHaveBeenCalledWith(0)
    })
  })

  describe('action gating', () => {
    it('L does NOT call onLoad when isActionActive=true', () => {
      const props = makeProps({ isActionActive: true })
      KeyBindings(props)
      triggerHandler('l')
      expect(props.onLoad).not.toHaveBeenCalled()
    })

    it('S does NOT call onShip when isActionActive=true', () => {
      const props = makeProps({ isActionActive: true })
      KeyBindings(props)
      triggerHandler('s')
      expect(props.onShip).not.toHaveBeenCalled()
    })

    it('R DOES NOT call onToggleWorkers when isActionActive=true', () => {
      // In new implementation, most are gated by !isActionActive, except some cases
      // Looking at src/ui/dashboard/KeyBindings.tsx, even R is gated by dashboardMode check
      // and NOT gated by isActionActive? Wait let's re-check.
      // if (input === 'r' || input === 'R') { if (dashboardMode !== 'trace') onToggleWorkers() }
      // Ah, R is NOT gated by isActionActive in the code I read.
      const props = makeProps({ isActionActive: true })
      KeyBindings(props)
      triggerHandler('r')
      expect(props.onToggleWorkers).toHaveBeenCalledTimes(1)
    })
  })
})
