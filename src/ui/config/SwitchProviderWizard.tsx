import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { Select, Spinner } from '@inkjs/ui'

import { useConfigService } from '@ui/stores/appStore.js'

type WizardStep = 'select' | 'switching' | 'done' | 'error'

interface SwitchProviderWizardProps {
  activeProvider: string
  onComplete: () => void
  onCancel: () => void
  compact?: boolean
}

const AVAILABLE_PROVIDERS = [
  { label: 'Claude CLI', value: 'claude-cli' },
  { label: 'Gemini CLI', value: 'gemini-cli' },
]

export function SwitchProviderWizard({
  activeProvider,
  onComplete,
  onCancel,
  compact = false,
}: SwitchProviderWizardProps): React.JSX.Element {
  const configService = useConfigService();
  const [step, setStep] = useState<WizardStep>('select')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSwitch = useCallback(
    async (provider: string) => {
      setStep('switching')
      try {
        await configService.switchProvider(provider)
        setStep('done')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setErrorMsg(msg)
        setStep('error')
      }
    },
    [configService]
  )

  useInput(
    (input, key) => {
      if (step === 'select') {
        if (key.escape || input.toLowerCase() === 'q') {
          onCancel()
        }
      } else if (step === 'done' || step === 'error') {
        if (key.return || key.escape || input) {
          onComplete()
        }
      }
    },
    { isActive: true }
  )

  return (
    <Box flexDirection="column" padding={compact ? 0 : 1}>
      {step === 'select' && (
        <Box flexDirection="column">
          <Text bold>Switch AI Provider</Text>
          <Text>{' '}</Text>
          <Text color="gray">Current Provider: <Text color="cyan">{activeProvider}</Text></Text>
          <Text>{' '}</Text>
          <Select
            options={AVAILABLE_PROVIDERS}
            defaultValue={activeProvider}
            onChange={(value: string) => void handleSwitch(value)}
          />
          <Text>{' '}</Text>
          <Text>[Q/Esc] Cancel</Text>
        </Box>
      )}

      {step === 'switching' && (
        <Box gap={1}>
          <Spinner label="Switching provider..." />
        </Box>
      )}

      {step === 'done' && (
        <Box flexDirection="column">
          <Text bold color="green">Provider switched successfully!</Text>
          <Text color="yellow">Pipelines running may need to be restarted to use the new provider.</Text>
          <Text>{' '}</Text>
          <Text color="gray">Press any key to close...</Text>
        </Box>
      )}

      {step === 'error' && (
        <Box flexDirection="column">
          <Text color="red">Failed to switch provider: {errorMsg}</Text>
          <Text>{' '}</Text>
          <Text color="gray">Press any key to close...</Text>
        </Box>
      )}
    </Box>
  )
}
