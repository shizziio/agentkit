import React from 'react';
import { Box, Text } from 'ink';

interface HelpModalProps {
  onClose: () => void;
  compact?: boolean;
}

export function HelpModal({ onClose: _onClose, compact = false }: HelpModalProps): React.JSX.Element {
  // Esc is disabled. Q is used for Back / Close action / Exit.
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      padding={compact ? 0 : 1}
      width={compact ? undefined : 50}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">Keyboard Shortcuts</Text>
      </Box>
      <Box flexDirection="column" gap={0}>
        <Box>
          <Text color="yellow" bold>L</Text>
          <Text color="gray">  — Load stories</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>S</Text>
          <Text color="gray">  — Ship stories to pipeline</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>R</Text>
          <Text color="gray">  — Run workers (start pipeline)</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>T</Text>
          <Text color="gray">  — Trace mode (browse history)</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>D</Text>
          <Text color="gray">  — Diagnose pipeline</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>C</Text>
          <Text color="gray">  — Configuration</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>A</Text>
          <Text color="gray">  — Ask Agent (Chat)</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>H</Text>
          <Text color="gray">  — This help screen</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>Q</Text>
          <Text color="gray">  — Back / Close Action / Quit</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>Tab</Text>
          <Text color="gray"> — Cycle panel focus</Text>
        </Box>
        <Box>
          <Text color="yellow" bold>1-4</Text>
          <Text color="gray"> — Jump to panel</Text>
        </Box>
      </Box>
      <Box justifyContent="center" marginTop={1}>
        <Text color="gray">[Q] Back / Close</Text>
      </Box>
    </Box>
  );
}
