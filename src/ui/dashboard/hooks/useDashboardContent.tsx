import React from 'react'
import { Box, Text } from 'ink'

import { LoadWizard } from '@ui/load/LoadWizard.js'
import { CustomRulesPanel } from '@ui/rules/CustomRulesPanel.js'

import { ShipWizard } from '@ui/ship/ShipWizard.js'
import { DiagnoseWizard } from '@ui/diagnose/DiagnoseWizard.js'
import { MarkDoneWizard } from '@ui/mark-done/MarkDoneWizard.js'
import { HistoryWizard } from '@ui/history/HistoryWizard.js'
import { ReplayPicker } from '@ui/replay/ReplayPicker.js'
import { SwitchTeamWizard } from '@ui/config/SwitchTeamWizard.js'
import { ModelConfigWizard } from '@ui/config/ModelConfigWizard.js'
import { ConfigViewer } from '@ui/config/ConfigViewer.js'

import { SwitchProviderWizard } from '@ui/config/SwitchProviderWizard.js'
import { ResetStoryWizard } from '../modals/ResetStoryWizard.js'
import { CancelStoryWizard } from '../modals/CancelStoryWizard.js'

import type { ActionMode } from '../shared/DashboardTypes.js'
import { ActionPanel } from '../command-menu/ActionPanel.js'
import { HelpModal } from '../modals/HelpModal.js'
import { CommandMenuPanel } from '../command-menu/CommandMenuPanel.js'
import { TerminateConfirmPanel } from '../modals/TerminateConfirmPanel.js'
import { QuitConfirmPanel } from '../modals/QuitConfirmPanel.js'
import { DrainConfirmPanel } from '../modals/DrainConfirmPanel.js'

import { ConfigWizard } from '@ui/config/ConfigWizard.js'
import { useAppStore } from '@ui/stores/appStore.js'
import type { ProjectConfig } from '@core/ConfigTypes.js'

import type { UseMenuStack } from './useMenuStack.js'
import type { QueueStats } from '@ui/stores/workerStore.js'

interface UseDashboardContentParams {
  actionMode: ActionMode
  isActionActive: boolean
  handleActionClose: () => void
  focusedPanel: number
  onSelectAction: (action: string) => void
  onTerminateConfirm?: () => void
  onQuitConfirm?: () => void
  onDrainConfirm?: () => void
  isPipelineRunning?: boolean
  queueStats?: QueueStats | null
  menuStack: UseMenuStack
  width?: number
  height?: number
}

interface UseDashboardContentResult {
  tlPanelNode: React.JSX.Element
}

function buildActiveContent(
  mode: Exclude<ActionMode, 'none'>,
  params: UseDashboardContentParams,
  // appStore is write-once (initialized at mount before any wizard renders),
  // so synchronous getState() reads here are safe even though buildActiveContent
  // is called outside a React memoization context.
  projectConfig: ProjectConfig
): React.JSX.Element | null {
  const { handleActionClose } = params
  // Obtain services from appStore — safe because appStore is initialized before
  // any wizard renders and is write-once for the lifetime of the dashboard.
  const { configService, teamSwitchService, pipelineConfig } = useAppStore.getState()

  switch (mode) {
    case 'load':
      return (
        <LoadWizard
          isSimple={false}
          onComplete={handleActionClose}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    case 'ship':
      return (
        <ShipWizard
          onComplete={handleActionClose}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    case 'diagnose':
      return (
        <DiagnoseWizard
          onComplete={handleActionClose}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    case 'config':
      if (pipelineConfig === null || configService === null || teamSwitchService === null) {
        return null;
      }
      return (
        <ConfigWizard
          pipeline={pipelineConfig}
          projectConfig={projectConfig}
          configService={configService}
          teamSwitchService={teamSwitchService}
          onSave={async (models: Record<string, string>) => {
            await configService.saveModelAssignments(models)
          }}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    case 'view-config':
      return (
        <ConfigViewer
          projectConfig={projectConfig}
          onBack={handleActionClose}
        />
      )
    case 'change-models':
      return (
        <ModelConfigWizard
          onSave={async (models: Record<string, string>) => {
            if (configService !== null) {
              await configService.saveModelAssignments(models)
            }
          }}
          onComplete={handleActionClose}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    case 'change-provider':
      return (
        <SwitchProviderWizard
          activeProvider={pipelineConfig?.provider ?? ''}
          onComplete={handleActionClose}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    case 'help':
      return <HelpModal onClose={handleActionClose} compact={true} />
    case 'mark-done':
      return (
        <MarkDoneWizard
          onComplete={handleActionClose}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    case 'history':
      return (
        <HistoryWizard
          filter={{}}
          onExit={handleActionClose}
          compact={true}
        />
      )
    case 'replay':
      return <ReplayPicker onQuit={handleActionClose} />
    case 'switch-team':
    case 'change-team': {
      let mergedTeams: string[]
      let projectTeams: string[]
      let activeTeam: string
      let loadError: string | null
      try {
        const bundledTeams = configService !== null ? configService.listBundledTeams() : []
        projectTeams = projectConfig.teams
        const merged = Array.from(new Set([...projectTeams, ...bundledTeams])).sort((a, b) => a.localeCompare(b))
        mergedTeams = merged
        activeTeam = projectConfig.activeTeam
        loadError = null
      } catch (err: unknown) {
        mergedTeams = []
        projectTeams = []
        activeTeam = ''
        loadError = err instanceof Error ? err.message : String(err)
      }
      return (
        <SwitchTeamWizard
          mergedTeams={mergedTeams}
          projectTeams={projectTeams}
          activeTeam={activeTeam}
          loadError={loadError}
          onSwitch={(teamName) => teamSwitchService !== null ? teamSwitchService.switchTeam(teamName) : Promise.resolve()}
          onComplete={handleActionClose}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    }
    case 'terminate-confirm':
      return (
        <TerminateConfirmPanel
          onConfirm={params.onTerminateConfirm ?? (() => undefined)}
          onCancel={params.handleActionClose}
        />
      )
    case 'quit-confirm':
      return (
        <QuitConfirmPanel
          onConfirm={params.onQuitConfirm ?? (() => undefined)}
          onCancel={params.handleActionClose}
        />
      )
    case 'drain-confirm':
      return (
        <DrainConfirmPanel
          onConfirm={params.onDrainConfirm ?? (() => undefined)}
          onCancel={params.handleActionClose}
        />
      )
    case 'reset-story':
      return (
        <ResetStoryWizard
          onComplete={handleActionClose}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    case 'cancel-story':
      return (
        <CancelStoryWizard
          onComplete={handleActionClose}
          onCancel={handleActionClose}
          compact={true}
        />
      )
    case 'create-planning': {
      // Check if team is configured — planning requires it
      const { pipelineConfig: pc } = useAppStore.getState()
      const hasTeam = pc && pc.team !== ''
      if (!hasTeam) {
        return (
          <Box flexDirection="column" padding={1}>
            <Text bold color="yellow">Team not configured</Text>
            <Text> </Text>
            <Text>Planning requires a team to assign epics to.</Text>
            <Text>Setup a team first via the Setup menu or run:</Text>
            <Text> </Text>
            <Text bold color="cyan">  agentkit setup</Text>
            <Text> </Text>
            <Text dimColor>Press [Q] to go back</Text>
          </Box>
        )
      }
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="yellow">Pipeline is running</Text>
          <Text> </Text>
          <Text>Cannot spawn interactive session while workers are active.</Text>
          <Text>Open a new terminal and run:</Text>
          <Text> </Text>
          <Text bold color="cyan">  agentkit planning</Text>
          <Text> </Text>
          <Text dimColor>Press [Q] to go back</Text>
        </Box>
      )
    }
    case 'ask-agentkit':
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="yellow">Pipeline is running</Text>
          <Text> </Text>
          <Text>Cannot spawn interactive session while workers are active.</Text>
          <Text>Open a new terminal and run:</Text>
          <Text> </Text>
          <Text bold color="cyan">  agentkit ask</Text>
          <Text> </Text>
          <Text dimColor>Press [Q] to go back</Text>
        </Box>
      )
    case 'custom-rules':
      return (
        <CustomRulesPanel
          onBack={handleActionClose}
          compact={true}
        />
      )
    case 'epic-story-mgmt':
    case 'task-mgmt':
    case 'chat':
    case 'ask-agent':
      return null;
    default:
      return null;
  }
}

function computeProjectConfig(): ProjectConfig {
  const { configService, pipelineConfig } = useAppStore.getState()
  try {
    if (configService != null) {
      return configService.loadSettings().projectConfig
    }
  } catch {
    // fall through to fallback
  }
  // Fallback if configService unavailable or load fails
  if (pipelineConfig != null) {
    return {
      version: 2,
      project: pipelineConfig.project,
      activeTeam: pipelineConfig.team,
      teams: [pipelineConfig.team],
      provider: pipelineConfig.provider,
      models: {
        [pipelineConfig.provider]: pipelineConfig.models.resolved,
      },
    }
  }
  return {
    version: 2,
    project: { name: '', owner: '' },
    activeTeam: '',
    teams: [],
    provider: '',
    models: {},
  }
}

export function useDashboardContent(params: UseDashboardContentParams): UseDashboardContentResult {
  const { actionMode, isActionActive, focusedPanel } = params

  const projectConfig = computeProjectConfig()

  const isTLFocused = focusedPanel === 0

  const idleContent = (
    <CommandMenuPanel
      isFocused={isTLFocused}
      isActionActive={params.isActionActive}
      actionMode={actionMode}
      onSelectAction={params.onSelectAction}
      isPipelineRunning={params.isPipelineRunning}
      queueStats={params.queueStats}
      menuStack={params.menuStack}
      width={params.width}
      height={params.height}
    />
  )

  // safe: isActionActive guarantees actionMode !== 'none'
  const activeContent =
    isActionActive && actionMode !== 'none' && actionMode !== 'ask-agent'
      ? buildActiveContent(actionMode, params, projectConfig)
      : null

  const tlPanelNode = (
    <ActionPanel
      actionMode={actionMode === 'ask-agent' ? 'none' : actionMode}
      idleContent={idleContent}
      activeContent={activeContent}
    />
  )

  return { tlPanelNode }
}
