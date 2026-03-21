import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

export interface ScrollablePanelProps {
  lines: string[];          // pre-rendered string lines
  height: number;           // requested height (inner lines display)
  title?: string;           // optional panel header title
  onExit?: () => void;      // called when Q pressed
  autoScrollToBottom?: boolean;  // whether to follow new lines
  isActive?: boolean;       // whether to capture keyboard input
}

/**
 * Shared scrollable log/trace display component.
 * Layout NEVER exceeds terminal height.
 * Only visible window is rendered.
 */
export function ScrollablePanel({
  lines,
  height: requestedHeight,
  title,
  onExit,
  autoScrollToBottom = true,
  isActive = true,
}: ScrollablePanelProps): React.JSX.Element {
  const { stdout } = useStdout();
  const [scrollIndex, setScrollIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const hasIndicator = lines.length > requestedHeight;
  const headerRows = title ? 4 : (hasIndicator ? 1 : 0);
  const borderRows = 2;
  const totalOverhead = headerRows + borderRows;

  // Clamp height to terminal
  const availableHeight = stdout?.rows ? stdout.rows - totalOverhead : 20;
  const height = Math.min(requestedHeight, Math.max(1, availableHeight));

  // Auto-scroll logic
  useEffect(() => {
    if (autoScrollToBottom && !isPaused) {
      if (lines.length > height) {
        setScrollIndex(lines.length - height);
      } else {
        setScrollIndex(0);
      }
    }
  }, [lines.length, height, autoScrollToBottom, isPaused]);

  // If scroll index is out of bounds (e.g., lines reduced), fix it
  useEffect(() => {
    const maxIndex = Math.max(0, lines.length - height);
    if (scrollIndex > maxIndex) {
      setScrollIndex(maxIndex);
    }
  }, [lines.length, height, scrollIndex]);

  useInput((input, key) => {
    if (input.toLowerCase() === 'q') {
      onExit?.();
      return;
    }

    const maxIndex = Math.max(0, lines.length - height);

    if (key.upArrow) {
      setScrollIndex((prev) => Math.max(0, prev - 1));
      setIsPaused(true);
    } else if (key.downArrow) {
      setScrollIndex((prev) => {
        const next = Math.min(maxIndex, prev + 1);
        if (next >= maxIndex) {
          setIsPaused(false);
        }
        return next;
      });
    } else if (key.pageUp) {
      setScrollIndex((prev) => Math.max(0, prev - Math.floor(height / 2)));
      setIsPaused(true);
    } else if (key.pageDown) {
      setScrollIndex((prev) => {
        const next = Math.min(maxIndex, prev + Math.floor(height / 2));
        if (next >= maxIndex) {
          setIsPaused(false);
        }
        return next;
      });
    }
  }, { isActive });
  
  const visibleLines = useMemo(() => {
    return lines.slice(scrollIndex, scrollIndex + height);
  }, [lines, scrollIndex, height]);

  // Scroll indicator e.g., [120-140/200]
  const scrollIndicator = lines.length > height
    ? `[${scrollIndex + 1}-${Math.min(scrollIndex + height, lines.length)}/${lines.length}]`
    : '';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      height={height + totalOverhead}
    >
      {title && (
        <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} marginBottom={0}>
          <Box flexGrow={1}>
            <Text bold color="cyan">{title}</Text>
          </Box>
          {scrollIndicator && (
            <Box>
              <Text dimColor>{scrollIndicator}</Text>
            </Box>
          )}
        </Box>
      )}
      {!title && scrollIndicator && (
         <Box justifyContent="flex-end">
            <Text dimColor>{scrollIndicator}</Text>
         </Box>
      )}
      <Box flexDirection="column" height={height} overflow="hidden">
        {visibleLines.map((line, i) => (
          <Box key={`${scrollIndex}-${i}`} height={1} overflow="hidden">
            <Text wrap="truncate">{line}</Text>
          </Box>
        ))}
        {visibleLines.length === 0 && (
          <Box height={1} overflow="hidden">
            <Text dimColor italic>No content to display.</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
