import React from 'react'
import { Box, Text, useInput } from 'ink'

export interface DrainConfirmPanelProps {
  onConfirm: () => void
  onCancel: () => void
}

export function DrainConfirmPanel({
  onConfirm,
  onCancel,
}: DrainConfirmPanelProps): React.JSX.Element {
  useInput((_input, key) => {
    if (key.return) {
      onConfirm()
    } else if (key.escape) {
      onCancel()
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} overflow="hidden">
      <Text bold>Drain Pipeline?</Text>
      <Box height={1} />
      <Text wrap="truncate">• Running tasks will finish</Text>
      <Text wrap="truncate">• Queued tasks will be cancelled</Text>
      <Text wrap="truncate">• No new tasks will be routed</Text>
      <Box height={1} />
      <Text wrap="truncate">[Enter] Confirm [Esc] Cancel</Text>
    </Box>
  )
}
