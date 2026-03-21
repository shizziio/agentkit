import React, { useEffect } from 'react';
import { Box, Text } from 'ink';
import { useAppStore } from '@ui/stores/appStore.js';
import { useCrewStore } from '@ui/stores/index.js';
import { RobotChar } from './RobotChar.js';

interface PipelineCrewProps {
  stages: string[];
  dimmed?: boolean;
  width?: number;
}

/**
 * PipelineCrew Component
 *
 * AC1: Renders orchestrator + workers with correct labels and borders
 * AC2: Connection lines (tree branches) render correctly between orchestrator and workers
 * AC4: Switches to compact connection layout when panel width < 40
 * AC5: Propagates dimmed state to all robots and connection lines
 * AC6: Uses React.memo for performance
 */
export const PipelineCrew = React.memo(({
  stages,
  dimmed = false,
  width = 80,
}: PipelineCrewProps) => {
  const eventBus = useAppStore(s => s.eventBus);
  const stagesKey = (stages ?? []).join(',');
  useEffect(() => {
    if (!eventBus) return;
    useCrewStore.getState().init(eventBus, stages ?? []);
    return () => {
      useCrewStore.getState().cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventBus, stagesKey]);

  const workers = useCrewStore((s) => s.workers);
  const globalBlinkPhase = useCrewStore((s) => s.globalBlinkPhase);
  const orchestratorState = useCrewStore((s) => s.orchestratorState());

  const orchestrator = {
    name: 'orchestrator',
    displayName: 'AgentKit',
    state: orchestratorState,
    blinkPhase: orchestratorState === 'running' ? globalBlinkPhase : false,
  };

  const workersWithBlink = workers.map((w) => ({
    ...w,
    blinkPhase: w.state === 'running' ? globalBlinkPhase : false,
  }));

  // Responsive: width < 40 → compact mode
  const isCompact = (width || 80) < 40;
  const color = dimmed ? 'gray' : undefined;
  const dimColor = dimmed;

  return (
    <Box flexDirection="column" alignItems="center" width={width} height={8} overflow="hidden">
      {/* Top: Orchestrator */}
      <RobotChar robot={orchestrator} isOrchestrator dimmed={dimmed} />

      {/* Connection lines */}
      <Box flexDirection="column" alignItems="center" width="100%" height={isCompact ? 1 : 2}>
        {workersWithBlink.length === 0 ? null : (
          <>
            <Text color={color} dimColor={dimColor}>  │  </Text>
            {workersWithBlink.length > 1 && (
              isCompact ? (
                <Text color={color} dimColor={dimColor}>┌─┴─┐</Text>
              ) : (
                <Box justifyContent="center">
                  <Text color={color} dimColor={dimColor}>
                    {'┌' + '─'.repeat(Math.max(1, Math.floor((width || 80) * 0.7))) + '┐'}
                  </Text>
                </Box>
              )
            )}
          </>
        )}
      </Box>

      {/* Workers in a row, spaced evenly */}
      <Box flexDirection="row" justifyContent="space-around" width="100%">
        {workersWithBlink.map((worker) => (
          <RobotChar key={worker.name} robot={worker} dimmed={dimmed} />
        ))}
      </Box>
    </Box>
  );
});

PipelineCrew.displayName = 'PipelineCrew';
