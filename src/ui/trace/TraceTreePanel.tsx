import React from 'react';
import { Box, Text, useStdout } from 'ink';

import { TraceService } from '@core/TraceService.js';
import type { VisibleLine, TraceTreePanelProps } from './TraceTypes.js';
import { formatLocalTime } from '@shared/FormatTime.js';

const INDENT = '  ';

function statusBadge(status: string): string {
  switch (status) {
    case 'done': return '✓';
    case 'running': return '●';
    case 'failed': return '✗';
    case 'queued': return '○';
    case 'blocked': return '!';
    default: return '·';
  }
}

function renderLine(line: VisibleLine, isFocused: boolean, showTeamOnTask = false): React.ReactElement {
  const indent = INDENT.repeat(line.depth);
  const focusPrefix = isFocused ? '▶ ' : '  ';

  if (line.kind === 'epic') {
    const expand = line.isExpanded ? '▼' : '▶';
    const pct = `${line.node.completionPct}%`;
    const stories = `(${line.node.storyCount} stories)`;
    const color = TraceService.statusColor(line.node.status);
    return (
      <Box key={`epic-${line.node.id}`}>
        <Text color={isFocused ? 'cyan' : undefined} bold={isFocused}>
          {focusPrefix}{indent}{expand} {' '}
        </Text>
        <Text color={color} bold>
          [{line.node.epicKey}]
        </Text>
        <Text color={isFocused ? 'cyan' : undefined} bold={isFocused}>
          {' '}{line.node.title}{' '}
        </Text>
        <Text dimColor>{stories} {pct}</Text>
      </Box>
    );
  }

  if (line.kind === 'story') {
    const expand = line.isExpanded ? '▼' : '▶';
    const color = TraceService.statusColor(line.node.status);
    const dur = line.node.totalDurationMs !== null
      ? ` ${TraceService.formatDuration(line.node.totalDurationMs)}`
      : '';
    return (
      <Box key={`story-${line.node.id}`}>
        <Text color={isFocused ? 'cyan' : undefined} bold={isFocused}>
          {focusPrefix}{indent}{expand} {' '}
        </Text>
        <Text color={color}>
          {statusBadge(line.node.status)}
        </Text>
        <Text color={isFocused ? 'cyan' : undefined} bold={isFocused}>
          {' '}{line.node.storyKey} {line.node.title}
        </Text>
        <Text dimColor>{dur}</Text>
      </Box>
    );
  }

  // task
  const isSuperseded = line.node.superseded === true;
  const color = TraceService.statusColor(line.node.status);
  const rework = line.node.reworkLabel ? ` [${line.node.reworkLabel}]` : '';
  const dur = line.node.durationMs !== null
    ? ` ${TraceService.formatDuration(line.node.durationMs)}`
    : '';
  const model = line.node.workerModel ? ` (${line.node.workerModel})` : '';
  return (
    <Box key={`task-${line.node.id}`}>
      <Text color={isFocused ? 'cyan' : undefined} bold={isFocused}>
        {focusPrefix}{indent}
      </Text>
      <Text color={color} dimColor={isSuperseded}>
        {statusBadge(line.node.status)}
      </Text>
      <Text color={isSuperseded ? 'gray' : (isFocused ? 'cyan' : undefined)} bold={isFocused && !isSuperseded}>
        {' '}{line.node.stageName}
      </Text>
      <Text dimColor>
        {rework}{dur}{model}
      </Text>
      {line.node.sessionName ? (
        <Text dimColor> {line.node.attempt > 1 ? '🔄' : '🆕'}</Text>
      ) : null}
      {line.node.completedAt !== null && (
        <Text dimColor>{` @${formatLocalTime(line.node.completedAt)}`}</Text>
      )}
      {showTeamOnTask && line.node.team !== '' && (
        <Text dimColor> [{line.node.team}]</Text>
      )}
      {isSuperseded && <Text color="gray"> [superseded]</Text>}
    </Box>
  );
}

export function TraceTreePanel({ lines, focusedLine, showTeamOnTask = false, height }: TraceTreePanelProps): React.ReactElement {
  const { stdout } = useStdout();
  const visibleHeight = height != null ? Math.max(3, height) : Math.max(5, (stdout.rows ?? 24) - 6);
  const startOffset = Math.max(0, focusedLine - Math.floor(visibleHeight / 2));
  const visibleLines = lines.slice(startOffset, startOffset + visibleHeight);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {lines.length === 0 && (
        <Box>
          <Text dimColor>No data. Run `agentkit load` to import a pipeline.</Text>
        </Box>
      )}
      {visibleLines.map((line, idx) => {
        const absoluteIdx = startOffset + idx;
        const isFocused = absoluteIdx === focusedLine;
        return (
          <Box key={`line-${absoluteIdx}`}>
            {renderLine(line, isFocused, showTeamOnTask)}
          </Box>
        );
      })}
    </Box>
  );
}
