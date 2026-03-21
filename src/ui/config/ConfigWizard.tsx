import React, { useState, useMemo, useLayoutEffect } from 'react'
import { Box, Text, useInput } from 'ink'

import type { PipelineConfig, ProjectConfig, IConfigService } from '@core/ConfigTypes.js'
import type { ITeamSwitchService } from '@core/TeamSwitchTypes.js'
import { ModelConfigWizard } from './ModelConfigWizard.js'
import { SwitchTeamWizard } from './SwitchTeamWizard.js'
import { ConfigViewer } from './ConfigViewer.js'
import { useAppStore } from '@ui/stores/appStore.js'

type WizardStep = 'menu' | 'view' | 'models' | 'team' | 'env' | 'settings'

interface ConfigWizardProps {
  pipeline: PipelineConfig
  projectConfig: ProjectConfig
  configService: IConfigService
  teamSwitchService: ITeamSwitchService
  onSave: (models: Record<string, string>) => Promise<void>
  onCancel: () => void
  compact?: boolean
}

/**
 * Standalone Configuration Wizard for CLI usage.
 * Orchestrates between different configuration sub-actions.
 */
export function ConfigWizard({
  pipeline,
  projectConfig,
  configService,
  teamSwitchService,
  onSave,
  onCancel,
  compact = false,
}: ConfigWizardProps): React.JSX.Element {
  // Seed appStore with pipeline so sub-components (ConfigViewer, ModelConfigWizard)
  // can read pipelineConfig via usePipelineConfig() from appStore.
  useLayoutEffect(() => {
    useAppStore.setState({ pipelineConfig: pipeline })
  }, [pipeline])

  const [step, setStep] = useState<WizardStep>('menu')
  const [cursor, setCursor] = useState(0)
  const [envInput, setEnvInput] = useState('')
  const [envEntries, setEnvEntries] = useState<Record<string, string>>(() => ({
    ...(projectConfig.env?.[projectConfig.provider] ?? {}),
  }))
  const [envCursor, setEnvCursor] = useState(0)
  const [envMessage, setEnvMessage] = useState<string | null>(null)
  const [settingsInput, setSettingsInput] = useState(
    projectConfig.settings?.[projectConfig.provider] ?? ''
  )
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)

  const menuItems = [
    { action: 'view-config', label: 'View Current Config', hotkey: 'V' },
    { action: 'change-team', label: 'Change Active Team', hotkey: 'T' },
    { action: 'change-models', label: 'Change Models', hotkey: 'M' },
    { action: 'env-settings', label: 'Env Settings', hotkey: 'E' },
    { action: 'settings-path', label: 'Settings Path', hotkey: 'S' },
    { action: 'exit', label: 'Exit', hotkey: 'Q' },
  ]

  useInput((input, key) => {
    if (step === 'env') {
      const envKeys = Object.keys(envEntries)

      if (key.escape) {
        setStep('menu')
        return
      }

      // Delete key removes selected entry
      if (input === 'd' && envKeys.length > 0) {
        const keyToRemove = envKeys[envCursor]
        if (keyToRemove) {
          const updated = { ...envEntries }
          delete updated[keyToRemove]
          setEnvEntries(updated)
          setEnvCursor(c => Math.max(0, Math.min(c, Object.keys(updated).length - 1)))
        }
        return
      }

      // Save
      if (input === 's') {
        try {
          configService.saveEnv(projectConfig.provider, envEntries)
          setEnvMessage('✓ Env saved')
        } catch (err: unknown) {
          setEnvMessage(`✗ ${err instanceof Error ? err.message : String(err)}`)
        }
        setTimeout(() => {
          setEnvMessage(null)
          setStep('menu')
        }, 1200)
        return
      }

      // Add entry via Enter
      if (key.return && envInput.trim().length > 0) {
        const eqIdx = envInput.indexOf('=')
        if (eqIdx > 0) {
          const k = envInput.slice(0, eqIdx).trim()
          const v = envInput.slice(eqIdx + 1).trim()
          if (k.length > 0) {
            setEnvEntries(prev => ({ ...prev, [k]: v }))
            setEnvInput('')
          }
        }
        return
      }

      // Navigate existing entries
      if (key.upArrow && envKeys.length > 0) {
        setEnvCursor(c => Math.max(0, c - 1))
        return
      }
      if (key.downArrow && envKeys.length > 0) {
        setEnvCursor(c => Math.min(envKeys.length - 1, c + 1))
        return
      }

      // Text input for new entry
      if (key.backspace || key.delete) {
        setEnvInput(v => v.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setEnvInput(v => v + input)
      }
      return
    }

    if (step === 'settings') {
      if (key.escape) {
        setStep('menu')
        return
      }
      if (key.return) {
        const trimmed = settingsInput.trim()
        try {
          configService.saveSettings(
            projectConfig.provider,
            trimmed.length > 0 ? trimmed : null
          )
          setSettingsMessage(trimmed.length > 0 ? `✓ Settings: ${trimmed}` : '✓ Settings removed')
        } catch (err: unknown) {
          setSettingsMessage(`✗ ${err instanceof Error ? err.message : String(err)}`)
        }
        setTimeout(() => {
          setSettingsMessage(null)
          setStep('menu')
        }, 1200)
        return
      }
      if (key.backspace || key.delete) {
        setSettingsInput(v => v.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setSettingsInput(v => v + input)
      }
      return
    }

    if (step !== 'menu') return
    const lower = input.toLowerCase()

    if (lower === 'q') {
      onCancel()
      return
    }

    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1))
    } else if (key.downArrow) {
      setCursor(c => Math.min(menuItems.length - 1, c + 1))
    } else if (key.return) {
      handleAction(menuItems[cursor]!.action)
    } else if (lower) {
      const item = menuItems.find(it => it.hotkey.toLowerCase() === lower)
      if (item) handleAction(item.action)
    }
  })

  const handleAction = (action: string) => {
    if (action === 'view-config') setStep('view')
    if (action === 'change-team') setStep('team')
    if (action === 'change-models') setStep('models')
    if (action === 'env-settings') {
      setEnvEntries({ ...(projectConfig.env?.[projectConfig.provider] ?? {}) })
      setEnvInput('')
      setEnvCursor(0)
      setEnvMessage(null)
      setStep('env')
    }
    if (action === 'settings-path') {
      setSettingsInput(projectConfig.settings?.[projectConfig.provider] ?? '')
      setSettingsMessage(null)
      setStep('settings')
    }
    if (action === 'exit') onCancel()
  }

  const switchTeamData = useMemo(() => {
    if (step !== 'team') return null
    try {
      const bundledTeams = configService.listBundledTeams()
      const projTeams = projectConfig.teams
      const merged = Array.from(new Set([...projTeams, ...bundledTeams])).sort((a, b) =>
        a.localeCompare(b)
      )
      return {
        mergedTeams: merged,
        projectTeams: projTeams,
        activeTeam: projectConfig.activeTeam,
        loadError: null,
      }
    } catch (err: unknown) {
      return {
        mergedTeams: [],
        projectTeams: [],
        activeTeam: '',
        loadError: err instanceof Error ? err.message : String(err),
      }
    }
  }, [step, configService, projectConfig])

  if (step === 'view') {
    return (
      <ConfigViewer
        projectConfig={projectConfig}
        onBack={() => setStep('menu')}
      />
    )
  }

  if (step === 'team' && switchTeamData) {
    return (
      <SwitchTeamWizard
        mergedTeams={switchTeamData.mergedTeams}
        projectTeams={switchTeamData.projectTeams}
        activeTeam={switchTeamData.activeTeam}
        loadError={switchTeamData.loadError}
        onSwitch={teamName => teamSwitchService.switchTeam(teamName)}
        onComplete={() => setStep('menu')}
        onCancel={() => setStep('menu')}
        compact={compact}
      />
    )
  }

  if (step === 'models') {
    return (
      <ModelConfigWizard
        onSave={onSave}
        onComplete={() => setStep('menu')}
        onCancel={() => setStep('menu')}
        compact={compact}
      />
    )
  }

  if (step === 'env') {
    const envKeys = Object.keys(envEntries)
    return (
      <Box flexDirection="column" padding={compact ? 0 : 1}>
        <Text bold color="cyan">Env Overrides — {projectConfig.provider}</Text>
        <Box marginTop={1} flexDirection="column">
          {envKeys.length === 0 && <Text dimColor>(no env vars configured)</Text>}
          {envKeys.map((k, i) => (
            <Text key={k} color={i === envCursor ? 'cyan' : undefined}>
              {i === envCursor ? '> ' : '  '}{k}={envEntries[k]}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text>Add: </Text>
          <Text color="cyan">{envInput}<Text color="gray">█</Text></Text>
        </Box>
        {envMessage && (
          <Box marginTop={1}>
            <Text color={envMessage.startsWith('✓') ? 'green' : 'red'}>{envMessage}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>[Enter] Add KEY=VALUE  [D] Delete selected  [S] Save  [Esc] Cancel</Text>
        </Box>
      </Box>
    )
  }

  if (step === 'settings') {
    const currentSettings = projectConfig.settings?.[projectConfig.provider]
    return (
      <Box flexDirection="column" padding={compact ? 0 : 1}>
        <Text bold color="cyan">Settings Path — {projectConfig.provider}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Current: {currentSettings ?? '(none)'}</Text>
          <Box marginTop={1}>
            <Text>Path: </Text>
            <Text color="cyan">{settingsInput}<Text color="gray">█</Text></Text>
          </Box>
          {settingsMessage && (
            <Box marginTop={1}>
              <Text color={settingsMessage.startsWith('✓') ? 'green' : 'red'}>{settingsMessage}</Text>
            </Box>
          )}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[Enter] Save  [Esc] Cancel  (empty = remove)</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={compact ? 0 : 1}>
      <Text bold color="cyan">
        Configuration Menu
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {menuItems.map((item, i) => (
          <Text key={item.action} color={i === cursor ? 'cyan' : undefined}>
            {i === cursor ? '> ' : '  '}[{item.hotkey}] {item.label}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[↑↓] Navigate [Enter] Select [Q] Back</Text>
      </Box>
    </Box>
  )
}

