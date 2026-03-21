import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import type { StoryRow } from '@core/ResetTypes.js';
import { useProjectId, useEventBus, useResetService } from '@ui/stores/appStore.js';

type WizardStep = 'loading' | 'no-stories' | 'story-list' | 'confirm' | 'done';

export interface CancelStoryWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  compact?: boolean;
}

export function CancelStoryWizard({
  onComplete,
  onCancel: _onCancel,
  compact = false,
}: CancelStoryWizardProps): React.JSX.Element {
  const projectId = useProjectId();
  const eventBus = useEventBus();
  const resetService = useResetService();
  const [step, setStep] = useState<WizardStep>('loading');
  const [storyList, setStoryList] = useState<StoryRow[]>([]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [selectedStory, setSelectedStory] = useState<StoryRow | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    try {
      const result = resetService.getStoriesWithActiveTasks(projectId);

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
        setCursorIndex((c) => Math.max(0, c - 1));
      } else if (key.downArrow) {
        setCursorIndex((c) => Math.min(storyList.length - 1, c + 1));
      } else if (key.return) {
        const story = storyList[cursorIndex];
        if (!story) return;
        setSelectedStory(story);
        setStep('confirm');
      }
    },
    { isActive: step === 'story-list' },
  );

  useInput(
    (input, _key) => {
      if (input === 'y' || input === 'Y') {
        if (!selectedStory) return;
        try {
          // Layer violation fix: Emit event instead of direct mutation call
          eventBus.emit('story:request-cancel', { storyId: selectedStory.id });
          setStep('done');
        } catch (e) {
          setErrorMessage(e instanceof Error ? e.message : String(e));
          setStep('story-list');
        }
      } else if (input === 'n' || input === 'N') {
        setStep('story-list');
      }
    },
    { isActive: step === 'confirm' },
  );

  useInput(
    (_input, key) => {
      if (key.return) onComplete();
    },
    { isActive: step === 'done' },
  );

  const padding = compact ? 0 : 1;

  return (
    <Box flexDirection="column" paddingX={padding} overflow="hidden">
      <Text bold color="red" wrap="truncate"> Cancel Story</Text>
      {errorMessage ? <Text color="red" wrap="truncate"> {errorMessage}</Text> : null}

      {step === 'loading' && <Text dimColor wrap="truncate"> Loading...</Text>}

      {step === 'no-stories' && (
        <Box flexDirection="column" overflow="hidden">
          <Text dimColor wrap="truncate"> No queued or running stories found.</Text>
          <Text dimColor wrap="truncate"> [Q] Close</Text>
        </Box>
      )}

      {step === 'story-list' && (
        <Box flexDirection="column" overflow="hidden">
          <Text dimColor wrap="truncate"> Select story to cancel:</Text>
          {storyList.map((story, i) => (
            <Text key={story.id} color={i === cursorIndex ? 'red' : undefined} bold={i === cursorIndex} wrap="truncate">
              {i === cursorIndex ? ' > ' : '   '}
              {story.storyKey} — {story.title}
            </Text>
          ))}
          <Text dimColor wrap="truncate"> [↑↓] Navigate  [Enter] Select  [Q] Back</Text>
        </Box>
      )}

      {step === 'confirm' && selectedStory && (
        <Box flexDirection="column" overflow="hidden">
          <Text wrap="truncate"> Cancel <Text bold color="red">{selectedStory.storyKey}</Text> — {selectedStory.title}?</Text>
          <Text color="yellow" wrap="truncate"> This will remove all queued tasks for this story.</Text>
          <Text dimColor wrap="truncate"> [Y] Confirm  [N/Q] Back</Text>
        </Box>
      )}

      {step === 'done' && selectedStory && (
        <Box flexDirection="column" overflow="hidden">
          <Text color="green" wrap="truncate"> Story {selectedStory.storyKey} cancellation request sent.</Text>
          <Text dimColor wrap="truncate"> [Enter/Q] Close</Text>
        </Box>
      )}
    </Box>
  );
}
