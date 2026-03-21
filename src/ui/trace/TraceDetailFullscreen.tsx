import React from 'react';
import { Box, Text } from 'ink';

import { TraceService } from '@core/TraceService.js';
import type { TaskNode, TraceTaskLog } from '@core/TraceTypes.js';

function formatJson(val: string | null | undefined): string {
  if (val === null || val === undefined) return '(none)';
  try {
    return JSON.stringify(JSON.parse(val), null, 2);
  } catch {
    return val;
  }
}

interface TraceDetailFullscreenProps {
  task: TaskNode;
  logs: TraceTaskLog[];
  scrollIndex: number;
  height: number;
}

export function TraceDetailFullscreen({ task, logs, scrollIndex, height }: TraceDetailFullscreenProps): React.ReactElement {
  const color = TraceService.statusColor(task.status);

  const inputLines = formatJson(task.input).split('\n');
  const outputLines = formatJson(task.output).split('\n');

  const logLines = logs.map((log) => {
    const seq = `[${log.sequence}] `;
    const type = log.eventType;
    return `${seq}${type} ${log.eventData}`;
  });

  // Build all scrollable content
  const allLines: string[] = [
    // Metadata section
    `stage:     ${task.stageName}`,
    `status:    ${task.status}`,
    `attempt:   ${task.attempt}/${task.maxAttempts}${task.reworkLabel ? ` [${task.reworkLabel}]` : ''}`,
    `model:     ${task.workerModel ?? '—'}`,
    `duration:  ${TraceService.formatDuration(task.durationMs)}`,
    `started:   ${task.startedAt ?? '—'}`,
    `completed: ${task.completedAt ?? '—'}`,
    `tokens:    in=${task.inputTokens != null ? String(task.inputTokens) : '—'}  out=${task.outputTokens != null ? String(task.outputTokens) : '—'}`,
    '',
    '── Output ──',
    ...outputLines,
    '',
    '── Input ──',
    ...inputLines,
  ];

  if (logLines.length > 0) {
    allLines.push('', `── Logs (${logLines.length}) ──`, ...logLines);
  }

  const contentHeight = Math.max(3, height - 4); // 2 header + 1 footer + 1 buffer
  const maxOffset = Math.max(0, allLines.length - contentHeight);
  const clampedOffset = Math.min(scrollIndex, maxOffset);
  const visibleLines = allLines.slice(clampedOffset, clampedOffset + contentHeight);

  const scrollPct = allLines.length <= contentHeight
    ? 100
    : Math.round((clampedOffset / maxOffset) * 100);

  return (
    <Box flexDirection="column" width="100%" height={height}>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        flexGrow={1}
        overflow="hidden"
        paddingX={1}
      >
        <Box justifyContent="space-between" width="100%">
          <Text bold color="cyan">Task #{task.id} Details</Text>
          <Text bold color={color}>{task.status}</Text>
        </Box>

        <Box flexDirection="column" overflow="hidden" flexGrow={1}>
          {visibleLines.map((line, i) => (
            <Text
              key={i}
              wrap="truncate"
              color={line.startsWith('──') ? 'cyan' : undefined}
              bold={line.startsWith('──')}
              dimColor={line.startsWith('[') && !line.startsWith('──')}
            >
              {line}
            </Text>
          ))}
        </Box>
      </Box>
      <Box flexShrink={0} borderStyle="single" borderColor="gray" width="100%">
        <Text dimColor>[↑↓] Page scroll  [Q] Back  </Text>
        {allLines.length > contentHeight && (
          <Text color="gray">{clampedOffset + 1}-{Math.min(clampedOffset + contentHeight, allLines.length)}/{allLines.length} ({scrollPct}%)</Text>
        )}
      </Box>
    </Box>
  );
}
