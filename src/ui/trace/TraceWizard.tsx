import React, { useEffect, useState, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

import type { TraceTaskLog } from '@core/TraceTypes.js';
import { ResetService } from '@core/ResetService.js';
import { useAppStore } from '@ui/stores/appStore.js';
import { useTraceData } from './useTraceData.js';
import { useTraceTree, buildVisibleLines } from './useTraceTree.js';
import { TraceTreePanel } from './TraceTreePanel.js';
import { TraceDetailFullscreen } from './TraceDetailFullscreen.js';
import type { VisibleLine, TraceWizardProps } from './TraceTypes.js';

export function TraceWizard({
  onComplete,
  traceService: traceServiceProp,
  projectId: projectIdProp,
  db: dbProp,
  pipelineConfig: pipelineConfigProp,
  eventBus: eventBusProp,
}: TraceWizardProps): React.ReactElement {

  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  // Read from appStore, fall back to props for backwards compat
  const appState = useAppStore.getState();
  const traceService = traceServiceProp ?? appState.traceService!;
  const projectId = projectIdProp ?? appState.projectId ?? 0;
  const db = dbProp ?? appState.db;
  const pipelineConfig = pipelineConfigProp ?? appState.pipelineConfig;
  const eventBus = eventBusProp ?? appState.eventBus;

  const resetService = useMemo(() => {
    if (!db || !pipelineConfig || !eventBus) return null;
    return new ResetService(db, eventBus, pipelineConfig);
  }, [db, pipelineConfig, eventBus]);

  const data = useTraceData(traceService, resetService!, projectId);
  const { storiesByEpic, tasksByStory, loadStoriesForEpic, loadTasksForStory, getTaskLogs } = data;
  const tree = useTraceTree();

  const [currentLogs, setCurrentLogs] = useState<TraceTaskLog[]>([]);

  // Build visible lines from current state
  const visibleLines: VisibleLine[] = buildVisibleLines(
    data.epics,
    storiesByEpic,
    tasksByStory,
    tree.expandedEpics,
    tree.expandedStories,
  );

  // Load stories when epic is expanded
  useEffect(() => {
    for (const epicId of tree.expandedEpics) {
      if (!storiesByEpic.has(epicId)) {
        loadStoriesForEpic(epicId);
      }
    }
  }, [tree.expandedEpics, storiesByEpic, loadStoriesForEpic]);

  // Load tasks when story is expanded
  useEffect(() => {
    for (const storyId of tree.expandedStories) {
      if (!tasksByStory.has(storyId)) {
        loadTasksForStory(storyId);
      }
    }
  }, [tree.expandedStories, tasksByStory, loadTasksForStory]);

  // Auto-select task when focused line is a task
  const focusedLineData = visibleLines[tree.focusedLine];
  useEffect(() => {
    if (focusedLineData?.kind === 'task') {
      tree.selectTask(focusedLineData.node.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.focusedLine, focusedLineData?.kind === 'task' ? focusedLineData.node.id : null]);

  // Load logs when detail view is open
  useEffect(() => {
    if (tree.showDetail && tree.selectedTaskId !== null) {
      setCurrentLogs(getTaskLogs(tree.selectedTaskId));
    }
  }, [tree.showDetail, tree.selectedTaskId, getTaskLogs]);

  // Get selected task
  const selectedTask = tree.selectedTaskId !== null
    ? (() => {
        for (const tasks of data.tasksByStory.values()) {
          const found = tasks.find((t) => t.id === tree.selectedTaskId);
          if (found) return found;
        }
        return null;
      })()
    : null;

  const pageSize = Math.max(1, Math.floor((rows - 6) / 2));

  // Detail view input
  useInput((input, key) => {
    if (input === 'q' || input === 'Q') {
      tree.closeDetail();
      return;
    }
    if (key.upArrow) {
      tree.scrollDetailPageUp(pageSize);
      return;
    }
    if (key.downArrow) {
      tree.scrollDetailPageDown(pageSize, 9999);
      return;
    }
  }, { isActive: tree.showDetail });

  // Tree view input
  useInput((input, key) => {
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
      onComplete();
      return;
    }

    if (input === 'r' || input === 'R') {
      data.refresh();
      return;
    }

    if (key.upArrow) {
      tree.moveFocusUp();
      return;
    }
    if (key.downArrow) {
      tree.moveFocusDown(visibleLines.length);
      return;
    }

    if (key.return) {
      if (!focusedLineData) return;
      if (focusedLineData.kind === 'epic') tree.toggleEpic(focusedLineData.node.id);
      else if (focusedLineData.kind === 'story') tree.toggleStory(focusedLineData.node.id);
      return;
    }

    if (input === 'd' || input === 'D') {
      if (tree.selectedTaskId !== null) {
        tree.openDetail();
      }
      return;
    }

    if (input === 'm' || input === 'M') {
      if (focusedLineData?.kind === 'task') {
        data.markTaskDone(focusedLineData.node.storyId, focusedLineData.node.id);
      } else if (focusedLineData?.kind === 'story') {
        data.markStoryDone(focusedLineData.node.epicId, focusedLineData.node.id);
      }
      return;
    }
  }, { isActive: !tree.showDetail });

  // ---------- Fullscreen Detail ----------
  if (tree.showDetail && selectedTask !== null) {
    return (
      <TraceDetailFullscreen
        task={selectedTask}
        logs={currentLogs}
        scrollIndex={tree.detailScrollIndex}
        height={rows - 2}
      />
    );
  }

  // ---------- Tree View ----------
  const summary = data.summary;
  const totalEpics = summary?.totalEpics ?? data.epics.length;
  const totalStories = summary?.totalStories ?? 0;
  const totalTasks = summary?.totalTasks ?? 0;

  return (
    <Box flexDirection="column" width="100%" height={rows - 2}>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        flexGrow={1}
        overflow="hidden"
        paddingX={1}
      >
        <Text bold color="cyan">Task Navigator</Text>
        <TraceTreePanel
          lines={visibleLines}
          focusedLine={tree.focusedLine}
          height={rows - 6}
        />
      </Box>

      {data.error && (
        <Box><Text color="red">Error: {data.error}</Text></Box>
      )}

      <Box flexShrink={0} borderStyle="single" borderColor="gray" width="100%">
        <Text bold color="cyan">trace  </Text>
        <Text color="gray">{totalEpics}E {totalStories}S {totalTasks}T  </Text>
        <Text dimColor>[↑↓] Navigate  [Enter] Expand  [d] Detail  [m] Mark Done  [R] Refresh  [Q] Exit</Text>
      </Box>
    </Box>
  );
}
