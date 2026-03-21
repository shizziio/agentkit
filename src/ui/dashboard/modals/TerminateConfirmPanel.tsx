import React from 'react';
import { Box, Text, useInput } from 'ink';

interface TerminateConfirmPanelProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function TerminateConfirmPanel({ onConfirm, onCancel }: TerminateConfirmPanelProps): React.JSX.Element {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    }
  });
  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text color="yellow">Workers dang chay. Dung tat ca workers?</Text>
      <Text color="gray">[Y/Enter] Xac nhan  [N/Esc] Huy</Text>
    </Box>
  );
}
