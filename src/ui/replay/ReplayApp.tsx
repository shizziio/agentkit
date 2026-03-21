import React, { useMemo } from 'react';
import { Box, useStdout } from 'ink';
import chalk from 'chalk';

import type { ReplayService } from '@core/ReplayService.js';
import type { ReplayEvent } from './ReplayTypes.js';
import { useReplayPlayer } from './useReplayPlayer.js';
import { TaskMetadataHeader } from './TaskMetadataHeader.js';
import { ReplayProgressBar } from './ReplayProgressBar.js';
import { ScrollablePanel } from '../shared/ScrollablePanel.js';

interface ReplayAppProps {
  replayService: ReplayService;
  taskId: number;
  onQuit: () => void;
}

function getEventColor(eventType: string): string {
  switch (eventType) {
    case 'thinking':
      return 'magenta';
    case 'tool_use':
      return 'cyan';
    case 'tool_result':
      return 'green';
    case 'text':
      return 'white';
    case 'error':
      return 'red';
    default:
      return 'white';
  }
}

function getEventLines(event: ReplayEvent): string[] {
  const data = event.eventData;
  switch (event.eventType) {
    case 'thinking': {
      const thinking = typeof data['thinking'] === 'string' ? data['thinking'] : '';
      return thinking ? thinking.split('\n') : ['(empty thinking)'];
    }
    case 'tool_use': {
      const toolName = typeof data['toolName'] === 'string' ? data['toolName'] : '';
      const toolInput = data['toolInput'] ?? {};
      return [toolName, JSON.stringify(toolInput)];
    }
    case 'tool_result': {
      const content = typeof data['content'] === 'string' ? data['content'] : '';
      return content ? content.split('\n') : ['(empty result)'];
    }
    case 'text': {
      const text = typeof data['text'] === 'string' ? data['text'] : '';
      return text ? text.split('\n') : [''];
    }
    case 'error': {
      const error = typeof data['error'] === 'string' ? data['error'] : 'unknown error';
      return [error];
    }
    default:
      return [`(${event.eventType})`];
  }
}

export function ReplayApp({ replayService, taskId, onQuit }: ReplayAppProps): React.JSX.Element {
  const { state, currentEvent } = useReplayPlayer({ replayService, taskId, onQuit });
  const { stdout } = useStdout();

  const {
    taskMeta,
    totalEvents,
    loadedEvents,
    currentIndex,
    playbackState,
    speed,
    firstTimestampMs,
    lastTimestampMs,
  } = state;

  const displayEvents = useMemo(() => {
    return currentIndex >= 0 ? loadedEvents.slice(0, currentIndex + 1) : [];
  }, [loadedEvents, currentIndex]);

  const eventLines = useMemo(() => {
    const allLines: string[] = [];
    displayEvents.forEach((event: ReplayEvent) => {
      const ts = new Date(event.createdAt).toISOString().slice(11, 19);
      const color = getEventColor(event.eventType);
      const chalkFn = 
        color === 'magenta' ? chalk.magenta :
        color === 'cyan' ? chalk.cyan :
        color === 'green' ? chalk.green :
        color === 'red' ? chalk.red : chalk.white;
      
      const lines = getEventLines(event);
      
      allLines.push(chalk.gray(` [${ts}] [${taskMeta.stageName}#${taskMeta.taskId}]`));
      lines.forEach(l => allLines.push(chalkFn(l)));
      allLines.push(' '); // Spacer
    });
    return allLines;
  }, [displayEvents, taskMeta.stageName, taskMeta.taskId]);

  const detailLines = useMemo(() => {
    if (playbackState === 'paused' && currentEvent !== null) {
      return JSON.stringify(currentEvent.eventData, null, 2).split('\n').map(l => chalk.yellow(l));
    }
    return [];
  }, [playbackState, currentEvent]);

  // Combined lines for the scrollable panel
  const allDisplayLines = useMemo(() => {
    if (detailLines.length > 0) {
      return [...eventLines, chalk.bold.yellow(' ──────── EVENT DETAIL (paused) ────────'), ...detailLines];
    }
    return eventLines;
  }, [eventLines, detailLines]);

  const availableHeight = stdout?.rows ? stdout.rows - 8 : 15;
  const currentTs = currentEvent?.createdAt ?? firstTimestampMs;

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <TaskMetadataHeader meta={taskMeta} playbackState={playbackState} speed={speed} />

      <Box flexGrow={1} overflow="hidden" flexDirection="column">
        <ScrollablePanel
          lines={allDisplayLines}
          height={availableHeight}
          autoScrollToBottom={playbackState === 'playing'}
          onExit={onQuit}
          title="Playback logs"
        />
      </Box>

      <ReplayProgressBar
        currentIndex={currentIndex}
        totalEvents={totalEvents}
        firstTimestampMs={firstTimestampMs}
        lastTimestampMs={lastTimestampMs}
        currentTimestampMs={currentTs}
      />
    </Box>
  );
}
