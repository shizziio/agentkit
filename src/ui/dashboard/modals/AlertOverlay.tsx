import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import { useAlertStore } from '@ui/stores/index.js';

const MAX_ISSUES_SHOWN = 3;
const AUTO_DISMISS_MS = 20_000; // non-blocked alerts auto-dismiss after 20s

interface AlertOverlayProps {
  onViewDetails: () => void;
}

export function AlertOverlay({ onViewDetails }: AlertOverlayProps): React.JSX.Element | null {
  const currentAlert = useAlertStore((s) => s.currentAlert);
  const queueLength = useAlertStore((s) => s.queueLength);

  useInput(
    (input, key) => {
      if (key.return || key.escape) {
        useAlertStore.getState().dismiss();
      } else if (input === 'd' || input === 'D') {
        useAlertStore.getState().dismiss();
        onViewDetails();
      }
    },
    { isActive: currentAlert !== null },
  );

  // Auto-dismiss non-blocked alerts after timeout
  useEffect(() => {
    if (!currentAlert || currentAlert.isBlocked) return;
    const timer = setTimeout(() => { useAlertStore.getState().dismiss(); }, AUTO_DISMISS_MS);
    return () => { clearTimeout(timer); };
  }, [currentAlert]);

  if (!currentAlert) return null;

  const borderColor = currentAlert.isBlocked ? 'red' : 'yellow';
  const visibleIssues = currentAlert.issues.slice(0, MAX_ISSUES_SHOWN);
  const hiddenCount = currentAlert.issues.length - visibleIssues.length;

  const actionLine = currentAlert.isBlocked
    ? `BLOCKED (attempt ${currentAlert.attempt}/${currentAlert.maxAttempts})`
    : `Routed to ${currentAlert.routedTo ?? 'unknown'} (attempt ${currentAlert.attempt}/${currentAlert.maxAttempts})`;

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      flexDirection="column"
      paddingX={1}
      marginTop={1}
    >
      <Text bold color={borderColor}>
        {' '}[ALERT] Stage: {currentAlert.stageName}
      </Text>
      <Text> Story: {currentAlert.storyTitle}</Text>
      <Text> </Text>
      {visibleIssues.length === 0 ? (
        <Text dimColor> No details available</Text>
      ) : (
        visibleIssues.map((issue, i) => (
          <Text key={`${i}-${issue}`}> • {issue}</Text>
        ))
      )}
      {hiddenCount > 0 && (
        <Text dimColor> ... and {hiddenCount} more</Text>
      )}
      <Text> </Text>
      <Text color={currentAlert.isBlocked ? 'red' : 'yellow'}> {actionLine}</Text>
      <Text> </Text>
      <Text dimColor> [Enter/Esc] Dismiss  [d] Focus Activity{currentAlert.isBlocked ? '' : `  (auto-dismiss in ${AUTO_DISMISS_MS / 1000}s)`}</Text>
      {queueLength > 1 && (
        <Text dimColor> ({queueLength - 1} more alert(s) pending)</Text>
      )}
    </Box>
  );
}
