import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { LogEntry } from '@core/LogsTypes.js';
import { formatLogEntry } from './formatLogEntry.js';

interface LogsViewerProps {
  entries: LogEntry[];
  onExit: () => void;
}

export function LogsViewer({ entries, onExit }: LogsViewerProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const visibleHeight = Math.max(5, (process.stdout.rows ?? 24) - 5);

  const filteredEntries = searchQuery
    ? entries.filter((e) =>
        formatLogEntry(e).toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : entries;

  const maxOffset = Math.max(0, filteredEntries.length - visibleHeight);
  const clampedOffset = Math.min(scrollOffset, maxOffset);
  const visible = filteredEntries.slice(clampedOffset, clampedOffset + visibleHeight);

  useInput((input, key) => {
    if (searchMode) {
      if (key.return || key.escape) {
        setSearchMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSearchQuery((q) => q.slice(0, -1));
        return;
      }
      if (input && !key.ctrl) {
        setSearchQuery((q) => q + input);
      }
      return;
    }

    if (input === 'q' || (key.ctrl && input === 'c')) {
      onExit();
      return;
    }

    if (input === '/') {
      setSearchMode(true);
      setSearchQuery('');
      return;
    }

    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
      return;
    }

    if (key.downArrow) {
      setScrollOffset((o) => Math.min(maxOffset, o + 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>
          {`Logs: ${filteredEntries.length} entries`}
          {searchQuery ? ` | filter: "${searchQuery}"` : ''}
        </Text>
      </Box>

      <Box flexDirection="column">
        {visible.map((entry, idx) => (
          <Text key={`${entry.taskId}-${entry.sequence}-${idx}`}>
            {formatLogEntry(entry)}
          </Text>
        ))}
      </Box>

      <Box>
        {searchMode ? (
          <Text>Search: {searchQuery}_</Text>
        ) : (
          <Text dimColor>
            {filteredEntries.length > 0
            ? `[q] quit  [↑/↓] scroll  [/] search  (${clampedOffset + 1}-${Math.min(clampedOffset + visibleHeight, filteredEntries.length)}/${filteredEntries.length})`
            : `[q] quit  [↑/↓] scroll  [/] search  (0/0)`}
          </Text>
        )}
      </Box>
    </Box>
  );
}
