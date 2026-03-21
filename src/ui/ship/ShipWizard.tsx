import React from 'react';

import { useProjectId, useDb, usePipelineConfig } from '@ui/stores/appStore.js';

import { ShipTreePicker } from './ShipTreePicker.js';

export interface ShipWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  compact?: boolean;
  height?: number;
}

export function ShipWizard({
  onComplete,
  onCancel,
  compact = false,
  height,
}: ShipWizardProps): React.JSX.Element {
  const projectId = useProjectId();
  const db = useDb();
  const pipelineConfig = usePipelineConfig();
  const firstStageName = pipelineConfig.stages[0]?.name ?? '';
  const activeTeam = pipelineConfig.team;

  return (
    <ShipTreePicker
      projectId={projectId}
      db={db}
      firstStageName={firstStageName}
      activeTeam={activeTeam}
      onComplete={onComplete}
      onCancel={onCancel}
      compact={compact}
      height={height}
    />
  );
}
