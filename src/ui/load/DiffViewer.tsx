import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { StoryComparison } from '@core/LoadTypes.js';

interface DiffViewerProps {
  storyComparisons: StoryComparison[];
  onClose: () => void;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

function computeDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const lines: DiffLine[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i]! : undefined;
    const newLine = i < newLines.length ? newLines[i]! : undefined;

    if (oldLine === undefined) {
      lines.push({ type: 'added', text: newLine! });
    } else if (newLine === undefined) {
      lines.push({ type: 'removed', text: oldLine });
    } else if (oldLine !== newLine) {
      lines.push({ type: 'removed', text: oldLine });
      lines.push({ type: 'added', text: newLine });
    } else {
      lines.push({ type: 'unchanged', text: oldLine });
    }
  }

  return lines;
}

export function DiffViewer({ storyComparisons, onClose }: DiffViewerProps): React.JSX.Element {
  const [scrollOffset, setScrollOffset] = useState(0);
  const visibleLines = 20;

  const allContent: React.JSX.Element[] = [];
  for (const story of storyComparisons) {
    allContent.push(
      <Text key={`header-${story.storyKey}`} bold color="cyan">
        --- Story {story.storyKey}: {story.title} ---
      </Text>,
    );
    const diff = computeDiff(story.oldContent ?? '', story.newContent);
    for (let i = 0; i < diff.length; i++) {
      const line = diff[i]!;
      const color = line.type === 'added' ? 'green' : line.type === 'removed' ? 'red' : 'gray';
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      allContent.push(
        <Text key={`${story.storyKey}-${i}`} color={color}>
          {prefix} {line.text}
        </Text>,
      );
    }
    allContent.push(<Text key={`sep-${story.storyKey}`}>{''}</Text>);
  }

  const totalItems = allContent.length;
  const maxOffset = Math.max(0, totalItems - visibleLines);

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'q') {
      onClose();
      return;
    }
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setScrollOffset((prev) => Math.min(maxOffset, prev + 1));
    }
  });

  const visible = allContent.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box flexDirection="column">
      <Text bold>Diff Viewer</Text>
      <Text color="gray">[Up/Down] Scroll  [Esc/Q] Close</Text>
      <Box flexDirection="column" marginTop={1}>
        {visible}
      </Box>
      {totalItems > visibleLines && (
        <Text color="gray">
          Lines {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, totalItems)} of {totalItems}
        </Text>
      )}
    </Box>
  );
}
