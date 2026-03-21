import React from 'react'
import { Box, Text, useInput } from 'ink'
import { Spinner } from '@inkjs/ui'

export interface WizardShellProps {
  /** Wizard title displayed at top */
  title: string
  /** Compact mode — reduced padding for inline dashboard use */
  compact?: boolean
  /** Wizard step content */
  children: React.ReactNode
  /** Error message banner (shown in red at bottom) */
  error?: string | null
  /** Show loading spinner */
  isLoading?: boolean
  /** Text next to spinner */
  loadingText?: string
  /** Called when Q is pressed */
  onCancel?: () => void
  /** Whether keyboard input is active (default: true) */
  isActive?: boolean
}

export function WizardShell({
  title,
  compact = false,
  children,
  error,
  isLoading = false,
  loadingText,
  onCancel,
  isActive = true,
}: WizardShellProps): React.JSX.Element {
  useInput(
    (input) => {
      if (input === 'q' || input === 'Q') {
        onCancel?.()
      }
    },
    { isActive: isActive && onCancel !== undefined },
  )

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={compact ? 0 : 1}
      overflow="hidden"
    >
      <Text bold color="cyan">{title}</Text>

      <Box flexDirection="column" marginTop={compact ? 0 : 1} overflow="hidden">
        {children}
      </Box>

      {isLoading && (
        <Box marginTop={1} gap={1}>
          <Spinner />
          {loadingText && <Text dimColor>{loadingText}</Text>}
        </Box>
      )}

      {error != null && error !== '' && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  )
}
