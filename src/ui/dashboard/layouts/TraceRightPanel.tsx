import React from 'react';
import { Box, Text } from 'ink';

import type { TaskNode, TraceTaskLog } from '@core/TraceTypes.js';
import type { ResetTarget } from '@core/ResetTypes.js';
import { StoryActionPicker } from '../modals/StoryActionPicker.js';
import { TraceDetailPanel } from '@ui/trace/TraceDetailPanel.js';
import { TraceLogsPanel } from '@ui/trace/TraceLogsPanel.js';

interface TraceRightPanelProps {
  showPicker: boolean;
  pickerTargets: ResetTarget[];
  actionStoryKey: string;
  showCancelConfirm: boolean;
  actionError: string;
  rightPanelMode: 'details' | 'logs';
  selectedTask: TaskNode | null;
  currentLogs: TraceTaskLog[];
  logsScrollIndex: number;
  onPickerSelect: (stageName: string) => void;
  onPickerCancel: () => void;
  height?: number;
}

export function TraceRightPanel({
  showPicker,
  pickerTargets,
  actionStoryKey,
  showCancelConfirm,
  actionError,
  rightPanelMode,
  selectedTask,
  currentLogs,
  logsScrollIndex,
  onPickerSelect,
  onPickerCancel,
  height,
}: TraceRightPanelProps): React.JSX.Element {
  if (showPicker) {
    return (
      <StoryActionPicker
        targets={pickerTargets}
        storyKey={actionStoryKey}
        onSelect={onPickerSelect}
        onCancel={onPickerCancel}
      />
    );
  }

  if (showCancelConfirm) {
    return (
      <Box flexDirection="column" paddingX={1} justifyContent="center" alignItems="flex-start">
        <Text bold>Cancel story {actionStoryKey}?</Text>
        <Text dimColor>[Y] Confirm  [Esc] Abort</Text>
      </Box>
    );
  }

  if (actionError) {
    return (
      <Box paddingX={1} justifyContent="center" alignItems="center" height={height}>
        <Text color="red">{actionError}</Text>
      </Box>
    );
  }

  if (rightPanelMode === 'details' && selectedTask !== null) {
    return <TraceDetailPanel task={selectedTask} availableHeight={height} />;
  }

  if (rightPanelMode === 'logs') {
    return <TraceLogsPanel logs={currentLogs} scrollIndex={logsScrollIndex} height={height} />;
  }

  return (
    <Box justifyContent="center" alignItems="center" height={height}>
      <Text dimColor>Navigate to a task to see details</Text>
    </Box>
  );
}
