import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

import type { TeamConfig } from '@core/ConfigTypes.js'

interface InitModelConfigStepProps {
  selectedTeam: TeamConfig
  activeProvider: string
  models: Record<string, string>
  onModelChange: (stageName: string, model: string) => void
  onConfirm: () => void
  onCancel: () => void
}

type Step = 'tree' | 'picking'

export function InitModelConfigStep({
  selectedTeam,
  activeProvider,
  models,
  onModelChange,
  onConfirm,
  onCancel,
}: InitModelConfigStepProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('tree')
  const [treeCursor, setTreeCursor] = useState(0)
  const [pickerCursor, setPickerCursor] = useState(0)

  const allowedModels = selectedTeam.models[activeProvider]?.allowed || []

  useInput((input, key) => {
    if (step === 'tree') {
      if (key.upArrow) {
        setTreeCursor(Math.max(0, treeCursor - 1))
      } else if (key.downArrow) {
        setTreeCursor(Math.min(selectedTeam.stages.length - 1, treeCursor + 1))
      } else if (key.return || input === ' ') {
        const stage = selectedTeam.stages[treeCursor]
        if (stage) {
          const currentModel = models[stage.name] ?? ''
          const idx = allowedModels.indexOf(currentModel)
          setPickerCursor(idx >= 0 ? idx : 0)
          setStep('picking')
        }
      } else if (key.escape) {
        onCancel()
      } else if (input.toLowerCase() === 'y' || input.toLowerCase() === 'f') {
          // Finished customizing
          onConfirm()
      }
    } else if (step === 'picking') {
      if (key.upArrow) {
        setPickerCursor(Math.max(0, pickerCursor - 1))
      } else if (key.downArrow) {
        setPickerCursor(Math.min(allowedModels.length - 1, pickerCursor + 1))
      } else if (key.return) {
        const stage = selectedTeam.stages[treeCursor]
        const selectedModel = allowedModels[pickerCursor]
        if (stage && selectedModel) {
          onModelChange(stage.name, selectedModel)
        }
        setStep('tree')
      } else if (key.escape) {
        setStep('tree')
      }
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        ⚙ Customize Model Assignments
      </Text>
      <Text dimColor>
        Team: {selectedTeam.displayName} | Provider: {activeProvider}
      </Text>
      <Box height={1} />

      <Box flexDirection="column" marginLeft={2}>
        {selectedTeam.stages.map((stage, idx) => {
          const isTreeActive = step === 'tree' && idx === treeCursor
          const isPickingThis = step === 'picking' && idx === treeCursor

          return (
            <Box key={stage.name} flexDirection="column">
              <Box gap={1}>
                <Text color={isTreeActive ? 'cyan' : isPickingThis ? 'green' : undefined}>
                  {isTreeActive || isPickingThis ? '> ' : '  '}
                  {stage.icon}
                </Text>
                <Text color={isTreeActive ? 'cyan' : isPickingThis ? 'green' : undefined}>
                  {stage.displayName.padEnd(14)}
                </Text>
                {!isPickingThis && (
                  <Text color="cyan">
                    {models[stage.name]}
                  </Text>
                )}
              </Box>
              {isPickingThis && (
                <Box flexDirection="column" marginLeft={4}>
                  {allowedModels.length > 0 ? (
                    allowedModels.map((m, mIdx) => {
                      const isModelActive = mIdx === pickerCursor
                      return (
                        <Box key={m}>
                          <Text color={isModelActive ? 'green' : undefined}>
                            {isModelActive ? '◉ ' : '○ '} {m}
                          </Text>
                        </Box>
                      )
                    })
                  ) : (
                    <Text color="red">No models available</Text>
                  )}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>

      <Box height={1} />
      <Text dimColor>
        {step === 'tree'
          ? '[↑↓] Navigate  [Enter/Space] Change  [Y] Finish  [Esc] Back'
          : '[↑↓] Choose  [Enter] Confirm  [Esc] Cancel'}
      </Text>
    </Box>
  )
}
