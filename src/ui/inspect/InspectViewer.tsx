import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { TaskInspectData } from '@core/InspectTypes.js';

interface Props {
  data: TaskInspectData;
  onComplete: () => void;
}

type SectionId = 'METADATA' | 'STORY' | 'CHAIN' | 'PROMPT' | 'INPUT' | 'OUTPUT' | 'EVENTS';

const SECTIONS: SectionId[] = ['METADATA', 'STORY', 'CHAIN', 'PROMPT', 'INPUT', 'OUTPUT', 'EVENTS'];

function formatJson(val: string | null | undefined): string {
  if (val === null || val === undefined) return '(none)';
  try {
    return JSON.stringify(JSON.parse(val), null, 2);
  } catch {
    return `[invalid JSON] ${val}`;
  }
}

function renderSectionContent(section: SectionId, data: TaskInspectData): React.ReactNode {
  const t = data.task;

  switch (section) {
    case 'METADATA':
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text>id: <Text bold>{t.id}</Text></Text>
          <Text>stage: <Text bold>{t.stageName}</Text></Text>
          <Text>status: <Text bold>{t.status}</Text></Text>
          <Text>model: <Text bold>{t.workerModel ?? '—'}</Text></Text>
          <Text>attempt: <Text bold>{t.attempt}/{t.maxAttempts}</Text></Text>
          <Text>duration: <Text bold>{t.durationMs !== null && t.durationMs !== undefined ? `${t.durationMs}ms` : '—'}</Text></Text>
          <Text>started_at: <Text bold>{t.startedAt ?? '—'}</Text></Text>
          <Text>completed_at: <Text bold>{t.completedAt ?? '—'}</Text></Text>
          <Text>input_tokens: <Text bold>{t.inputTokens !== null && t.inputTokens !== undefined ? String(t.inputTokens) : '—'}</Text></Text>
          <Text>output_tokens: <Text bold>{t.outputTokens !== null && t.outputTokens !== undefined ? String(t.outputTokens) : '—'}</Text></Text>
        </Box>
      );

    case 'STORY':
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text>title: <Text bold>{data.story.title}</Text></Text>
          <Text>story_key: <Text bold>{data.story.storyKey}</Text></Text>
          <Text>epic_title: <Text bold>{data.epic.title}</Text></Text>
          <Text>epic_key: <Text bold>{data.epic.epicKey}</Text></Text>
          <Text>status: <Text bold>{data.story.status}</Text></Text>
        </Box>
      );

    case 'CHAIN': {
      const indent = (depth: number) => '  '.repeat(depth);
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {data.ancestors.length === 0 && data.children.length === 0 && (
            <Text dimColor>(no ancestors or children)</Text>
          )}
          {data.ancestors.map((a, i) => (
            <Text key={a.id}>{indent(i)}#{a.id} [{a.stageName}] {a.status} attempt={a.attempt} dur={a.durationMs !== null && a.durationMs !== undefined ? `${a.durationMs}ms` : '—'}</Text>
          ))}
          <Text>{indent(data.ancestors.length)}#{t.id} [{t.stageName}] {t.status} <Text bold>(current)</Text></Text>
          {data.chainTruncated && (
            <Text color="yellow">(chain truncated at max length)</Text>
          )}
          {data.children.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor>  Children:</Text>
              {data.children.map((c) => (
                <Text key={c.id}>{indent(data.ancestors.length + 1)}#{c.id} [{c.stageName}] {c.status} attempt={c.attempt} dur={c.durationMs !== null && c.durationMs !== undefined ? `${c.durationMs}ms` : '—'}</Text>
              ))}
            </Box>
          )}
        </Box>
      );
    }

    case 'PROMPT':
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text>{t.prompt ?? '(none)'}</Text>
        </Box>
      );

    case 'INPUT':
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text>{formatJson(t.input)}</Text>
        </Box>
      );

    case 'OUTPUT':
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text>{formatJson(t.output)}</Text>
        </Box>
      );

    case 'EVENTS':
      if (data.eventLog.length === 0) {
        return (
          <Box paddingLeft={2}>
            <Text dimColor>(no events recorded)</Text>
          </Box>
        );
      }
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {data.eventLog.map((e) => {
            const snippet = e.eventData.length > 80 ? e.eventData.slice(0, 80) + '…' : e.eventData;
            return (
              <Text key={e.sequence}>[{e.sequence}] {e.eventType} {snippet}</Text>
            );
          })}
        </Box>
      );

    default:
      return null;
  }
}

export function InspectViewer({ data, onComplete }: Props): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set([0]));

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(SECTIONS.length - 1, i + 1));
    } else if (key.return) {
      setExpandedSet((prev) => {
        const next = new Set(prev);
        if (next.has(selectedIndex)) {
          next.delete(selectedIndex);
        } else {
          next.add(selectedIndex);
        }
        return next;
      });
    } else if (input === 'q' || key.escape) {
      onComplete();
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Task #{data.task.id} Inspector</Text>
        <Text dimColor>  (↑↓ navigate, Enter expand/collapse, q quit)</Text>
      </Box>
      {SECTIONS.map((section, index) => {
        const isSelected = index === selectedIndex;
        const isExpanded = expandedSet.has(index);
        const indicator = isExpanded ? '[-]' : '[+]';

        return (
          <Box key={section} flexDirection="column">
            <Box>
              <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                {indicator} {section}
              </Text>
            </Box>
            {isExpanded && renderSectionContent(section, data)}
          </Box>
        );
      })}
    </Box>
  );
}
