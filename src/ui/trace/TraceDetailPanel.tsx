import React from 'react';
import { Box, Text, useStdout } from 'ink';

import { TraceService } from '@core/TraceService.js';
import type { TraceDetailPanelProps } from './TraceTypes.js';

function formatJson(val: string | null | undefined): string {
  if (val === null || val === undefined) return '(none)';
  try {
    return JSON.stringify(JSON.parse(val), null, 2);
  } catch {
    return val;
  }
}

const META_ROWS = 12; // rows used by metadata section (header + 10 fields + gap)

export function TraceDetailPanel({ task, scrollIndex = 0, availableHeight }: TraceDetailPanelProps): React.ReactElement {
  const { stdout } = useStdout();
  const color = TraceService.statusColor(task.status);

  const inputLines = formatJson(task.input).split('\n');
  const outputLines = formatJson(task.output).split('\n');

  // All scrollable content lines (label + blank + content + blank between sections)
  const allLines: string[] = [
    '── Input ──',
    ...inputLines,
    '',
    '── Output ──',
    ...outputLines,
  ];

  const panelHeight = availableHeight ?? Math.max(10, (stdout.rows ?? 24) - 4);
  const scrollableHeight = Math.max(1, panelHeight - META_ROWS);
  const maxOffset = Math.max(0, allLines.length - scrollableHeight);
  const clampedOffset = Math.min(scrollIndex, maxOffset);
  const visibleLines = allLines.slice(clampedOffset, clampedOffset + scrollableHeight);

  return (
    <Box flexDirection="column" paddingLeft={1} overflow="hidden" height={panelHeight}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Task #{task.id} Details</Text>
        <Text dimColor>  [l] logs  [↑↓] scroll</Text>
      </Box>

      <Box flexDirection="column">
        <Text wrap="truncate"><Text dimColor>stage:    </Text><Text bold>{task.stageName}</Text></Text>
        <Text wrap="truncate"><Text dimColor>status:   </Text><Text bold color={color}>{task.status}</Text></Text>
        <Text wrap="truncate">
          <Text dimColor>attempt:  </Text>
          <Text bold>{task.attempt}/{task.maxAttempts}</Text>
          {task.reworkLabel ? <Text color="yellow"> [{task.reworkLabel}]</Text> : null}
        </Text>
        <Text wrap="truncate"><Text dimColor>model:    </Text><Text bold>{task.workerModel ?? '—'}</Text></Text>
        <Text wrap="truncate"><Text dimColor>duration: </Text><Text bold>{TraceService.formatDuration(task.durationMs)}</Text></Text>
        <Text wrap="truncate"><Text dimColor>started:  </Text><Text>{task.startedAt ?? '—'}</Text></Text>
        <Text wrap="truncate"><Text dimColor>completed:</Text><Text>{task.completedAt ?? '—'}</Text></Text>
        <Text wrap="truncate"><Text dimColor>tokens in:</Text><Text>{task.inputTokens != null ? String(task.inputTokens) : '—'}</Text></Text>
        <Text wrap="truncate"><Text dimColor>tokens out:</Text><Text>{task.outputTokens != null ? String(task.outputTokens) : '—'}</Text></Text>
        {task.sessionName ? (
          <Text wrap="truncate"><Text dimColor>session:  </Text><Text>{task.attempt > 1 ? '🔄' : '🆕'} {task.sessionName}</Text></Text>
        ) : null}
      </Box>

      <Box flexDirection="column" marginTop={1} overflow="hidden">
        {visibleLines.map((line, i) => (
          <Text key={i} wrap="wrap" color={line.startsWith('──') ? 'cyan' : undefined} dimColor={line.startsWith('──') ? false : undefined}>
            {line}
          </Text>
        ))}
        {maxOffset > 0 && (
          <Text dimColor>{clampedOffset + 1}-{Math.min(clampedOffset + scrollableHeight, allLines.length)}/{allLines.length}</Text>
        )}
      </Box>
    </Box>
  );
}
