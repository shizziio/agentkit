import React from 'react';
import { Box, Text } from 'ink';

import { APP_NAME, APP_VERSION, DASHBOARD_CHROME_ROWS } from '@config/defaults.js';
import { useAppStore } from '@ui/stores/appStore.js';
import { useWorkerStore, formatElapsed } from '@ui/stores/workerStore.js';
import { processManager } from '@providers/agent/ProcessManager.js';
import type { PipelineState } from '../shared/DashboardTypes.js';

const TEAM_COLORS: string[] = ['green', 'cyan', 'yellow', 'magenta', 'blue', 'red'];

function getTeamColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length]!;
}

export interface BrandHeaderProps {
  isActionActive?: boolean;
}

const STATUS_MAP: Record<PipelineState, { dot: string; label: string; color: string }> = {
  stopped: { dot: '○', label: 'Stopped', color: 'gray' },
  running: { dot: '●', label: 'Running', color: 'green' },
  draining: { dot: '⟳', label: 'Draining...', color: 'yellow' },
};

function BrandHeaderInner({
  isActionActive = false,
}: BrandHeaderProps): React.JSX.Element {
  const pipelineConfig = useAppStore(s => s.pipelineConfig);
  const pipelineState = useWorkerStore(s => s.pipelineState);
  const workerStatuses = useWorkerStore(s => s.workerStatuses);
  const queueStats = useWorkerStore(s => s.queueStats());

  const projectConfig = useAppStore(s => s.projectConfig);
  const projectName = pipelineConfig?.project.name ?? '';
  const activeProvider = pipelineConfig?.provider ?? '';
  const activeTeam = pipelineConfig?.team ?? '';
  const activeTeams = projectConfig?.activeTeams ?? [activeTeam];
  const isMultiTeam = activeTeams.length > 1;
  const sessionActive = processManager.getActiveCount();
  const sessionMax = processManager.getMaxConcurrent();

  const { dot, label, color } = STATUS_MAP[pipelineState];
  const showQueueStats = pipelineState !== 'stopped';

  const hint = isActionActive
    ? '[Q] Back'
    : '[↑↓] Navigate  [Enter] Select  [Q] Back/Quit';

  return (
    <Box
      flexDirection="column"
      width="100%"
      flexShrink={0}
      height={DASHBOARD_CHROME_ROWS}
      overflow="hidden"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      {/* Single info row: Brand + Workers + Meta */}
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        {/* Left: Brand + Project */}
        <Box gap={1} alignItems="center">
          <Text bold color="cyan">{APP_NAME}</Text>
          <Text dimColor>v{APP_VERSION}</Text>
          <Text dimColor>·</Text>
          <Text bold>{projectName}</Text>
        </Box>

        {/* Center: Worker statuses */}
        {workerStatuses.length > 0 && (
          <Box gap={2} alignItems="center">
            {workerStatuses.map(w => (
              <Box key={w.stageName} gap={1}>
                <Text color={w.status === 'run' ? 'cyan' : 'gray'} bold={w.status === 'run'}>
                  {w.displayName}
                </Text>
                <Text color={w.status === 'run' ? 'green' : 'gray'}>
                  {w.status === 'run' ? `⟳ ${formatElapsed(w.runStartedAt)}` : '—'}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {/* Right: Meta info */}
        <Box gap={3} alignItems="center">
          {queueStats !== null && showQueueStats && (
            <Box gap={1}>
              <Text dimColor>queue:</Text>
              <Text color="yellow" bold>{String(queueStats.queued)}</Text>
              <Text dimColor>done:</Text>
              <Text color="green" bold>{String(queueStats.done)}</Text>
              {queueStats.failed > 0 && (
                <>
                  <Text dimColor>fail:</Text>
                  <Text color="red" bold>{String(queueStats.failed)}</Text>
                </>
              )}
            </Box>
          )}
          {activeProvider !== '' && (
            <Box gap={1}>
              <Text dimColor>provider:</Text>
              <Text color="magenta" bold>{activeProvider}</Text>
            </Box>
          )}
          {isMultiTeam ? (
            <Box gap={1}>
              {activeTeams.map((t, i) => (
                <Text key={t} color={getTeamColor(i)} bold>[{t.slice(0, 2).toUpperCase()} ●]</Text>
              ))}
            </Box>
          ) : activeTeam !== '' ? (
            <Box gap={1}>
              <Text dimColor>team:</Text>
              <Text color="yellow" bold>{activeTeam}</Text>
            </Box>
          ) : null}
          {isMultiTeam && sessionMax !== Infinity && (
            <Box gap={1}>
              <Text dimColor>sessions:</Text>
              <Text color="cyan" bold>{sessionActive}/{sessionMax}</Text>
            </Box>
          )}
          <Text color={color} bold>{dot} {label}</Text>
        </Box>
      </Box>

      {/* Hint line */}
      <Text dimColor>{hint}</Text>
    </Box>
  );
}

export const BrandHeader = React.memo(BrandHeaderInner);
