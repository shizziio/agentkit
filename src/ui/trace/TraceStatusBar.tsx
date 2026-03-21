import React from 'react';
import { Box, Text } from 'ink';

import type { TraceStatusBarProps } from './TraceTypes.js';

export function TraceStatusBar({
  totalEpics,
  totalStories,
  totalTasks,
}: TraceStatusBarProps): React.ReactElement {
  return (
    <Box flexShrink={0} borderStyle="single" borderColor="gray" width="100%">
      <Text bold color="cyan">trace  </Text>
      <Text color="gray">{totalEpics}E {totalStories}S {totalTasks}T  </Text>
      <Text dimColor>[↑↓] Navigate  [Enter] Expand  [d] Detail  [m] Mark Done  [R] Refresh  [Q] Exit</Text>
    </Box>
  );
}
