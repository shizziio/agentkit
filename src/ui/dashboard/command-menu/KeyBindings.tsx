import { useRef } from 'react'
import { useInput } from 'ink'

import { useDashboardStore } from '@ui/stores/dashboardStore.js'
import { useWorkerStore } from '@ui/stores/workerStore.js'
import { useAppStore } from '@ui/stores/appStore.js'
import { useMenuStore } from '@ui/stores/menuStore.js'
import { handleMenuAction } from '@ui/stores/menuActions.js'

/**
 * Global dashboard key bindings.
 * ZERO props — reads everything from stores via getState() at keypress time.
 * Renders exactly once and never re-renders.
 */
export function KeyBindings(): null {
  const lastKeyTimeRef = useRef(0)
  const KEY_DEBOUNCE_MS = 150

  useInput(
    (input, key) => {
      const now = Date.now()
      if (now - lastKeyTimeRef.current < KEY_DEBOUNCE_MS) return
      lastKeyTimeRef.current = now

      // Read state synchronously from stores — no subscriptions, no re-renders
      const ds = useDashboardStore.getState()
      const ws = useWorkerStore.getState()
      const app = useAppStore.getState()
      const menu = useMenuStore.getState()

      const isActionActive = ds.actionMode !== 'none'
      const isPipelineRunning = ws.pipelineState === 'running'
      const isTraceMode = ds.dashboardMode === 'trace'

      // 1. Navigation & Focus (Tab, 1-4, F)
      if (key.tab && key.shift) {
        if (!isActionActive) ds.focusPrev()
      } else if (key.tab) {
        if (!isActionActive) ds.focusNext()
      } else if (input >= '1' && input <= '4') {
        if (!isActionActive) ds.setFocusedPanel(parseInt(input, 10) - 1)
      } else if (input === 'f' || input === 'F') {
        if (!isActionActive) {
          if (ds.focusModePanel !== null) ds.exitFocusMode()
          else ds.enterFocusMode()
        }
      }

      // 2. Global Actions
      else if (input === 'l' || input === 'L') {
        if (!isActionActive) ds.openAction('load')
      } else if (input === 's' || input === 'S') {
        if (!isActionActive) ds.openAction('ship')
      } else if (input === 'r' || input === 'R') {
        if (!isTraceMode) {
          if (isPipelineRunning) ds.openAction('terminate-confirm')
          else app.onToggleWorkers?.()
        }
      } else if (input === 't' || input === 'T') {
        if (!isActionActive) {
          ds.toggleTrace()
          app.onEnterTrace?.()
        }
      } else if (input === 'd' || input === 'D') {
        if (!isActionActive) {
          if (isPipelineRunning) ds.openAction('drain-confirm')
          else ds.openAction('diagnose')
        }
      } else if (input === 'c' || input === 'C') {
        if (!isActionActive) handleMenuAction('config')
      } else if (input === 'h' || input === 'H') {
        if (!isActionActive) ds.openAction('help')
      } else if (input === 'e' || input === 'E') {
        if (!isActionActive) ds.openAction('reset-story')
      } else if (input === 'x' || input === 'X') {
        if (!isActionActive) ds.openAction('cancel-story')
      } else if (input === 'a' || input === 'A') {
        if (!isActionActive) handleMenuAction('ask-agent')
      } else if (input === 'q' || input === 'Q') {
        menu.handleQ()
      }
    },
    { isActive: true }
  )

  return null
}
