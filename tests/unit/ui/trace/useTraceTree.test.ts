import { describe, it, expect } from 'vitest';

import { buildVisibleLines } from '@ui/trace/useTraceTree';
import type { EpicNode, StoryNode, TaskNode } from '@core/TraceTypes';

function makeEpic(id: number, epicKey = `E${id}`): EpicNode {
  return {
    id,
    epicKey,
    title: `Epic ${id}`,
    status: 'draft',
    storyCount: 0,
    completionPct: 0,
    orderIndex: id,
  };
}

function makeStory(id: number, epicId: number, storyKey = `S${id}`): StoryNode {
  return {
    id,
    epicId,
    storyKey,
    title: `Story ${id}`,
    status: 'draft',
    totalDurationMs: null,
    orderIndex: id,
  };
}

function makeTask(id: number, storyId: number, stageName = 'dev'): TaskNode {
  return {
    id,
    storyId,
    stageName,
    status: 'done',
    attempt: 1,
    maxAttempts: 3,
    reworkLabel: null,
    workerModel: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    startedAt: null,
    completedAt: null,
    input: null,
    output: null,
  };
}

describe('buildVisibleLines', () => {
  const epic1 = makeEpic(1);
  const story1 = makeStory(1, 1);
  const task1 = makeTask(1, 1);

  it('returns one epic line when nothing is expanded', () => {
    const lines = buildVisibleLines(
      [epic1],
      new Map([[1, [story1]]]),
      new Map([[1, [task1]]]),
      new Set(),
      new Set(),
      '',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('epic');
  });

  it('expands epic to show stories', () => {
    const lines = buildVisibleLines(
      [epic1],
      new Map([[1, [story1]]]),
      new Map([[1, [task1]]]),
      new Set([1]),
      new Set(),
      '',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].kind).toBe('epic');
    expect(lines[1].kind).toBe('story');
  });

  it('expands story to show tasks', () => {
    const lines = buildVisibleLines(
      [epic1],
      new Map([[1, [story1]]]),
      new Map([[1, [task1]]]),
      new Set([1]),
      new Set([1]),
      '',
    );
    expect(lines).toHaveLength(3);
    expect(lines[2].kind).toBe('task');
  });

  it('sets correct depth for each level', () => {
    const lines = buildVisibleLines(
      [epic1],
      new Map([[1, [story1]]]),
      new Map([[1, [task1]]]),
      new Set([1]),
      new Set([1]),
      '',
    );
    expect(lines[0].depth).toBe(0);
    expect(lines[1].depth).toBe(1);
    expect(lines[2].depth).toBe(2);
  });

  it('marks epic as expanded when in expandedEpics set', () => {
    const lines = buildVisibleLines(
      [epic1],
      new Map([[1, [story1]]]),
      new Map(),
      new Set([1]),
      new Set(),
      '',
    );
    const epicLine = lines[0];
    expect(epicLine.kind).toBe('epic');
    if (epicLine.kind === 'epic') {
      expect(epicLine.isExpanded).toBe(true);
    }
  });

  it('marks story as not expanded when not in expandedStories set', () => {
    const lines = buildVisibleLines(
      [epic1],
      new Map([[1, [story1]]]),
      new Map(),
      new Set([1]),
      new Set(),
      '',
    );
    const storyLine = lines[1];
    expect(storyLine.kind).toBe('story');
    if (storyLine.kind === 'story') {
      expect(storyLine.isExpanded).toBe(false);
    }
  });

  it('filters by search - epic key match', () => {
    const epic2 = makeEpic(2, 'E2');
    const story2 = makeStory(2, 2);
    const lines = buildVisibleLines(
      [epic1, epic2],
      new Map([[1, [story1]], [2, [story2]]]),
      new Map(),
      new Set(),
      new Set(),
      'E1',
    );
    // Only epic1 should match
    expect(lines.some((l) => l.kind === 'epic' && l.node.id === 1)).toBe(true);
  });

  it('shows epic when it has matching children even if epic title does not match', () => {
    const epicNoMatch = { ...epic1, epicKey: 'NOMATCH', title: 'No match' };
    const storyMatch = { ...story1, storyKey: 'special', title: 'special story' };
    const lines = buildVisibleLines(
      [epicNoMatch],
      new Map([[1, [storyMatch]]]),
      new Map(),
      new Set(),
      new Set(),
      'special',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('epic');
  });

  it('returns empty lines when no epics', () => {
    const lines = buildVisibleLines(
      [],
      new Map(),
      new Map(),
      new Set(),
      new Set(),
      '',
    );
    expect(lines).toHaveLength(0);
  });

  it('handles multiple epics', () => {
    const epic2 = makeEpic(2);
    const lines = buildVisibleLines(
      [epic1, epic2],
      new Map(),
      new Map(),
      new Set(),
      new Set(),
      '',
    );
    expect(lines).toHaveLength(2);
  });

  it('does not show stories when stories map is empty for expanded epic', () => {
    const lines = buildVisibleLines(
      [epic1],
      new Map(),
      new Map(),
      new Set([1]),
      new Set(),
      '',
    );
    // Epic shows but no stories since map is empty
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('epic');
  });
});
