import { useRef } from 'react'
import { useInput } from 'ink'

interface KeyBindingsProps {
  onLoad: () => void
  onShip: () => void
  onToggleWorkers: () => void
  onToggleTrace: () => void
  onDiagnose: () => void
  onConfig: () => void
  onHelp: () => void
  onResetStory?: () => void
  onCancelStory?: () => void
  onChat?: () => void
  onDrain?: () => void
  isPipelineRunning?: boolean
  isChatMode?: boolean
  focusModePanel: number | null
  onEnterFocusMode: () => void
  onExitFocusMode: () => void
  onQuit: () => void
  onFocusNext: () => void
  onFocusPrev: () => void
  onFocusPanel: (n: number) => void
  isActive: boolean
  isActionActive?: boolean
  onEnterTrace?: () => void
  dashboardMode?: 'overview' | 'trace'
}

/**
 * Global dashboard key bindings.
 * Handled here so they work even if a specific panel isn't focused.
 * Note: Esc is explicitly disabled per Story 16.1 requirements.
 */
export function KeyBindings({
  onLoad,
  onShip,
  onToggleWorkers,
  onToggleTrace,
  onDiagnose,
  onConfig,
  onHelp,
  onResetStory,
  onCancelStory,
  onChat,
  onDrain,
  isPipelineRunning = false,
  isChatMode = false,
  focusModePanel,
  onEnterFocusMode,
  onExitFocusMode,
  onQuit,
  onFocusNext,
  onFocusPrev,
  onFocusPanel,
  isActive,
  isActionActive = false,
  onEnterTrace,
  dashboardMode = 'overview',
}: KeyBindingsProps): null {
  const lastKeyTimeRef = useRef(0)
  const KEY_DEBOUNCE_MS = 150

  useInput(
    (input, key) => {
      // Prevent rapid double-triggering
      const now = Date.now()
      if (now - lastKeyTimeRef.current < KEY_DEBOUNCE_MS) return
      lastKeyTimeRef.current = now

      // 1. Navigation & Focus (Tab, 1-4, F)
      if (key.tab && key.shift) {
        if (!isActionActive) onFocusPrev()
      } else if (key.tab) {
        if (!isActionActive) onFocusNext()
      } else if (input >= '1' && input <= '4') {
        if (!isActionActive) onFocusPanel(parseInt(input, 10) - 1)
      } else if (input === 'f' || input === 'F') {
        if (!isActionActive) {
          if (focusModePanel !== null) {
            onExitFocusMode()
          } else {
            onEnterFocusMode()
          }
        }
      }

      // 2. Global Actions (L, S, R, T, D, C, H, E, X, A, Q)
      else if (input === 'l' || input === 'L') {
        if (!isActionActive) onLoad()
      } else if (input === 's' || input === 'S') {
        if (!isActionActive) onShip()
      } else if (input === 'r' || input === 'R') {
        // Toggle pipeline (Stop if running, Start if idle)
        if (dashboardMode !== 'trace') onToggleWorkers()
      } else if (input === 't' || input === 'T') {
        if (!isActionActive) {
          onToggleTrace()
          onEnterTrace?.()
        }
      } else if (input === 'd' || input === 'D') {
        if (!isActionActive) {
          if (isPipelineRunning) {
            onDrain?.()
          } else {
            onDiagnose()
          }
        }
      } else if (input === 'c' || input === 'C') {
        if (!isActionActive) onConfig()
      } else if (input === 'h' || input === 'H') {
        if (!isActionActive) onHelp()
      } else if (input === 'e' || input === 'E') {
        if (!isActionActive) onResetStory?.()
      } else if (input === 'x' || input === 'X') {
        if (!isActionActive) onCancelStory?.()
      } else if (input === 'a' || input === 'A') {
        if (!isActionActive) onChat?.()
      } else if (input === 'q' || input === 'Q') {
        // Q handles everything: back from action, back from submenu, or quit confirm
        // onQuit is bound to menuStack.handleQ() in DashboardApp.tsx
        onQuit()
      }

      // Note: Esc is intentionally omitted.
    },
    { isActive: isActive && !isChatMode }
  )

  return null
}
