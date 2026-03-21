import React from 'react';
import { Box, Text, useInput } from 'ink';

interface QuitConfirmPanelProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function QuitConfirmPanel({ onConfirm, onCancel }: QuitConfirmPanelProps): React.JSX.Element {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm();
    } else if (key.escape) {
      onCancel();
    }
  });
  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text color="yellow">Quit AgentKit?</Text>
      <Text color="gray">[Y] Confirm  [Esc] Cancel</Text>
    </Box>
  );
}
