import React from 'react'
import { useStdout } from 'ink'
import type { ProjectConfig } from '@core/ConfigTypes.js'
import { ScrollablePanel } from '../shared/ScrollablePanel.js'
import { usePipelineConfig } from '@ui/stores/appStore.js'

export interface ConfigViewerProps {
  projectConfig: ProjectConfig
  onBack: () => void
}

/**
 * Read-only display of the current agentkit configuration.
 * Uses ScrollablePanel for navigation.
 */
export function ConfigViewer({
  projectConfig,
  onBack,
}: ConfigViewerProps): React.JSX.Element {
  const pipeline = usePipelineConfig();
  const { stdout } = useStdout()
  const height = Math.max(5, (stdout?.rows ?? 24) - 8)

  const lines: string[] = [
    'PROJECT INFORMATION',
    '───────────────────',
    `Name:        ${projectConfig.project.name}`,
    `Owner:       ${projectConfig.project.owner || 'N/A'}`,
    `Version:     v${projectConfig.version}`,
    '',
    'ACTIVE CONFIGURATION',
    '────────────────────',
    `Active Team: ${projectConfig.activeTeam}`,
    `Provider:    ${projectConfig.provider}`,
    '',
    'PROVIDER ENV OVERRIDES',
    '──────────────────────',
    ...(() => {
      const envMap = projectConfig.env?.[projectConfig.provider]
      if (!envMap || Object.keys(envMap).length === 0) return ['(none)']
      return Object.entries(envMap).map(([k, v]) => `${k}=${v}`)
    })(),
    '',
    'SETTINGS PATH',
    '─────────────',
    projectConfig.settings?.[projectConfig.provider] ?? '(none)',
    '',
    'TEAMS CONFIGURED',
    '────────────────',
    ...projectConfig.teams.map(t => `- ${t}${t === projectConfig.activeTeam ? ' (active)' : ''}`),
    '',
    'MODEL ASSIGNMENTS (Resolved)',
    '────────────────────────────',
    ...Object.entries(pipeline.models.resolved).map(([stage, model]) => {
      return `${stage.padEnd(12)}: ${model}`
    }),
    '',
    'STAGES IN PIPELINE',
    '──────────────────',
    ...pipeline.stages.map(stage => {
      return `${stage.icon} ${stage.displayName.padEnd(14)} (workers: ${stage.workers}, retries: ${stage.retries})`
    }),
    '',
    'ALLOWED MODELS (for current provider)',
    '─────────────────────────────────────',
    ...pipeline.models.allowed.map(m => `- ${m}`),
    '',
    'END OF CONFIGURATION',
  ]

  return (
    <ScrollablePanel
      lines={lines}
      height={height}
      title="Current AgentKit Configuration"
      onExit={onBack}
      autoScrollToBottom={false}
    />
  )
}
