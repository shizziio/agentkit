import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

import type { DrizzleDB } from '@core/db/Connection.js';
import { ShipService } from '@core/ShipService.js';
import type { StoryWithEpic, ShipResult } from '@core/ShipTypes.js';

interface EpicGroup {
  epicKey: string;
  epicTitle: string;
  epicId: number;
  stories: StoryWithEpic[];
}

export interface ShipTreePickerProps {
  projectId: number;
  db: DrizzleDB;
  firstStageName: string;
  activeTeam: string;
  onComplete: () => void;
  onCancel: () => void;
  compact?: boolean;
  height?: number;
}

type TreeStep = 'select' | 'shipping' | 'done';

type FlatNode =
  | { kind: 'epic'; group: EpicGroup }
  | { kind: 'story'; story: StoryWithEpic };

const DEFAULT_VISIBLE_ROWS = 10;

function isEligible(story: StoryWithEpic): boolean {
  return (
    !story.hasExistingTasks &&
    story.status !== 'in_progress' &&
    story.status !== 'done'
  );
}

export function ShipTreePicker({
  projectId,
  db,
  firstStageName,
  activeTeam,
  onComplete,
  onCancel,
  compact = false,
  height,
}: ShipTreePickerProps): React.JSX.Element {
  const service = useMemo(() => new ShipService(db), [db]);

  const visibleRows = height != null ? Math.max(1, height - 5) : DEFAULT_VISIBLE_ROWS;

  const [step, setStep] = useState<TreeStep>('select');
  const [groups, setGroups] = useState<EpicGroup[]>([]);
  const [expandedEpics, setExpandedEpics] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [result, setResult] = useState<ShipResult | null>(null);
  const [error, setError] = useState('');
  const [hiddenCount, setHiddenCount] = useState(0);

  // Load all stories on mount (single DB query via ShipService)
  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;

    const allStories = service.getStories(projectId);

    const groupMap = new Map<string, EpicGroup>();
    for (const story of allStories) {
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

    const sorted = Array.from(groupMap.values()).sort(
      (a, b) => parseInt(a.epicKey, 10) - parseInt(b.epicKey, 10),
    );

    const visibleGroups = sorted.filter((g) => g.stories.some((s) => isEligible(s)));
    const epicHiddenCount = sorted.length - visibleGroups.length;

    setGroups(visibleGroups);
    setHiddenCount(epicHiddenCount);
    setExpandedEpics(new Set(visibleGroups.map((g) => g.epicKey)));
  }, []);

  // Build flat visible list from groups + expandedEpics
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
    return list;
  }, [groups, expandedEpics]);

  // Clamp cursor when flat list length changes
  useEffect(() => {
    if (flatList.length === 0) return;
    setCursor((c) => Math.min(c, flatList.length - 1));
  }, [flatList.length]);

  // Select step keyboard handler
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
        } else if (isEligible(node.story)) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(node.story.id)) next.delete(node.story.id);
            else next.add(node.story.id);
            return next;
          });
        }
      } else if (input.toLowerCase() === 'a') {
        // Select all eligible across ALL groups (not just visible flatList)
        const allEligible = groups.flatMap((g) => g.stories.filter(isEligible));
        setSelectedIds(new Set(allEligible.map((s) => s.id)));
      } else if (input.toLowerCase() === 'n') {
        setSelectedIds(new Set());
      } else if (key.return) {
        if (selectedIds.size > 0) {
          setStep('shipping');
        }
      } else if (key.escape) {
        onCancel();
      }
    },
    { isActive: step === 'select' },
  );

  // Shipping step effect
  const shippingRan = useRef(false);
  useEffect(() => {
    if (step !== 'shipping' || shippingRan.current) return;
    shippingRan.current = true;
    try {
      const r = service.shipStories(Array.from(selectedIds), firstStageName, activeTeam);
      setResult(r);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setStep('done');
  }, [step, service, selectedIds, firstStageName]);

  // Done step keyboard handler
  useInput(
    () => {
      onComplete();
    },
    { isActive: step === 'done' },
  );

  // Render select step
  if (step === 'select') {
    if (flatList.length === 0) {
      return (
        <Box flexDirection="column" padding={compact ? 0 : 1}>
          <Text bold>Select stories to ship ({selectedIds.size} selected):</Text>
          {hiddenCount > 0 && (
            <Text color="gray">({hiddenCount} epic{hiddenCount > 1 ? 's' : ''} hidden — all stories done or shipped)</Text>
          )}
          <Text color="yellow">No stories available.</Text>
          <Text color="gray">
            [↑↓] Navigate  [Space] Toggle  [A] All  [N] None  [Enter] Ship  [Esc] Exit
          </Text>
        </Box>
      );
    }

    const startIdx = Math.min(
      Math.max(0, cursor - Math.floor(visibleRows / 2)),
      Math.max(0, flatList.length - visibleRows),
    );
    const endIdx = Math.min(flatList.length, startIdx + visibleRows);
    const visibleNodes = flatList.slice(startIdx, endIdx);

    return (
      <Box flexDirection="column" padding={compact ? 0 : 1}>
        <Text bold>Select stories to ship ({selectedIds.size} selected):</Text>
        {hiddenCount > 0 && (
          <Text color="gray">({hiddenCount} epic{hiddenCount > 1 ? 's' : ''} hidden — all stories done or shipped)</Text>
        )}
        {visibleNodes.map((node, i) => {
          const actualIdx = startIdx + i;
          const isCursor = actualIdx === cursor;

          if (node.kind === 'epic') {
            const expanded = expandedEpics.has(node.group.epicKey);
            return (
              <Box key={`epic-${node.group.epicKey}`}>
                <Text color={isCursor ? 'cyan' : undefined}>
                  {isCursor ? '> ' : '  '}[{expanded ? '-' : '+'}] {node.group.epicKey}: {node.group.epicTitle} ({node.group.stories.length} stories)
                </Text>
              </Box>
            );
          }

          const story = node.story;
          const eligible = isEligible(story);
          const isSelected = selectedIds.has(story.id);
          const marker = !eligible ? '[!]' : isSelected ? '[x]' : '[ ]';
          const depsLabel = story.dependsOn && story.dependsOn.length > 0
            ? ` (deps: ${story.dependsOn.join(', ')})`
            : '';

          return (
            <Box key={`story-${story.id}`}>
              <Text color={isCursor ? 'cyan' : !eligible ? 'gray' : undefined}>
                {isCursor ? '  > ' : '    '}
                <Text color={!eligible ? 'yellow' : undefined}>{marker}</Text>
                {' '}{story.epicKey}/{story.storyKey} {story.title}
              </Text>
              {depsLabel && <Text color="gray">{depsLabel}</Text>}
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text color="gray">
            [↑↓] Navigate  [Space] Toggle  [A] All  [N] None  [Enter] Ship  [Esc] Exit
          </Text>
        </Box>
      </Box>
    );
  }

  if (step === 'shipping') {
    return (
      <Box flexDirection="column" padding={compact ? 0 : 1}>
        <Text>Shipping stories...</Text>
      </Box>
    );
  }

  // done step
  return (
    <Box flexDirection="column" padding={compact ? 0 : 1}>
      {error ? (
        <Text color="red">{error}</Text>
      ) : (
        <>
          <Text color="green">
            Shipped {result?.shippedCount ?? 0} stories into pipeline (stage: {firstStageName}).
          </Text>
          {result && result.waitingCount > 0 && (
            <>
              <Text color="yellowBright">
                {result.waitingCount} story{result.waitingCount > 1 ? 's' : ''} waiting for dependencies:
              </Text>
              {result.waitingStories.map((ws) => (
                <Text key={ws.storyKey} color="yellow">
                  {'  '}{ws.storyKey} — needs: {ws.unmetDeps.join(', ')}
                </Text>
              ))}
            </>
          )}
        </>
      )}
      <Text color="gray">Press any key to exit...</Text>
    </Box>
  );
}
