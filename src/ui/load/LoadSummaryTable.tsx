import React from 'react';
import { Box, Text } from 'ink';

import type { ComparisonResult, ComparisonStatus } from '@core/LoadTypes.js';
import { truncate } from '@ui/shared/format.js';

interface LoadSummaryTableProps {
  comparison: ComparisonResult;
}

function statusColor(status: ComparisonStatus): string {
  if (status === 'new') return 'green';
  if (status === 'updated') return 'yellow';
  return 'gray';
}

function statusLabel(status: ComparisonStatus): string {
  return status.toUpperCase();
}

export function LoadSummaryTable({ comparison }: LoadSummaryTableProps): React.JSX.Element {
  const { summary } = comparison;

  return (
    <Box flexDirection="column">
      <Box gap={1} marginBottom={1}>
        <Text bold>{truncate('Type', 8)}</Text>
        <Text bold>{truncate('Key', 10)}</Text>
        <Text bold>{truncate('Title', 30)}</Text>
        <Text bold>Status</Text>
      </Box>

      {comparison.epics.map((epic) => (
        <Box key={epic.epicKey} flexDirection="column">
          <Box gap={1}>
            <Text color={statusColor(epic.status)}>{truncate('Epic', 8)}</Text>
            <Text color={statusColor(epic.status)}>{truncate(epic.epicKey, 10)}</Text>
            <Text color={statusColor(epic.status)}>{truncate(epic.title, 30)}</Text>
            <Text color={statusColor(epic.status)}>{statusLabel(epic.status)}</Text>
          </Box>
          {epic.storyComparisons.map((story) => (
            <Box key={story.storyKey} gap={1}>
              <Text color={statusColor(story.status)}>{truncate('  Story', 8)}</Text>
              <Text color={statusColor(story.status)}>{truncate(story.storyKey, 10)}</Text>
              <Text color={statusColor(story.status)}>{truncate(story.title, 30)}</Text>
              <Text color={statusColor(story.status)}>{statusLabel(story.status)}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Box marginTop={1} flexDirection="column">
        <Text>
          Epics: <Text color="green">{summary.newEpics} new</Text>
          {', '}<Text color="yellow">{summary.updatedEpics} updated</Text>
          {', '}<Text color="gray">{summary.skippedEpics} skipped</Text>
        </Text>
        <Text>
          Stories: <Text color="green">{summary.newStories} new</Text>
          {', '}<Text color="yellow">{summary.updatedStories} updated</Text>
          {', '}<Text color="gray">{summary.skippedStories} skipped</Text>
        </Text>
      </Box>
    </Box>
  );
}
