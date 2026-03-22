import React from 'react'
import { Box, Text } from 'ink'

import { useDashboardStore } from '@ui/stores/dashboardStore.js'
import { useAppStore } from '@ui/stores/appStore.js'
import { useStoriesStore } from '@ui/stores/storiesStore.js'
import type { ActionMode } from '../shared/DashboardTypes.js'
import type { ProjectConfig } from '@core/ConfigTypes.js'

import { LoadWizard } from '@ui/load/LoadWizard.js'
import { ShipWizard } from '@ui/ship/ShipWizard.js'
import { DiagnoseWizard } from '@ui/diagnose/DiagnoseWizard.js'
import { MarkDoneWizard } from '@ui/mark-done/MarkDoneWizard.js'
import { HistoryWizard } from '@ui/history/HistoryWizard.js'
import { ReplayPicker } from '@ui/replay/ReplayPicker.js'
import { SwitchTeamWizard } from '@ui/config/SwitchTeamWizard.js'
import { ModelConfigWizard } from '@ui/config/ModelConfigWizard.js'
import { ConfigViewer } from '@ui/config/ConfigViewer.js'
import { SwitchProviderWizard } from '@ui/config/SwitchProviderWizard.js'
import { ConfigWizard } from '@ui/config/ConfigWizard.js'
import { CustomRulesPanel } from '@ui/rules/CustomRulesPanel.js'
import { ResetStoryWizard } from '../modals/ResetStoryWizard.js'
import { CancelStoryWizard } from '../modals/CancelStoryWizard.js'
import { HelpModal } from '../modals/HelpModal.js'
import { TerminateConfirmPanel } from '../modals/TerminateConfirmPanel.js'
import { QuitConfirmPanel } from '../modals/QuitConfirmPanel.js'
import { DrainConfirmPanel } from '../modals/DrainConfirmPanel.js'

function computeProjectConfig(): ProjectConfig {
  const { configService, pipelineConfig } = useAppStore.getState()
  try {
    if (configService != null) {
      return configService.loadSettings().projectConfig
    }
  } catch {
    // fall through to fallback
  }
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

function handleClose(): void {
  useDashboardStore.getState().closeAction()
  useStoriesStore.getState().refresh()
}

function handleQuit(): void {
  const { onComplete } = useAppStore.getState()
  onComplete?.()
}

function handleTerminate(): void {
  const { onTerminateWorkers } = useAppStore.getState()
  onTerminateWorkers?.()
  useDashboardStore.getState().closeAction()
}

function handleDrain(): void {
  const { onDrain } = useAppStore.getState()
  onDrain?.()
  useDashboardStore.getState().closeAction()
}

function ActionContent({ mode }: { mode: Exclude<ActionMode, 'none'> }): React.JSX.Element | null {
  const { configService, teamSwitchService, pipelineConfig } = useAppStore.getState()
  const projectConfig = computeProjectConfig()

  switch (mode) {
    case 'load':
      return <LoadWizard isSimple={false} onComplete={handleClose} onCancel={handleClose} compact />
    case 'ship':
      return <ShipWizard onComplete={handleClose} onCancel={handleClose} compact />
    case 'diagnose':
      return <DiagnoseWizard onComplete={handleClose} onCancel={handleClose} compact />
    case 'config':
      if (pipelineConfig === null || configService === null || teamSwitchService === null) return null
      return (
        <ConfigWizard
          pipeline={pipelineConfig}
          projectConfig={projectConfig}
          configService={configService}
          teamSwitchService={teamSwitchService}
          onSave={async (models: Record<string, string>) => {
            await configService.saveModelAssignments(models)
          }}
          onCancel={handleClose}
          compact
        />
      )
    case 'view-config':
      return <ConfigViewer projectConfig={projectConfig} onBack={handleClose} />
    case 'change-models':
      return (
        <ModelConfigWizard
          onSave={async (models: Record<string, string>) => {
            if (configService !== null) await configService.saveModelAssignments(models)
          }}
          onComplete={handleClose}
          onCancel={handleClose}
          compact
        />
      )
    case 'change-provider':
      return (
        <SwitchProviderWizard
          activeProvider={pipelineConfig?.provider ?? ''}
          onComplete={handleClose}
          onCancel={handleClose}
          compact
        />
      )
    case 'help':
      return <HelpModal onClose={handleClose} compact />
    case 'mark-done':
      return <MarkDoneWizard onComplete={handleClose} onCancel={handleClose} compact />
    case 'history':
      return <HistoryWizard filter={{}} onExit={handleClose} compact />
    case 'replay':
      return <ReplayPicker onQuit={handleClose} />
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
          onComplete={handleClose}
          onCancel={handleClose}
          compact
        />
      )
    }
    case 'terminate-confirm':
      return <TerminateConfirmPanel onConfirm={handleTerminate} onCancel={handleClose} />
    case 'quit-confirm':
      return <QuitConfirmPanel onConfirm={handleQuit} onCancel={handleClose} />
    case 'drain-confirm':
      return <DrainConfirmPanel onConfirm={handleDrain} onCancel={handleClose} />
    case 'reset-story':
      return <ResetStoryWizard onComplete={handleClose} onCancel={handleClose} compact />
    case 'cancel-story':
      return <CancelStoryWizard onComplete={handleClose} onCancel={handleClose} compact />
    case 'create-planning': {
      const { pipelineConfig: pc } = useAppStore.getState()
      const hasTeam = pc && pc.team !== ''
      if (!hasTeam) {
        return (
          <Box flexDirection="column" padding={1}>
            <Text bold color="yellow">Team not configured</Text>
            <Text> </Text>
            <Text>Setup a team first via the Setup menu or run:</Text>
            <Text bold color="cyan">  agentkit setup</Text>
            <Text dimColor>Press [Q] to go back</Text>
          </Box>
        )
      }
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="yellow">Pipeline is running</Text>
          <Text> </Text>
          <Text>Open a new terminal and run:</Text>
          <Text bold color="cyan">  agentkit planning</Text>
          <Text dimColor>Press [Q] to go back</Text>
        </Box>
      )
    }
    case 'ask-agentkit':
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="yellow">Pipeline is running</Text>
          <Text> </Text>
          <Text>Open a new terminal and run:</Text>
          <Text bold color="cyan">  agentkit ask</Text>
          <Text dimColor>Press [Q] to go back</Text>
        </Box>
      )
    case 'custom-rules':
      return <CustomRulesPanel onBack={handleClose} compact />
    default:
      return null
  }
}

/**
 * ActionRouter — subscribes to dashboardStore.actionMode only.
 * Renders the active wizard/modal. Display toggled by TLPanel.
 */
export function ActionRouter(): React.JSX.Element | null {
  const actionMode = useDashboardStore(s => s.actionMode)
  if (actionMode === 'none' || actionMode === 'ask-agent') return null
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" flexGrow={1} overflow="hidden">
      <ActionContent mode={actionMode} />
    </Box>
  )
}
