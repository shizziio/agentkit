import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ResetTarget, StoryRow } from '@core/ResetTypes.js';
import { useProjectId, useEventBus, useResetService } from '@ui/stores/appStore.js';

import { StoryActionPicker } from './StoryActionPicker.js';

type WizardStep = 'loading' | 'no-stories' | 'story-list' | 'no-targets' | 'stage-picker' | 'confirm';

export interface ResetStoryWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  compact?: boolean;
}

export function ResetStoryWizard({
  onComplete,
  onCancel: _onCancel,
  compact = false,
}: ResetStoryWizardProps): React.JSX.Element {
  const projectId = useProjectId();
  const eventBus = useEventBus();
  const resetService = useResetService();
  const [step, setStep] = useState<WizardStep>('loading');
  const [storyList, setStoryList] = useState<StoryRow[]>([]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [selectedStory, setSelectedStory] = useState<StoryRow | null>(null);
  const [pickerTargets, setPickerTargets] = useState<ResetTarget[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');

  useEffect(() => {
    try {
      const result = resetService.getResetableStories(projectId);

      if (result.length === 0) {
        setStep('no-stories');
      } else {
        setStoryList(result);
        setStep('story-list');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [resetService, projectId]);

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setCursorIndex(c => Math.max(0, c - 1));
      } else if (key.downArrow) {
        setCursorIndex(c => Math.min(storyList.length - 1, c + 1));
      } else if (key.return) {
        const story = storyList[cursorIndex];
        if (!story) return;
        setSelectedStory(story);
        const targets = resetService.getResetTargets(story.id);
        if (targets.length === 0) {
          setStep('no-targets');
        } else {
          setPickerTargets(targets);
          setStep('stage-picker');
        }
      }
    },
    { isActive: step === 'story-list' },
  );

  useInput(
    (_input, key) => {
      if (key.return) onComplete();
    },
    { isActive: step === 'confirm' },
  );

  const handleStageSelect = (stageName: string): void => {
    if (!selectedStory) return;
    try {
      // Layer violation fix: Emit event instead of direct mutation call
      eventBus.emit('story:request-reset', { storyId: selectedStory.id, targetStage: stageName });
      
      setConfirmMessage(`Reset request for ${selectedStory.storyKey} sent. Target: ${stageName}`);
      setStep('confirm');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStep('story-list');
    }
  };

  const padding = compact ? 0 : 1;

  return (
    <Box flexDirection="column" paddingX={padding} overflow="hidden">
      <Text bold wrap="truncate"> Reset Story</Text>
      {errorMessage ? <Text color="red" wrap="truncate">{errorMessage}</Text> : null}
      {step === 'loading' && <Text dimColor wrap="truncate">Loading stories...</Text>}
      {step === 'no-stories' && (
        <Box flexDirection="column" overflow="hidden">
          <Text dimColor wrap="truncate">No blocked or failed stories found.</Text>
          <Text dimColor wrap="truncate">[Q] Close</Text>
        </Box>
      )}
      {step === 'story-list' && (
        <Box flexDirection="column" overflow="hidden">
          <Text dimColor wrap="truncate">Select a story to reset:</Text>
          {storyList.map((story, i) => (
            <Text key={story.id} color={i === cursorIndex ? 'cyan' : undefined} bold={i === cursorIndex} wrap="truncate">
              {i === cursorIndex ? '> ' : '  '}
              {story.storyKey} — {story.title}{' '}
              <Text color="yellow">[{story.status}]</Text>
            </Text>
          ))}
          <Text dimColor wrap="truncate">[↑↓] Navigate  [Enter] Select  [Q] Cancel</Text>
        </Box>
      )}
      {step === 'no-targets' && (
        <Box flexDirection="column" overflow="hidden">
          <Text wrap="truncate">{"No reset targets configured for this story's current stage."}</Text>
          <Text dimColor wrap="truncate">[Q] Back</Text>
        </Box>
      )}
      {step === 'stage-picker' && selectedStory && (
        <StoryActionPicker
          targets={pickerTargets}
          storyKey={selectedStory.storyKey}
          onSelect={handleStageSelect}
          onCancel={() => setStep('story-list')}
        />
      )}
      {step === 'confirm' && (
        <Box flexDirection="column" overflow="hidden">
          <Text color="green" wrap="truncate">{confirmMessage}</Text>
          <Text dimColor wrap="truncate">[Enter/Q] Close</Text>
        </Box>
      )}
    </Box>
  );
}
