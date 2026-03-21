import React from 'react';
import { Box, Text } from 'ink';

interface ReplayProgressBarProps {
  currentIndex: number;
  totalEvents: number;
  firstTimestampMs: number;
  lastTimestampMs: number;
  currentTimestampMs: number;
}

function formatMs(ms: number): string {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  if (totalSecs < 60) {
    const tenths = Math.floor((ms % 1000) / 100);
    return `${totalSecs}.${tenths}`;
  }
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function ReplayProgressBar({
  currentIndex,
  totalEvents,
  firstTimestampMs,
  lastTimestampMs,
  currentTimestampMs,
}: ReplayProgressBarProps): React.JSX.Element {
  const totalDuration = lastTimestampMs - firstTimestampMs;
  const elapsed = currentTimestampMs - firstTimestampMs;

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box>
        <Text dimColor>
          Event: {currentIndex + 1} / {totalEvents}{'  '}|{'  '}Elapsed: {formatMs(elapsed)} /{' '}
          {formatMs(totalDuration)}
        </Text>
      </Box>
      <Box>
        <Text dimColor>
          [Space] Pause/Resume{'  '}[\u2190][\u2192] Jump{'  '}[1/2/4/8] Speed{'  '}[Home] Start
          {'  '}[End] End{'  '}[q] Quit
        </Text>
      </Box>
    </Box>
  );
}
