import React from 'react';
import { Box, Text, useInput } from 'ink';

import { ACTIVITY_VISIBLE_ROWS } from '@config/defaults.js';
import { useActivityStore } from '@stores/activityStore.js';
import { useDashboardStore } from '@ui/stores/dashboardStore.js';
import { CompletionCard } from './CompletionCard.js';

interface LiveActivityPanelProps {
  isFocused?: boolean;  // ignored — reads from dashboardStore
  isFullscreen?: boolean;
  dimmed?: boolean;
  width?: number;
  height?: number;
  panelIndex?: number;
}

function LiveActivityPanelInner({
  isFullscreen = false,
  dimmed = false,
  width: _width,
  height,
  panelIndex = 2,
}: LiveActivityPanelProps): React.JSX.Element {
  const isFocused = useDashboardStore(s => s.focusedPanel === panelIndex);
  const events = useActivityStore((s) => s.events);
  const scrollIndex = useActivityStore((s) => s.scrollIndex);
  const isFollowing = useActivityStore((s) => s.isFollowing);
  const scrollUp = useActivityStore((s) => s.scrollUp);
  const scrollDown = useActivityStore((s) => s.scrollDown);

  useInput(
    (_, key) => {
      if (key.upArrow) {
        scrollUp();
      } else if (key.downArrow) {
        scrollDown();
      }
    },
    { isActive: isFocused && !dimmed },
  );

  // 2 border rows + 1 header + 1 footer + 2 buffer = 6 overhead rows
  // Extra 2-row buffer prevents Ink layout jitter when content fills the panel completely
  const visibleRows = height != null ? Math.max(1, height - 6) : ACTIVITY_VISIBLE_ROWS;
  const visibleEvents = events.slice(scrollIndex, scrollIndex + visibleRows);

  return (
    <Box
      borderStyle="round"
      borderColor={dimmed ? 'gray' : isFocused ? 'cyan' : 'gray'}
      flexDirection="column"
      height={height}
      overflow="hidden"
    >
      <Text bold dimColor={dimmed}>
        {' '}Live Activity{isFollowing ? '' : ' (scrolled)'}
        {isFullscreen ? ' [fullscreen]' : ''}
      </Text>
      <Box flexDirection="column" overflow="hidden" flexGrow={1}>
        {events.length === 0 ? (
          <Text dimColor> Waiting for activity...</Text>
        ) : (
          visibleEvents.map((e) =>
            e.completionData ? (
              <CompletionCard
                key={e.id}
                storyTitle={e.completionData.storyTitle}
                stageDurations={e.completionData.stageDurations}
                totalDurationMs={e.completionData.totalDurationMs}
                totalAttempts={e.completionData.totalAttempts}
              />
            ) : e.isAppLog ? (
              <Text key={e.id} wrap="truncate">
                <Text dimColor>{e.timestamp} </Text>
                <Text color={e.label === 'ERROR' ? 'red' : e.label === 'WARN' ? 'yellow' : 'gray'}>{e.label.padEnd(5)}</Text>
                <Text dimColor={dimmed}> {e.stageName.slice(0, 13).padEnd(13)} {e.icon ? `${e.icon} ` : '- '}{e.message}</Text>
              </Text>
            ) : (
              <Text key={e.id} dimColor={dimmed} wrap="truncate">
                {e.timestamp} {e.team ? `${e.team.slice(0, 2).toUpperCase()}/${e.stageName.slice(0, 6)}`.padEnd(10) : e.stageName.slice(0, 8).padEnd(8)} {e.icon} {e.label}: {e.message}
              </Text>
            ),
          )
        )}
      </Box>
      <Text dimColor> ↑/↓ scroll{isFocused ? ' | [f] fullscreen' : ''}</Text>
    </Box>
  );
}

export const LiveActivityPanel = React.memo(LiveActivityPanelInner, (prev, next) =>
  prev.isFocused === next.isFocused &&
  prev.isFullscreen === next.isFullscreen &&
  prev.dimmed === next.dimmed &&
  prev.width === next.width &&
  prev.height === next.height,
);
