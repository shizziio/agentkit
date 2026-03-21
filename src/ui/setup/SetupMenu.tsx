import React, { useState } from 'react'
import { Box, Text, useInput, useApp } from 'ink'

import type { ReadinessResult, SetupStep, SetupStatus, SetupStepId } from '@core/ReadinessTypes.js'
import { launchInteractiveSession } from '@shared/InteractiveSession.js'
import { APP_NAME, APP_VERSION } from '@config/defaults.js'

const STATUS_ICON: Record<SetupStatus, { icon: string; color: string }> = {
  ready: { icon: '✓', color: 'green' },
  partial: { icon: '!', color: 'yellow' },
  missing: { icon: '✗', color: 'red' },
}

const STEP_LABELS: Record<SetupStepId, string> = {
  'project-docs': 'Project Docs',
  'team-config': 'Team Config',
  'epic-plans': 'Epic Plans',
}

interface SetupMenuProps {
  readiness: ReadinessResult
  provider: string
  onSkip: () => void
}

interface ActionItem {
  label: string
  step: SetupStep | null // null = skip action
  blocked: boolean
  blockedReason?: string
}

function isStepBlocked(step: SetupStep, statusMap: Map<SetupStepId, SetupStatus>): string | null {
  if (!step.blockedBy || step.blockedBy.length === 0) return null
  const unmet = step.blockedBy.filter(depId => statusMap.get(depId) === 'missing')
  if (unmet.length === 0) return null
  return `Requires: ${unmet.map(id => STEP_LABELS[id]).join(', ')}`
}

export function SetupMenu({
  readiness,
  provider,
  onSkip,
}: SetupMenuProps): React.JSX.Element {
  const { exit } = useApp()

  // Build status map for dependency checking
  const statusMap = new Map<SetupStepId, SetupStatus>()
  for (const step of readiness.steps) {
    statusMap.set(step.id, step.status)
  }

  // Build action list: actionable steps (not ready) + skip
  const actionItems: ActionItem[] = []
  for (const step of readiness.steps) {
    if (step.status === 'ready') continue
    const blockedReason = isStepBlocked(step, statusMap)
    actionItems.push({
      label: `Setup ${step.label}`,
      step,
      blocked: blockedReason !== null,
      blockedReason: blockedReason ?? undefined,
    })
  }
  actionItems.push({ label: 'Skip — Continue to Dashboard', step: null, blocked: false })

  const [cursor, setCursor] = useState(0)

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1))
    } else if (key.downArrow) {
      setCursor(c => Math.min(actionItems.length - 1, c + 1))
    } else if (key.return) {
      const selected = actionItems[cursor]!
      if (selected.blocked) return // Can't select blocked items
      if (selected.step === null) {
        onSkip()
        return
      }
      launchInteractiveSession({
        provider,
        systemPromptFiles: selected.step.provider.promptFiles,
        initialMessage: selected.step.provider.initialMessage,
      })
    } else if (_input === 'q') {
      exit()
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box gap={1} marginBottom={1}>
        <Text bold color="cyan">{APP_NAME}</Text>
        <Text dimColor>v{APP_VERSION}</Text>
        <Text dimColor>·</Text>
        <Text bold>Project Setup</Text>
      </Box>

      {/* Readiness status */}
      <Box flexDirection="column" marginBottom={1}>
        {readiness.steps.map(step => {
          const { icon, color } = STATUS_ICON[step.status]
          return (
            <Box key={step.id} gap={1}>
              <Text color={color} bold>{icon}</Text>
              <Text bold>{step.label.padEnd(24)}</Text>
              <Text dimColor>{step.detail}</Text>
            </Box>
          )
        })}
      </Box>

      {/* Separator */}
      <Text dimColor>{'─'.repeat(50)}</Text>

      {/* Action menu */}
      <Box flexDirection="column" marginTop={1}>
        {actionItems.map((item, i) => (
          <Box key={item.label} flexDirection="row">
            <Text
              color={item.blocked ? 'gray' : i === cursor ? 'cyan' : undefined}
              bold={!item.blocked && i === cursor}
              dimColor={item.blocked}
            >
              {i === cursor ? '> ' : '  '}
              {item.label}
            </Text>
            {item.blocked && item.blockedReason && (
              <Text color="yellow" dimColor> ({item.blockedReason})</Text>
            )}
            {!item.blocked && item.step && (
              <Text dimColor> — {item.step.provider.description}</Text>
            )}
          </Box>
        ))}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>[↑↓] Navigate  [Enter] Select  [Q] Quit</Text>
      </Box>
    </Box>
  )
}
