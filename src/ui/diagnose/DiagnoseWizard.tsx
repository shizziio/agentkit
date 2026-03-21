import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';

import { DiagnoseService } from '@core/DiagnoseService.js';
import type { DiagnoseIssue, DiagnoseResult } from '@core/DiagnoseTypes.js';
import { formatDuration } from '@ui/dashboard/shared/utils.js';
import { truncate } from '@ui/shared/format.js';
import { useDb, usePipelineConfig } from '@ui/stores/appStore.js';

type Step = 'scanning' | 'results' | 'action_select' | 'applying' | 'no_issues';
type Action = 'reset' | 'reroute' | 'skip' | 'ignore' | 'mark_done';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
  compact?: boolean;
}

function issueTypeColor(type: DiagnoseIssue['type']): string {
  switch (type) {
    case 'stuck': return 'red';
    case 'orphaned': return 'yellow';
    case 'queue_gap': return 'cyan';
    case 'loop_blocked': return 'magenta';
    case 'failed': return 'red';
    case 'blocked': return 'magenta';
  }
}

function issueTypeLabel(type: DiagnoseIssue['type']): string {
  switch (type) {
    case 'stuck': return 'STUCK';
    case 'orphaned': return 'ORPHANED';
    case 'queue_gap': return 'QUEUE GAP';
    case 'loop_blocked': return 'LOOP';
    case 'failed': return 'FAILED';
    case 'blocked': return 'BLOCKED';
  }
}

export function DiagnoseWizard({ onComplete, onCancel, compact = false }: Props): React.ReactElement {
  const db = useDb();
  const pipelineConfig = usePipelineConfig();
  const [step, setStep] = useState<Step>('scanning');
  const [issues, setIssues] = useState<DiagnoseIssue[]>([]);
  const [result, setResult] = useState<DiagnoseResult | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [chosenActions, setChosenActions] = useState<Map<number, Action>>(new Map());
  const [actionMessage, setActionMessage] = useState('');

  const service = useMemo(() => new DiagnoseService(db, pipelineConfig), [db, pipelineConfig]);

  // Scanning step: run diagnose on mount
  useEffect(() => {
    if (step !== 'scanning') return;
    const diagnoseResult = service.diagnose();
    setResult(diagnoseResult);
    setIssues(diagnoseResult.issues);
    if (diagnoseResult.issues.length === 0) {
      setStep('no_issues');
    } else {
      setStep('results');
    }
  }, [service]);

  // Applying step: apply chosen actions
  useEffect(() => {
    if (step !== 'applying') return;
    let resetCount = 0;
    let reroutedCount = 0;
    let skippedCount = 0;
    let markedDoneCount = 0;

    for (const issue of issues) {
      const action = chosenActions.get(issue.taskId) ?? 'ignore';
      if (action === 'reset') {
        service.resetTask(issue.taskId);
        resetCount++;
      } else if (action === 'reroute') {
        if (issue.type === 'loop_blocked') {
          service.rerouteLoopBlocked(issue);
        } else {
          service.rerouteGap(issue);
        }
        reroutedCount++;
      } else if (action === 'skip') {
        service.skipTask(issue.taskId);
        skippedCount++;
      } else if (action === 'mark_done') {
        service.markTaskDone(issue.taskId);
        markedDoneCount++;
      }
    }

    const msg = `Applied Fixes: ${resetCount} Reset | ${reroutedCount} Re-routed | ${skippedCount} Skipped | ${markedDoneCount} Marked Done`;
    setActionMessage(msg);
    setTimeout(() => setActionMessage(''), 3000);

    const check = service.diagnose();
    setResult(check);
    setIssues(check.issues);

    setChosenActions(new Map());
    setCurrentIndex(0);

    if (check.issues.length === 0) {
      setStep('no_issues');
    } else {
      setStep('results');
    }
  }, [step, issues, chosenActions, service]);

  // Input for 'no_issues' step
  useInput(
    (_input, key) => {
      if (key.escape) {
        onCancel();
      } else {
        onComplete();
      }
    },
    { isActive: step === 'no_issues' },
  );

  // Input for 'results' step
  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
      } else if (key.upArrow) {
        setCurrentIndex(i => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setCurrentIndex(i => Math.min(issues.length - 1, i + 1));
      } else if (key.return && issues.length > 0) {
        setStep('action_select');
      } else if ((input === 'm' || input === 'M') && issues.length > 0) {
        const issue = issues[currentIndex];
        if (issue) {
          const next = new Map(chosenActions);
          next.set(issue.taskId, 'mark_done');
          setChosenActions(next);
          setStep('applying');
        }
      } else if (input === 'f' || input === 'F') {
        // Auto-fix all
        if (result) {
          const autoResult = service.autoFix(result);
          const msg = `Auto-fixed: ${autoResult.resetCount} Reset | ${autoResult.reroutedCount} Re-routed | ${autoResult.skippedCount} Skipped | ${autoResult.markedDoneCount} Marked Done`;
          setActionMessage(msg);
          setTimeout(() => setActionMessage(''), 3000);
          
          const check = service.diagnose();
          setResult(check);
          setIssues(check.issues);
          setCurrentIndex(0);
          if (check.issues.length === 0) {
            setStep('no_issues');
          } else {
            setStep('results');
          }
        }
      } else if (input === 's' || input === 'S') {
        setCurrentIndex(0);
        setStep('action_select');
      } else if (input === 'q' || input === 'Q') {
        onCancel();
      }
    },
    { isActive: step === 'results' },
  );

  // Input for 'action_select' step
  useInput(
    (input, key) => {
      if (key.escape) {
        setStep('results');
        return;
      }
      const issue = issues[currentIndex];
      if (!issue) return;

      let action: Action | null = null;

      if ((input === 'r' || input === 'R') && issue.type !== 'queue_gap' && issue.type !== 'loop_blocked') {
        action = 'reset';
      } else if ((input === 'o' || input === 'O') && (issue.type === 'queue_gap' || (issue.type === 'loop_blocked' && !!issue.gapNextStage))) {
        action = 'reroute';
      } else if (input === 's' || input === 'S') {
        action = 'skip';
      } else if (input === 'm' || input === 'M') {
        action = 'mark_done';
      } else if (input === 'i' || input === 'I') {
        action = 'ignore';
      }

      if (action !== null) {
        const next = new Map(chosenActions);
        next.set(issue.taskId, action);
        setChosenActions(next);

        if (currentIndex + 1 < issues.length) {
          setCurrentIndex(currentIndex + 1);
        } else {
          setStep('applying');
        }
      }
    },
    { isActive: step === 'action_select' },
  );



  if (step === 'scanning') {
    return (
      <Box flexDirection="column">
        <Spinner label="Scanning pipeline health…" />
      </Box>
    );
  }

  if (step === 'no_issues') {
    return (
      <Box flexDirection="column" marginY={compact ? 0 : 1}>
        <Text color="green">No pipeline issues detected.</Text>
        <Text dimColor>Press any key to exit.</Text>
      </Box>
    );
  }

  if (step === 'results') {
    if (!result) return <Text>No data</Text>;
    const r = result;
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Pipeline Health Report</Text>
        <Box marginY={1} flexDirection="column">
          <Box>
            <Text bold color="cyan">  </Text>
            <Text bold dimColor>{'#'.padEnd(4)}</Text>
            <Text bold dimColor>{'Type'.padEnd(12)}</Text>
            <Text bold dimColor>{'TaskID'.padEnd(8)}</Text>
            <Text bold dimColor>{'Story'.padEnd(42)}</Text>
            <Text bold dimColor>{'Stage'.padEnd(12)}</Text>
            <Text bold dimColor>{'Duration'.padEnd(10)}</Text>
          </Box>
          {issues.map((issue, i) => (
            <Box key={issue.taskId}>
              <Text bold color="cyan">{i === currentIndex ? '> ' : '  '}</Text>
              <Text>{String(i + 1).padEnd(4)}</Text>
              <Text color={issueTypeColor(issue.type)}>{issueTypeLabel(issue.type).padEnd(12)}</Text>
              <Text>{String(issue.taskId).padEnd(8)}</Text>
              <Text>{truncate(issue.storyTitle, 40).padEnd(42)}</Text>
              <Text>{issue.stageName.padEnd(12)}</Text>
              <Text>{formatDuration(issue.elapsedMs)}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text dimColor>
            Summary: {r.summary.stuckCount} stuck, {r.summary.orphanedCount} orphaned,{' '}
            {r.summary.queueGapCount} queue gaps, {r.summary.loopBlockedCount} loop-blocked,{' '}
            {r.summary.failedCount} failed, {r.summary.blockedCount} blocked
          </Text>
        </Box>
        {actionMessage ? (
          <Box marginTop={1}>
            <Text color="green">{actionMessage}</Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text>Use </Text>
            <Text bold>[↑/↓]</Text>
            <Text> to select, </Text>
            <Text bold>[Enter]</Text>
            <Text> actions, </Text>
            <Text bold>[M]</Text>
            <Text> mark done, </Text>
            <Text bold>[F]</Text>
            <Text> fix all, </Text>
            <Text bold>[Q]</Text>
            <Text> quit</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (step === 'action_select') {
    const issue = issues[currentIndex];
    if (!issue) return <Text>No issue</Text>;

    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>
          Issue {currentIndex + 1}/{issues.length} —{' '}
          <Text color={issueTypeColor(issue.type)}>{issueTypeLabel(issue.type)}</Text>
        </Text>
        <Box flexDirection="column" marginY={1}>
          <Text>Task ID: {issue.taskId}</Text>
          <Text>Story:   {issue.storyTitle}</Text>
          <Text>Stage:   {issue.stageName}</Text>
          <Text>Status:  {issue.status}</Text>
          <Text>Elapsed: {formatDuration(issue.elapsedMs)}</Text>
          {issue.gapNextStage && <Text>Gap to:  {issue.gapNextStage}</Text>}
        </Box>
        <Box flexDirection="column">
          {(issue.type === 'stuck' || issue.type === 'orphaned' || issue.type === 'failed' || issue.type === 'blocked') && (
            <Text><Text bold>[R]</Text> Reset to queued</Text>
          )}
          {issue.type === 'queue_gap' && (
            <Text><Text bold>[O]</Text> Re-route (insert task at {issue.gapNextStage})</Text>
          )}
          {issue.type === 'loop_blocked' && issue.gapNextStage && (
            <Text><Text bold>[O]</Text> Route to next (insert task at {issue.gapNextStage})</Text>
          )}
          <Text><Text bold>[M]</Text> Mark Done manually</Text>
          <Text><Text bold>[S]</Text> Skip (mark as blocked)</Text>
          <Text><Text bold>[I]</Text> Ignore</Text>
        </Box>
      </Box>
    );
  }

  if (step === 'applying') {
    return (
      <Box flexDirection="column">
        <Spinner label="Applying actions…" />
      </Box>
    );
  }



  return <Text>Unknown step</Text>;
}
