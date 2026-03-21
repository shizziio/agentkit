import React, { useState, useCallback, useEffect, useLayoutEffect } from 'react'
import { Box, useApp, useStdout } from 'ink'

import { join } from 'node:path'
import { existsSync } from 'node:fs'

import type { ActionMode, DashboardProps } from './shared/DashboardTypes.js'
import { ACTION_MODES } from './shared/DashboardTypes.js'
import { AGENTKIT_DIR } from '@config/defaults.js'
import { launchInteractiveSession } from '@shared/InteractiveSession.js'
import { ReadinessChecker } from '@core/ReadinessChecker.js'
import { useDashboardStore, useAlertStore, useWorkerStore, useActivityStore, useAppStore } from '@ui/stores/index.js'
import { useStoriesStore } from '@ui/stores/storiesStore.js'
import { useMenuStack } from './hooks/useMenuStack.js'
import { useDashboardContent } from './hooks/useDashboardContent.js'
import { useLayout } from './hooks/useLayout.js'
import { KeyBindings } from './command-menu/KeyBindings.js'
import { CompactLayout } from './layouts/CompactLayout.js'
import { GridLayout } from './layouts/GridLayout.js'
import { BrandHeader } from './brand/BrandHeader.js'
import { TraceWizard } from '@ui/trace/TraceWizard.js'
import { DASHBOARD_CHROME_ROWS } from '@config/defaults.js'

function isActionMode(action: string): action is Exclude<ActionMode, 'none'> {
  return (ACTION_MODES as readonly string[]).includes(action)
}

export function DashboardApp(props: DashboardProps): React.JSX.Element {
  const {
    db,
    eventBus,
    resetService,
    markDoneService,
    onComplete,
    onToggleWorkers,
    onEnterTrace,
    onTerminateWorkers,
    onDrain,
  } = props
  const pipelineConfig = useAppStore(s => s.pipelineConfig) ?? props.pipelineConfig
  const { exit } = useApp()
  const { stdout } = useStdout()
  const { layoutMode } = useLayout()

  const dashboardMode = useDashboardStore(s => s.dashboardMode)
  const actionMode = useDashboardStore(s => s.actionMode)
  const isActionActive = useDashboardStore(s => s.actionMode !== 'none')
  const focusedPanel = useDashboardStore(s => s.focusedPanel)
  const { openAction, closeAction, toggleTrace, focusNext, focusPrev, setFocusedPanel } =
    useDashboardStore.getState()

  const pipelineState = useWorkerStore(s => s.pipelineState)
  const queueStats = useWorkerStore(s => s.queueStats())
  const isPipelineRunning = pipelineState === 'running'

  const handleActionClose = useCallback((): void => {
    closeAction()
    useStoriesStore.getState().refresh()
  }, [closeAction])

  const menuStack = useMenuStack({
    onQuit: () => openAction('quit-confirm'),
    activeAction: actionMode,
    clearActiveAction: handleActionClose,
  })

  const [focusModePanel, setFocusModePanel] = useState<number | null>(null)

  // Reset focus mode when layout changes
  useEffect(() => {
    setFocusModePanel(null)
  }, [layoutMode])

  const onEnterFocusMode = useCallback((): void => {
    setFocusModePanel(focusedPanel)
  }, [focusedPanel])

  const onExitFocusMode = useCallback((): void => {
    setFocusModePanel(null)
  }, [])

  const handleTerminateConfirm = useCallback((): void => {
    onTerminateWorkers?.()
    closeAction()
  }, [onTerminateWorkers, closeAction])

  const handleDrainConfirm = useCallback((): void => {
    onDrain?.()
    closeAction()
  }, [onDrain, closeAction])

  const handleQuit = (): void => {
    onComplete()
    exit()
  }

  const handleMenuAction = useCallback(
    (action: string): void => {
      switch (action) {
        case 'run':
        case 'run-pipeline':
          if (isPipelineRunning) {
            openAction('drain-confirm')
          } else {
            onToggleWorkers?.()
          }
          break
        case 'drain-pipeline':
          openAction('drain-confirm')
          break
        case 'stop-pipeline':
          openAction('terminate-confirm')
          break
        case 'trace':
          toggleTrace()
          onEnterTrace?.()
          break
        case 'quit':
          openAction('quit-confirm')
          break

        case 'chat':
        case 'ask-agent':
          openAction('ask-agent')
          break

        case 'create-planning':
        case 'ask-agentkit': {
          if (isPipelineRunning) {
            // Workers running — show instruction to open new terminal
            openAction(action as Exclude<ActionMode, 'none'>)
          } else {
            const provider = pipelineConfig?.provider ?? 'claude-cli'
            const projectRoot = process.cwd()
            const resolvePath = (rel: string): string => {
              const p = join(projectRoot, AGENTKIT_DIR, 'resources', rel)
              return existsSync(p) ? p : p
            }

            // Planning requires docs + team
            if (action === 'create-planning') {
              const checker = new ReadinessChecker(projectRoot)
              const readiness = checker.check()
              const teamStep = readiness.steps.find(s => s.id === 'team-config')
              if (teamStep?.status === 'missing') {
                openAction('create-planning')
                break
              }

              launchInteractiveSession({
                provider,
                systemPromptFiles: [
                  resolvePath('agents/architect.md'),
                  resolvePath('workflows/planning.md'),
                ],
              })
            } else {
              launchInteractiveSession({
                provider,
                systemPromptFiles: [
                  resolvePath('agents/agent-kit-master.md'),
                ],
              })
            }
          }
          break
        }

        default:
          if (isActionMode(action)) {
            openAction(action)
          }
      }
    },
    [onToggleWorkers, toggleTrace, openAction, isPipelineRunning]
  )

  useEffect(() => {
    useAlertStore.getState().init(eventBus)
    return () => { useAlertStore.getState().cleanup() }
  }, [eventBus])

  useEffect(() => {
    useWorkerStore.getState().init(eventBus)
    return () => { useWorkerStore.getState().cleanup() }
  }, [eventBus])

  useEffect(() => {
    useActivityStore.getState().init(eventBus)
    return () => { useActivityStore.getState().cleanup() }
  }, [eventBus])

  useLayoutEffect(() => {
    useStoriesStore.getState().init(eventBus, db, pipelineConfig.team)
    return () => { useStoriesStore.getState().cleanup() }
  }, [eventBus, db, pipelineConfig.team])

  useEffect(() => {
    resetService.startListening()
    markDoneService.startListening()
  }, [resetService, markDoneService])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { useAppStore.getState().init(props) }, [])

  // Calculate dimensions for panels
  const rows = stdout?.rows ?? 24
  const columns = stdout?.columns ?? 80
  const leftWidth = Math.floor(columns / 2)
  const availableRows = rows - DASHBOARD_CHROME_ROWS
  const halfHeight = Math.floor(availableRows / 2)

  const { tlPanelNode } = useDashboardContent({
    actionMode,
    isActionActive,
    handleActionClose,
    focusedPanel,
    onSelectAction: handleMenuAction,
    onTerminateConfirm: handleTerminateConfirm,
    onQuitConfirm: handleQuit,
    onDrainConfirm: handleDrainConfirm,
    isPipelineRunning,
    queueStats,
    menuStack,
    width: leftWidth,
    height: halfHeight,
  })

  // Trace mode: render TraceWizard full-screen
  if (dashboardMode === 'trace') {
    return (
      <Box flexDirection="column" width="100%" height="100%">
        <TraceWizard
          onComplete={toggleTrace}
        />
        <KeyBindings
          onLoad={() => undefined}
          onShip={() => undefined}
          onToggleWorkers={() => undefined}
          onToggleTrace={toggleTrace}
          onDiagnose={() => undefined}
          onConfig={() => undefined}
          onHelp={() => undefined}
          focusModePanel={null}
          onEnterFocusMode={() => undefined}
          onExitFocusMode={() => undefined}
          onQuit={menuStack.handleQ}
          onFocusNext={() => undefined}
          onFocusPrev={() => undefined}
          onFocusPanel={() => undefined}
          isActive={false}
          isActionActive={isActionActive}
          onDrain={() => undefined}
          isPipelineRunning={false}
        />
      </Box>
    )
  }

  let layoutComponent: React.JSX.Element
  if (layoutMode === 'compact') {
    layoutComponent = (
      <CompactLayout
        focusModePanel={focusModePanel}
        dimmed={false}
        tlPanelNode={tlPanelNode}
      />
    )
  } else {
    layoutComponent = (
      <GridLayout
        focusModePanel={focusModePanel}
        dimmed={false}
        tlPanelNode={tlPanelNode}
      />
    )
  }

  return (
    <Box flexDirection="column" width="100%" height={rows - 2}>
      <BrandHeader
        isActionActive={isActionActive}
      />
      {layoutComponent}
      <KeyBindings
        onLoad={() => openAction('load')}
        onShip={() => openAction('ship')}
        onToggleWorkers={() => {
          if (isPipelineRunning) {
            openAction('terminate-confirm')
          } else {
            onToggleWorkers?.()
          }
        }}
        onToggleTrace={toggleTrace}
        onDiagnose={() => openAction('diagnose')}
        onConfig={() => {
          if (!isActionActive) {
            menuStack.push('config')
          }
        }}
        onHelp={() => openAction('help')}
        onResetStory={() => openAction('reset-story')}
        onCancelStory={() => openAction('cancel-story')}
        onChat={() => handleMenuAction('ask-agent')}
        onDrain={() => openAction('drain-confirm')}
        isPipelineRunning={isPipelineRunning}
        focusModePanel={focusModePanel}
        onEnterFocusMode={onEnterFocusMode}
        onExitFocusMode={onExitFocusMode}
        onQuit={menuStack.handleQ}
        onFocusNext={focusNext}
        onFocusPrev={focusPrev}
        onFocusPanel={setFocusedPanel}
        isActive={true}
        isActionActive={isActionActive}
        onEnterTrace={onEnterTrace}
      />
    </Box>
  )
}
