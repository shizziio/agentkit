import React from 'react';
import { Box, Text } from 'ink';

import type { ReplayTaskMeta, PlaybackState, PlaybackSpeed } from './ReplayTypes.js';

interface TaskMetadataHeaderProps {
  meta: ReplayTaskMeta;
  playbackState: PlaybackState;
  speed: PlaybackSpeed;
}

export function TaskMetadataHeader({
  meta,
  playbackState,
  speed,
}: TaskMetadataHeaderProps): React.JSX.Element {
  const durationStr =
    meta.durationMs != null ? `${(meta.durationMs / 1000).toFixed(1)}s` : '\u2014';
  const inputTokens = meta.inputTokens ?? 0;
  const outputTokens = meta.outputTokens ?? 0;
  const playIcon = playbackState === 'playing' ? '\u25b6' : '\u23f8';

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="cyan">
          Task #{meta.taskId} | Stage: {meta.stageName} | Model:{' '}
          {meta.workerModel ?? 'unknown'}
        </Text>
        <Text color="cyan">
          Duration: {durationStr} | Tokens: {inputTokens}in / {outputTokens}out
        </Text>
      </Box>
      <Box>
        <Text>
          [{playIcon}] {speed}x
        </Text>
      </Box>
    </Box>
  );
}
