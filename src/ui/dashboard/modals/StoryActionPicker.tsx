import React from 'react';
import { Box, Text, useInput } from 'ink';

import type { ResetTarget } from '@core/ResetTypes.js';

interface StoryActionPickerProps {
  targets: ResetTarget[];
  storyKey: string;
  onSelect: (stageName: string) => void;
  onCancel: () => void;
}

const MAX_TARGETS = 9;

export function StoryActionPicker({
  targets,
  storyKey,
  onSelect,
  onCancel,
}: StoryActionPickerProps): React.JSX.Element {
  const displayTargets = targets.slice(0, MAX_TARGETS);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    const digit = parseInt(input, 10);
    if (!isNaN(digit) && digit >= 1 && digit <= displayTargets.length) {
      const target = displayTargets[digit - 1];
      if (target) {
        onSelect(target.stageName);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Reset story {storyKey} — select target stage:</Text>
      {displayTargets.length === 0 ? (
        <Text dimColor>(no targets)</Text>
      ) : (
        displayTargets.map((target, i) => (
          <Text key={target.stageName}>
            [{i + 1}] {target.icon} {target.displayName}
          </Text>
        ))
      )}
      {displayTargets.length > 0 ? (
        <Text dimColor>[1-{displayTargets.length}] Select  [Esc] Cancel</Text>
      ) : (
        <Text dimColor>[Esc] Cancel</Text>
      )}
    </Box>
  );
}
