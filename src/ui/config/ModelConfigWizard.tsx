import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

import { usePipelineConfig } from '@ui/stores/appStore.js'

export interface UIStageConfig {
  name: string
  displayName: string
  icon: string
}

export interface UIPipelineConfig {
  team: string
  provider: string
  stages: UIStageConfig[]
  models: {
    allowed: string[]
    resolved: Record<string, string>
  }
}

export interface ModelConfigWizardProps {
  onSave: (models: Record<string, string>) => Promise<void>
  onComplete: () => void
  onCancel: () => void
  compact?: boolean
}

type WizardStep = 'tree' | 'picking' | 'saving' | 'done' | 'error'

/**
 * Wizard for customizing AI model assignments per stage using an inline tree UI.
 */
export function ModelConfigWizard({
  onSave,
  onComplete,
  onCancel,
  compact = false,
}: ModelConfigWizardProps): React.JSX.Element {
  const pipeline = usePipelineConfig();
  const [step, setStep] = useState<WizardStep>('tree')
  const [models, setModels] = useState<Record<string, string>>({ ...pipeline.models.resolved })
  const [treeCursor, setTreeCursor] = useState(0)
  const [pickerCursor, setPickerCursor] = useState(0)
  const [saveError, setSaveError] = useState('')

  const handleSaveModels = useCallback(async () => {
    setStep('saving')
    try {
      await onSave(models)
      setStep('done')
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }, [models, onSave])

  useInput(
    (input, key) => {
      if (step === 'tree') {
        if (key.upArrow) {
          setTreeCursor(Math.max(0, treeCursor - 1))
        } else if (key.downArrow) {
          setTreeCursor(Math.min(pipeline.stages.length - 1, treeCursor + 1))
        } else if (key.return || input === ' ') {
          const stage = pipeline.stages[treeCursor]
          if (stage) {
            const currentModel = models[stage.name]
            const idx = pipeline.models.allowed.indexOf(currentModel || '')
            setPickerCursor(idx >= 0 ? idx : 0)
            setStep('picking')
          }
        } else if (input.toLowerCase() === 's') {
          void handleSaveModels()
        } else if (input.toLowerCase() === 'q') {
          onCancel()
        }
      } else if (step === 'picking') {
        const allowed = pipeline.models.allowed
        if (allowed.length === 0) {
          if (key.escape || key.return) {
            setStep('tree')
          }
          return
        }

        if (key.upArrow) {
          setPickerCursor(Math.max(0, pickerCursor - 1))
        } else if (key.downArrow) {
          setPickerCursor(Math.min(allowed.length - 1, pickerCursor + 1))
        } else if (key.return) {
          const stage = pipeline.stages[treeCursor]
          const selectedModel = allowed[pickerCursor]
          if (stage && selectedModel) {
            setModels(prev => ({ ...prev, [stage.name]: selectedModel }))
          }
          setStep('tree')
          setTreeCursor(Math.min(pipeline.stages.length - 1, treeCursor + 1))
        } else if (key.escape) {
          setStep('tree')
        }
      } else if (step === 'done' || step === 'error') {
        onComplete()
      }
    },
    { isActive: step !== 'saving' }
  )

  return (
    <Box flexDirection="column" padding={compact ? 0 : 1} overflow="hidden">
      <Box overflow="hidden">
        <Text bold color="cyan" wrap="truncate">
          ⚙ Model Configuration
        </Text>
      </Box>
      <Box overflow="hidden">
        <Text wrap="truncate"> </Text>
      </Box>

      {(step === 'tree' || step === 'picking') && (
        <Box flexDirection="column" overflow="hidden">
          <Box overflow="hidden">
            <Text bold wrap="truncate">Model Assignments</Text>
          </Box>
          <Box overflow="hidden">
            <Text dimColor wrap="truncate">
              {' '}
              Team: {pipeline.team} Provider: {pipeline.provider}
            </Text>
          </Box>
          <Box overflow="hidden">
            <Text wrap="truncate"> </Text>
          </Box>
          <Box flexDirection="column" marginLeft={2} overflow="hidden">
            {pipeline.stages.map((stage, idx) => {
              const isTreeActive = step === 'tree' && idx === treeCursor
              const isPickingThis = step === 'picking' && idx === treeCursor

              return (
                <Box key={stage.name} flexDirection="column" overflow="hidden">
                  <Box gap={1} overflow="hidden">
                    <Text color={isTreeActive ? 'cyan' : isPickingThis ? 'green' : undefined} wrap="truncate">
                      {isTreeActive || isPickingThis ? '> ' : '  '}
                      {stage.icon}
                    </Text>
                    <Text color={isTreeActive ? 'cyan' : isPickingThis ? 'green' : undefined} wrap="truncate">
                      {stage.displayName.padEnd(14)}
                    </Text>
                    {!isPickingThis && (
                      <Text color="cyan" wrap="truncate">
                        {models[stage.name]}
                      </Text>
                    )}
                  </Box>
                  {isPickingThis && (
                    <Box flexDirection="column" marginLeft={4} overflow="hidden">
                      {pipeline.models.allowed.length > 0 ? (
                        pipeline.models.allowed.map((m, mIdx) => {
                          const isModelActive = mIdx === pickerCursor
                          return (
                            <Box key={m} overflow="hidden">
                              <Text color={isModelActive ? 'green' : undefined} wrap="truncate">
                                {isModelActive ? '◉ ' : '○ '} {m}
                              </Text>
                            </Box>
                          )
                        })
                      ) : (
                        <Box overflow="hidden">
                          <Text color="red" wrap="truncate">No models available</Text>
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
          <Box overflow="hidden">
            <Text wrap="truncate"> </Text>
          </Box>
          <Box overflow="hidden">
            <Text dimColor wrap="truncate">
              {step === 'tree'
                ? '[↑↓] Navigate  [Enter/Space] Change  [S] Save  [Q] Discard'
                : '[↑↓] Choose  [Enter] Confirm  [Esc] Cancel'}
            </Text>
          </Box>
        </Box>
      )}

      {step === 'saving' && (
        <Box gap={1} overflow="hidden">
          <Text wrap="truncate">… Saving model assignments...</Text>
        </Box>
      )}

      {step === 'done' && (
        <Box flexDirection="column" overflow="hidden">
          <Box overflow="hidden">
            <Text bold color="green" wrap="truncate">
              ✓ Done! Model assignments saved and applied.
            </Text>
          </Box>
          <Box overflow="hidden">
            <Text dimColor wrap="truncate">Press any key to close.</Text>
          </Box>
        </Box>
      )}

      {step === 'error' && (
        <Box flexDirection="column" overflow="hidden">
          <Box overflow="hidden">
            <Text color="red" wrap="truncate">Error: {saveError}</Text>
          </Box>
          <Box overflow="hidden">
            <Text dimColor wrap="truncate">Press any key to close.</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
