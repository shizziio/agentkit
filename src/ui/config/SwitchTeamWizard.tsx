import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { eventBus } from '@core/EventBus.js'
import { TeamSwitchError } from '@core/Errors.js'

export interface SwitchTeamWizardProps {
  mergedTeams: string[]
  projectTeams: string[]
  activeTeam: string
  loadError: string | null
  onSwitch?: (teamName: string) => Promise<void>
  onComplete: () => void
  onCancel: () => void
  compact?: boolean
}

type Step = 'list' | 'done' | 'error'

export function SwitchTeamWizard({
  mergedTeams,
  projectTeams,
  activeTeam,
  loadError,
  onSwitch,
  onComplete,
  onCancel,
  compact = false,
}: SwitchTeamWizardProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('list')
  const [cursor, setCursor] = useState(0)
  const [selectedTeam, setSelectedTeam] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSelect = async (teamName: string): Promise<void> => {
    setSelectedTeam(teamName)
    try {
      if (onSwitch) {
        await onSwitch(teamName)
      } else {
        eventBus.emit('team:request-switch', { toTeam: teamName })
      }
      setStep('done')
    } catch (err: unknown) {
      setError(err instanceof TeamSwitchError ? err.message : String(err))
      setStep('error')
    }
  }

  useInput(
    (_input, key) => {
      if (key.escape) {
        onCancel()
        return
      }

      if (loadError !== null) {
        onComplete()
        return
      }

      if (step === 'list') {
        if (key.upArrow) {
          setCursor(c => Math.max(0, c - 1))
        } else if (key.downArrow) {
          setCursor(c => Math.min(Math.max(0, mergedTeams.length - 1), c + 1))
        } else if (key.return) {
          if (mergedTeams.length <= 1) return
          const team = mergedTeams[cursor]
          if (team === undefined || team === activeTeam) return
          handleSelect(team)
        }
      } else if (step === 'done' || step === 'error') {
        onComplete()
      }
    },
    { isActive: true }
  )

  return (
    <Box flexDirection="column" padding={compact ? 0 : 1} overflow="hidden">
      <Text bold> Switch Team</Text>
      {loadError !== null && (
        <>
          <Text color="red">Error loading config: {loadError}</Text>
          <Text color="gray">Press any key to exit...</Text>
        </>
      )}
      {loadError === null && step === 'list' && (
        <>
          {mergedTeams.length <= 1 ? (
            <>
              <Text>Only one team configured.</Text>
            </>
          ) : (
            <>
              <Box flexDirection="column">
                {mergedTeams.map((team, i) => {
                  const isCursor = i === cursor
                  const isActiveMark = team === activeTeam
                  const isNewTeam = !projectTeams.includes(team)

                  let marker = '[ ]'
                  if (isActiveMark) marker = '[*]'
                  else if (isNewTeam) marker = '[+]'

                  const prefix = isCursor ? '> ' : '  '
                  if (isCursor) {
                    return <Text key={team} color="cyan" bold>{`${prefix}${marker} ${team}`}</Text>
                  }
                  return <Text key={team}>{`${prefix}${marker} ${team}`}</Text>
                })}
              </Box>
              <Text dimColor>[↑↓] Navigate [Enter] Select</Text>
            </>
          )}
        </>
      )}
      {loadError === null && step === 'done' && (
        <>
          <Text color="green">Switching to {selectedTeam}...</Text>
          <Text color="gray">Press any key to exit...</Text>
        </>
      )}
      {loadError === null && step === 'error' && (
        <>
          <Text color="red">{error}</Text>
          <Text color="gray">Press any key to exit...</Text>
        </>
      )}
    </Box>
  )
}
