import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import { useActivityStore } from '@stores/activityStore.js';
import type { ActivityEvent } from '@stores/activityStore.js';

interface LiveActivityFullscreenProps {
  isActive?: boolean;
}

function getVisibleLines(): number {
  const rows = process.stdout.rows ?? 24;
  return Math.max(1, rows - 4);
}

function deriveWorkers(events: ActivityEvent[]): string[] {
  const seen = new Set<string>();
  const workers: string[] = [];
  for (const e of events) {
    if (!seen.has(e.stageName)) {
      seen.add(e.stageName);
      workers.push(e.stageName);
    }
  }
  return workers;
}

export function LiveActivityFullscreen({
  isActive = true,
}: LiveActivityFullscreenProps): React.JSX.Element {
  const allEvents = useActivityStore((s) => s.events);
  const [focusedWorkerIndex, setFocusedWorkerIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const visibleLines = getVisibleLines();
  const workers = deriveWorkers(allEvents);

  const filteredEvents =
    focusedWorkerIndex === 0
      ? allEvents
      : allEvents.filter((e) => {
          const workerName = workers[focusedWorkerIndex - 1];
          return workerName !== undefined && e.stageName === workerName;
        });

  const workerLabel =
    focusedWorkerIndex === 0
      ? 'All'
      : (workers[focusedWorkerIndex - 1] ?? 'All');

  const maxOffset = Math.max(0, filteredEvents.length - visibleLines);
  const clampedOffset = Math.min(scrollOffset, maxOffset);

  const visibleEvents = filteredEvents.slice(clampedOffset, clampedOffset + visibleLines);

  useInput((_input, key) => {
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setScrollOffset((prev) => Math.min(prev + 1, maxOffset));
    } else if (key.leftArrow) {
      const totalOptions = workers.length + 1;
      setFocusedWorkerIndex((prev) => (prev - 1 + totalOptions) % totalOptions);
      setScrollOffset(0);
    } else if (key.rightArrow) {
      const totalOptions = workers.length + 1;
      setFocusedWorkerIndex((prev) => (prev + 1) % totalOptions);
      setScrollOffset(0);
    }
  }, { isActive });

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Box flexShrink={0} flexDirection="row" justifyContent="space-between">
        <Text bold>Live Activity — Fullscreen</Text>
        <Text> Worker: {workerLabel}</Text>
      </Box>

      <Box height={visibleLines} overflow="hidden" flexDirection="column">
        {visibleEvents.length === 0 ? (
          <Text dimColor> No activity yet...</Text>
        ) : (
          visibleEvents.map((e) => (
            <Text key={e.id} wrap="truncate">
              {e.timestamp} {e.stageName} {e.icon} {e.label}: {e.message}
            </Text>
          ))
        )}
      </Box>

      <Box flexShrink={0}>
        <Text dimColor>
          [F] Exit fullscreen {'  '}[Esc] Back {'  '}[←][→] Worker {'  '}[↑][↓] Scroll {'  '}Worker: {workerLabel}
        </Text>
      </Box>
    </Box>
  );
}
