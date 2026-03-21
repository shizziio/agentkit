import React from 'react';
import { Box, Text } from 'ink';

import { formatDuration } from '../shared/utils.js';

interface CompletionCardProps {
  storyTitle: string;
  stageDurations: Array<{ stageName: string; durationMs: number }>;
  totalDurationMs: number;
  totalAttempts: number;
}

export function CompletionCard({
  storyTitle,
  stageDurations,
  totalDurationMs,
  totalAttempts,
}: CompletionCardProps): React.JSX.Element {
  return (
    <Box borderStyle="round" borderColor="green" flexDirection="column" marginY={0}>
      <Text bold color="green"> ✓ COMPLETED: {storyTitle}</Text>
      {stageDurations.map((sd) => (
        <Text key={sd.stageName}>
          {`  ${sd.stageName.padEnd(12)} ${formatDuration(sd.durationMs)}`}
        </Text>
      ))}
      <Text dimColor>
        {`  Total: ${formatDuration(totalDurationMs)}  Attempts: ${totalAttempts}`}
      </Text>
    </Box>
  );
}
