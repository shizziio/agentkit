import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Spinner } from '@inkjs/ui';
import { AGENTKIT_DIR } from '@config/defaults.js';

interface UninstallWizardProps {
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

type UninstallStep = 'confirm' | 'deleting' | 'done' | 'error';

export function UninstallWizard({ onConfirm, onCancel }: UninstallWizardProps): React.JSX.Element {
  const { exit } = useApp();
  const [step, setStep] = useState<UninstallStep>('confirm');
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (step === 'confirm') {
      if (input.toLowerCase() === 'y') {
        setStep('deleting');
        onConfirm()
          .then(() => setStep('done'))
          .catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setStep('error');
          });
      } else if (input.toLowerCase() === 'n' || key.escape) {
        onCancel();
        exit();
      }
    } else if (step === 'done' || step === 'error') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {step === 'confirm' && (
        <Box flexDirection="column">
          <Text color="red" bold>WARNING: This will permanently delete the {AGENTKIT_DIR}/ directory.</Text>
          <Text>All configuration, database records, and local team/prompt copies will be lost.</Text>
          <Text>{''}</Text>
          <Text>Are you sure you want to proceed? [y/N]</Text>
        </Box>
      )}

      {step === 'deleting' && (
        <Box gap={1}>
          <Spinner label={`Removing ${AGENTKIT_DIR}/ directory...`} />
        </Box>
      )}

      {step === 'done' && (
        <Box flexDirection="column">
          <Text color="green" bold>Done! The {AGENTKIT_DIR}/ directory has been removed.</Text>
          <Text color="gray">Press any key to exit.</Text>
        </Box>
      )}

      {step === 'error' && (
        <Box flexDirection="column">
          <Text color="red" bold>Error during uninstall:</Text>
          <Text>{error}</Text>
          <Text color="gray">Press any key to exit.</Text>
        </Box>
      )}
    </Box>
  );
}
