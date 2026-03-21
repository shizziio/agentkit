import React, { useMemo } from 'react';
import chalk from 'chalk';
import { ScrollablePanel } from '../shared/ScrollablePanel.js';
import type { TraceLogsPanelProps } from './TraceTypes.js';

export function TraceLogsPanel({ logs, height, isActive }: TraceLogsPanelProps & { isActive?: boolean }): React.ReactElement {
  const lines = useMemo(() => {
    return logs.map((log) => {
      const seq = chalk.dim(`[${log.sequence}] `);
      const type = chalk.cyan(log.eventType);
      const data = log.eventData;
      return `${seq}${type} ${data}`;
    });
  }, [logs]);

  return (
    <ScrollablePanel
      lines={lines}
      height={height ?? 20}
      title="Task Logs"
      isActive={isActive}
      autoScrollToBottom={false}
    />
  );
}
