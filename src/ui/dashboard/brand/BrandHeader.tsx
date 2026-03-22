import React from 'react';
import { Box, Text } from 'ink';

import { APP_NAME, APP_VERSION, DASHBOARD_CHROME_ROWS } from '@config/defaults.js';
import { useAppStore } from '@ui/stores/appStore.js';
import { useWorkerStore, formatElapsed } from '@ui/stores/workerStore.js';
import { useDashboardStore } from '@ui/stores/dashboardStore.js';
import { processManager } from '@providers/agent/ProcessManager.js'
import type { PipelineState } from '../shared/DashboardTypes.js';

const TEAM_COLORS: string[] = ['green', 'cyan', 'yellow', 'magenta', 'blue', 'red'];

function getTeamColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length]!;
}

const STATUS_MAP: Record<PipelineState, { dot: string; label: string; color: string }> = {
  stopped: { dot: '○', label: 'Stopped', color: 'gray' },
  running: { dot: '●', label: 'Running', color: 'green' },
  draining: { dot: '⟳', label: 'Draining...', color: 'yellow' },
};

// ---------------------------------------------------------------------------
// Sub-components: each subscribes only to the slice it renders
// ---------------------------------------------------------------------------

/** Static brand info — only re-renders when appStore changes (rare). */
function BrandInfo(): React.JSX.Element {
  const pipelineConfig = useAppStore(s => s.pipelineConfig);
  const projectName = pipelineConfig?.project.name ?? '';
  return (
    <Box gap={1} alignItems="center">
      <Text bold color="cyan">{APP_NAME}</Text>
      <Text dimColor>v{APP_VERSION}</Text>
      <Text dimColor>·</Text>
      <Text bold>{projectName}</Text>
    </Box>
  );
}
const BrandInfoMemo = React.memo(BrandInfo);

/** Worker status badges — re-renders only when workerStatuses changes. */
function WorkerStatusBar(): React.JSX.Element | null {
  const workerStatuses = useWorkerStore(s => s.workerStatuses);
  if (workerStatuses.length === 0) return null;
  return (
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
  );
}
const WorkerStatusBarMemo = React.memo(WorkerStatusBar);

/** Queue counters — re-renders only when queueStats changes. */
function QueueStatsBar(): React.JSX.Element | null {
  const pipelineState = useWorkerStore(s => s.pipelineState);
  const queueStats = useWorkerStore(s => s.queueStats);
  if (pipelineState === 'stopped' || queueStats === null) return null;
  return (
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
  );
}
const QueueStatsBarMemo = React.memo(QueueStatsBar);

/** Pipeline status dot — re-renders only when pipelineState changes. */
function PipelineStatusDot(): React.JSX.Element {
  const pipelineState = useWorkerStore(s => s.pipelineState);
  const { dot, label, color } = STATUS_MAP[pipelineState];
  return <Text color={color} bold>{dot} {label}</Text>;
}
const PipelineStatusDotMemo = React.memo(PipelineStatusDot);

/** Team + provider + session info — re-renders only when appStore/config changes. */
function MetaInfo(): React.JSX.Element {
  const pipelineConfig = useAppStore(s => s.pipelineConfig);
  const projectConfig = useAppStore(s => s.projectConfig);
  const workerStatuses = useWorkerStore(s => s.workerStatuses);

  const activeProvider = pipelineConfig?.provider ?? '';
  const activeTeam = pipelineConfig?.team ?? '';
  const activeTeams = projectConfig?.activeTeams ?? [activeTeam];
  const isMultiTeam = activeTeams.length > 1;
  const sessionMax = processManager.getMaxConcurrent();

  return (
    <>
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
          <Text color="cyan" bold>{workerStatuses.filter(w => w.status === 'run').length}/{sessionMax}</Text>
        </Box>
      )}
    </>
  );
}
const MetaInfoMemo = React.memo(MetaInfo);

/** Hint line — subscribes to dashboardStore.actionMode only. */
function HintLine(): React.JSX.Element {
  const isActionActive = useDashboardStore(s => s.actionMode !== 'none');
  const hint = isActionActive
    ? '[Q] Back'
    : '[↑↓] Navigate  [Enter] Select  [Q] Back/Quit';
  return <Text dimColor>{hint}</Text>;
}
const HintLineMemo = React.memo(HintLine);

// ---------------------------------------------------------------------------
// BrandHeader shell — ZERO store subscriptions, renders fixed layout only
// ---------------------------------------------------------------------------

function BrandHeaderInner(): React.JSX.Element {
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
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        <BrandInfoMemo />
        <WorkerStatusBarMemo />
        <Box gap={3} alignItems="center">
          <QueueStatsBarMemo />
          <MetaInfoMemo />
          <PipelineStatusDotMemo />
        </Box>
      </Box>
      <HintLineMemo />
    </Box>
  );
}

export const BrandHeader = React.memo(BrandHeaderInner);
