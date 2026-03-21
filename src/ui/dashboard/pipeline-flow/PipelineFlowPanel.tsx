import React from 'react';
import { Box, Text } from 'ink';

import { QUEUE_WARN_THRESHOLD, QUEUE_DANGER_THRESHOLD } from '@config/defaults.js';
import type { PipelineFlowPanelProps } from './PipelineFlowTypes.js';
import type { StageFlowState } from './PipelineFlowTypes.js';
import { usePipelineFlow } from '../hooks/usePipelineFlow.js';

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function getQueueColor(count: number): string | undefined {
  if (count >= QUEUE_DANGER_THRESHOLD) return 'red';
  if (count >= QUEUE_WARN_THRESHOLD) return 'yellow';
  return undefined;
}

function StageBox({ stage }: { stage: StageFlowState }): React.ReactElement {
  const statusIndicator = stage.status === 'busy' ? '●' : '○';
  const statusColor = stage.status === 'busy' ? 'green' : 'gray';
  const queueColor = getQueueColor(stage.queuedCount);

  return (
    <Box flexDirection="column" alignItems="center" paddingX={1}>
      <Text>{stage.icon} {stage.displayName}</Text>
      <Text color={statusColor}>{statusIndicator} {stage.status}</Text>
      <Text color={queueColor}>queued: {stage.queuedCount}</Text>
      {stage.queuedCount > 0 && stage.estimatedTimeMs !== null && (
        <Text dimColor>~{formatTime(stage.estimatedTimeMs)}</Text>
      )}
    </Box>
  );
}

function Arrow(): React.ReactElement {
  return (
    <Box alignItems="center" paddingX={0}>
      <Text dimColor> → </Text>
    </Box>
  );
}

export function PipelineFlowPanel({ stages, eventBus, db, activeTeam = '', width, height }: PipelineFlowPanelProps): React.ReactElement {
  const flowStates = usePipelineFlow(stages, eventBus, db, activeTeam ?? '');

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={width} height={height} overflow="hidden">
      <Text bold> Pipeline Flow</Text>
      <Box flexDirection="row" justifyContent="center">
        {flowStates.map((stage, index) => (
          <React.Fragment key={stage.stageName}>
            <StageBox stage={stage} />
            {index < flowStates.length - 1 && <Arrow />}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
