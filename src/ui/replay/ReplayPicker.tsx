import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { eq, and, desc } from 'drizzle-orm';

import { tasks, stories, epics } from '@core/db/schema.js';
import { ReplayService } from '@core/ReplayService.js';
import { ReplayApp } from './ReplayApp.js';
import { useDb, useProjectId } from '@ui/stores/appStore.js';

interface RecentTask {
  id: number;
  storyKey: string;
  title: string;
  stageName: string;
  completedAt: string | null;
}

type Step = 'list' | 'replay';

const VISIBLE_LIST = 10;
const MAX_RECENT = 20;

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

export interface ReplayPickerProps {
  onQuit: () => void;
}

export function ReplayPicker({ onQuit }: ReplayPickerProps): React.JSX.Element {
  const db = useDb();
  const projectId = useProjectId();
  const replayServiceRef = useRef<ReplayService | null>(null);
  const [step, setStep] = useState<Step>('list');
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);

  useEffect(() => {
    const rows = db
      .select({
        id: tasks.id,
        storyKey: stories.storyKey,
        title: stories.title,
        stageName: tasks.stageName,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .innerJoin(epics, eq(stories.epicId, epics.id))
      .where(and(eq(tasks.status, 'done'), eq(tasks.superseded, 0), eq(epics.projectId, projectId)))
      .orderBy(desc(tasks.completedAt))
      .limit(MAX_RECENT)
      .all();
    setRecentTasks(rows);
  }, [db, projectId]);

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setCursor((c) => {
          const next = Math.max(0, c - 1);
          setScrollOffset((o) => (next < o ? next : o));
          return next;
        });
      } else if (key.downArrow) {
        setCursor((c) => {
          const next = Math.min(recentTasks.length - 1, c + 1);
          setScrollOffset((o) => (next >= o + VISIBLE_LIST ? next - VISIBLE_LIST + 1 : o));
          return next;
        });
      } else if (key.return) {
        const task = recentTasks[cursor];
        if (task) {
          if (!replayServiceRef.current) {
            replayServiceRef.current = new ReplayService(db);
          }
          const found = replayServiceRef.current.getTask(task.id);
          if (!found) {
            setTaskError(`Task ${task.id} not found — it may have been deleted.`);
            return;
          }
          setSelectedTaskId(task.id);
          setStep('replay');
        }
      } else if (key.escape || _input === 'q' || _input === 'Q') {
        onQuit();
      }
    },
    { isActive: step === 'list' },
  );

  if (step === 'replay' && selectedTaskId !== null) {
    if (!replayServiceRef.current) {
      replayServiceRef.current = new ReplayService(db);
    }
    return <ReplayApp replayService={replayServiceRef.current} taskId={selectedTaskId} onQuit={onQuit} />;
  }

  if (recentTasks.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">Replay</Text>
        <Text dimColor>No recent tasks found.</Text>
        <Text color="gray">[Esc] Close</Text>
      </Box>
    );
  }

  const visibleTasks = recentTasks.slice(scrollOffset, scrollOffset + VISIBLE_LIST);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">Replay — Recent Done Tasks</Text>
      {taskError && <Text color="red">{taskError}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {visibleTasks.map((task, i) => {
          const actualIdx = scrollOffset + i;
          const isCursor = actualIdx === cursor;
          const date = task.completedAt ? task.completedAt.slice(0, 10) : '—';
          return (
            <Box key={task.id}>
              <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                {isCursor ? '>' : ' '}
                {String(task.id).padEnd(6)}
                {task.storyKey.padEnd(10)}
                {truncate(task.title, 28).padEnd(30)}
                {task.stageName.padEnd(8)}
                {date}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Text color="gray">[↑↓] Navigate  [Enter] Replay  [Esc] Close</Text>
    </Box>
  );
}
