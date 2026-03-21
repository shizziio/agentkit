import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import type { MarkDoneResult, MarkableStory, EpicMarkInfo } from '@core/MarkDoneTypes.js';
import { useProjectId, useMarkDoneService } from '@ui/stores/appStore.js';

interface EpicGroup {
  epicKey: string;
  epicTitle: string;
  epicId: number;
  stories: MarkableStory[];
}

export interface MarkDoneWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  compact?: boolean;
}

type WizardStep = 'select' | 'marking' | 'done';

type FlatNode =
  | { kind: 'epic'; group: EpicGroup }
  | { kind: 'story'; story: MarkableStory }
  | { kind: 'section-header'; label: string }
  | { kind: 'eligible-epic'; epic: EpicMarkInfo };

const VISIBLE_ROWS = 10;

export function MarkDoneWizard({
  onComplete,
  onCancel,
  compact = false,
}: MarkDoneWizardProps): React.JSX.Element {
  const projectId = useProjectId();
  const markDoneService = useMarkDoneService();
  const [step, setStep] = useState<WizardStep>('select');
  const [groups, setGroups] = useState<EpicGroup[]>([]);
  const [eligibleEpics, setEligibleEpics] = useState<EpicMarkInfo[]>([]);
  const [expandedEpics, setExpandedEpics] = useState<Set<string>>(new Set());
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<number>>(new Set());
  const [selectedEpicIds, setSelectedEpicIds] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [result, setResult] = useState<MarkDoneResult | null>(null);
  const [error, setError] = useState('');

  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;

    const markableStories = markDoneService.getMarkableStories(projectId);
    const groupMap = new Map<string, EpicGroup>();
    for (const story of markableStories) {
      if (!groupMap.has(story.epicKey)) {
        groupMap.set(story.epicKey, {
          epicKey: story.epicKey,
          epicTitle: story.epicTitle,
          epicId: story.epicId,
          stories: [],
        });
      }
      groupMap.get(story.epicKey)!.stories.push(story);
    }
    const sorted = Array.from(groupMap.values()).sort((a, b) =>
      a.epicKey.localeCompare(b.epicKey),
    );
    setGroups(sorted);
    setExpandedEpics(new Set(sorted.map((g) => g.epicKey)));

    const allEpics = markDoneService.getMarkableEpics(projectId);
    setEligibleEpics(allEpics.filter((e) => e.allDone));
  }, [markDoneService, projectId]);

  const flatList = useMemo<FlatNode[]>(() => {
    const list: FlatNode[] = [];
    for (const group of groups) {
      list.push({ kind: 'epic', group });
      if (expandedEpics.has(group.epicKey)) {
        for (const story of group.stories) {
          list.push({ kind: 'story', story });
        }
      }
    }
    if (eligibleEpics.length > 0) {
      list.push({ kind: 'section-header', label: 'Epics ready to mark done:' });
      for (const epic of eligibleEpics) {
        list.push({ kind: 'eligible-epic', epic });
      }
    }
    return list;
  }, [groups, expandedEpics, eligibleEpics]);

  useEffect(() => {
    if (flatList.length === 0) return;
    setCursor((c) => Math.min(c, flatList.length - 1));
  }, [flatList.length]);

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.downArrow) {
        setCursor((c) => Math.min(flatList.length - 1, c + 1));
      } else if (input === ' ') {
        const node = flatList[cursor];
        if (!node) return;
        if (node.kind === 'epic') {
          const epicKey = node.group.epicKey;
          setExpandedEpics((prev) => {
            const next = new Set(prev);
            if (next.has(epicKey)) next.delete(epicKey);
            else next.add(epicKey);
            return next;
          });
        } else if (node.kind === 'story') {
          setSelectedStoryIds((prev) => {
            const next = new Set(prev);
            if (next.has(node.story.id)) next.delete(node.story.id);
            else next.add(node.story.id);
            return next;
          });
        } else if (node.kind === 'eligible-epic') {
          setSelectedEpicIds((prev) => {
            const next = new Set(prev);
            if (next.has(node.epic.id)) next.delete(node.epic.id);
            else next.add(node.epic.id);
            return next;
          });
        }
        // section-header: do nothing
      } else if (input.toLowerCase() === 'a') {
        const allStoryIds = groups.flatMap((g) => g.stories.map((s) => s.id));
        setSelectedStoryIds(new Set(allStoryIds));
      } else if (input.toLowerCase() === 'n') {
        setSelectedStoryIds(new Set());
        setSelectedEpicIds(new Set());
      } else if (key.return) {
        if (selectedStoryIds.size > 0 || selectedEpicIds.size > 0) {
          setStep('marking');
        }
      } else if (key.escape) {
        onCancel();
      }
    },
    { isActive: step === 'select' },
  );

  const markingRan = useRef(false);
  useEffect(() => {
    if (step !== 'marking' || markingRan.current) return;
    markingRan.current = true;

    try {
      if (selectedStoryIds.size > 0) {
        markDoneService.markStoriesDone(Array.from(selectedStoryIds));
      }
      for (const epicId of selectedEpicIds) {
        markDoneService.markEpicDone(epicId);
      }
      setResult({ storiesMarked: selectedStoryIds.size, epicsMarked: selectedEpicIds.size });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setResult({ storiesMarked: 0, epicsMarked: 0 });
    }
    setStep('done');
  }, [step, markDoneService, selectedStoryIds, selectedEpicIds]);

  useInput(
    () => {
      onComplete();
    },
    { isActive: step === 'done' },
  );

  if (step === 'select') {
    if (flatList.length === 0) {
      return (
        <Box flexDirection="column" padding={compact ? 0 : 1}>
          <Text bold>Mark Stories / Epics as Done</Text>
          <Text color="yellow">No stories or epics available to mark done.</Text>
          <Text color="gray">[Esc] Cancel</Text>
        </Box>
      );
    }

    const startIdx = Math.min(
      Math.max(0, cursor - Math.floor(VISIBLE_ROWS / 2)),
      Math.max(0, flatList.length - VISIBLE_ROWS),
    );
    const endIdx = Math.min(flatList.length, startIdx + VISIBLE_ROWS);
    const visible = flatList.slice(startIdx, endIdx);

    return (
      <Box flexDirection="column" padding={compact ? 0 : 1}>
        <Text bold>
          Mark Stories / Epics as Done ({selectedStoryIds.size} stories,{' '}
          {selectedEpicIds.size} epics selected)
        </Text>
        {visible.map((node, i) => {
          const actualIdx = startIdx + i;
          const isCursor = actualIdx === cursor;

          if (node.kind === 'epic') {
            const expanded = expandedEpics.has(node.group.epicKey);
            return (
              <Box key={`epic-${node.group.epicKey}`}>
                <Text color={isCursor ? 'cyan' : undefined}>
                  {isCursor ? '> ' : '  '}[{expanded ? '-' : '+'}] {node.group.epicKey}:{' '}
                  {node.group.epicTitle}
                </Text>
              </Box>
            );
          }

          if (node.kind === 'story') {
            const isSelected = selectedStoryIds.has(node.story.id);
            return (
              <Box key={`story-${node.story.id}`}>
                <Text color={isCursor ? 'cyan' : undefined}>
                  {isCursor ? '  > ' : '    '}[{isSelected ? 'x' : ' '}] {node.story.epicKey}/
                  {node.story.storyKey} {node.story.title} {node.story.status}
                </Text>
              </Box>
            );
          }

          if (node.kind === 'section-header') {
            return (
              <Box key="section-header">
                <Text color="gray">{node.label}</Text>
              </Box>
            );
          }

          // eligible-epic
          const isSelected = selectedEpicIds.has(node.epic.id);
          return (
            <Box key={`eligible-epic-${node.epic.id}`}>
              <Text color={isCursor ? 'cyan' : undefined}>
                {isCursor ? '  > ' : '    '}[{isSelected ? 'x' : ' '}] Epic {node.epic.epicKey}:{' '}
                {node.epic.title} ({node.epic.doneStories}/{node.epic.totalStories} stories done)
              </Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text color="gray">
            [↑↓] Nav  [Space] Toggle  [A] All Stories  [N] None  [Enter] Mark Done  [Esc] Cancel
          </Text>
        </Box>
      </Box>
    );
  }

  if (step === 'marking') {
    return (
      <Box flexDirection="column" padding={compact ? 0 : 1}>
        <Text>Marking done...</Text>
      </Box>
    );
  }

  // done step
  return (
    <Box flexDirection="column" padding={compact ? 0 : 1}>
      {error ? (
        <Text color="red">{error}</Text>
      ) : (
        <Text color="green">
          Marked {result?.storiesMarked ?? 0} stories and {result?.epicsMarked ?? 0} epics as done.
        </Text>
      )}
      <Text color="gray">Press any key to exit...</Text>
    </Box>
  );
}
