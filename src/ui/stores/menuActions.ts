import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { AGENTKIT_DIR } from '@config/defaults.js';
import { ReadinessChecker } from '@core/ReadinessChecker.js';
import { launchInteractiveSession } from '@shared/InteractiveSession.js';
import { useDashboardStore } from './dashboardStore.js';
import { useWorkerStore } from './workerStore.js';
import { useAppStore } from './appStore.js';
import { useMenuStore } from './menuStore.js';
import type { ActionMode } from '@ui/dashboard/shared/DashboardTypes.js';
import { ACTION_MODES } from '@ui/dashboard/shared/DashboardTypes.js';

function isActionMode(action: string): action is Exclude<ActionMode, 'none'> {
  return (ACTION_MODES as readonly string[]).includes(action);
}

/**
 * Centralized menu action handler — called from CommandMenuPanel and KeyBindings.
 * Reads all state from stores via getState() — no React dependency.
 */
export function handleMenuAction(action: string): void {
  const isPipelineRunning = useWorkerStore.getState().pipelineState === 'running';
  const { openAction, toggleTrace } = useDashboardStore.getState();
  const { onToggleWorkers, onEnterTrace, pipelineConfig } = useAppStore.getState();
  const { push } = useMenuStore.getState();

  switch (action) {
    case 'run':
    case 'run-pipeline':
      if (isPipelineRunning) {
        openAction('drain-confirm');
      } else {
        onToggleWorkers?.();
      }
      break;
    case 'drain-pipeline':
      openAction('drain-confirm');
      break;
    case 'stop-pipeline':
      openAction('terminate-confirm');
      break;
    case 'trace':
      toggleTrace();
      onEnterTrace?.();
      break;
    case 'quit':
      openAction('quit-confirm');
      break;

    case 'chat':
    case 'ask-agent':
      openAction('ask-agent');
      break;

    case 'epic-story-mgmt':
    case 'task-mgmt':
    case 'config':
      push(action);
      break;

    case 'create-planning':
    case 'ask-agentkit': {
      if (isPipelineRunning) {
        openAction(action as Exclude<ActionMode, 'none'>);
      } else {
        const provider = pipelineConfig?.provider ?? 'claude-cli';
        const projectRoot = process.cwd();
        const resolvePath = (rel: string): string => {
          const p = join(projectRoot, AGENTKIT_DIR, 'resources', rel);
          return existsSync(p) ? p : p;
        };

        if (action === 'create-planning') {
          const checker = new ReadinessChecker(projectRoot);
          const readiness = checker.check();
          const teamStep = readiness.steps.find(s => s.id === 'team-config');
          if (teamStep?.status === 'missing') {
            openAction('create-planning');
            break;
          }

          launchInteractiveSession({
            provider,
            systemPromptFiles: [
              resolvePath('agents/architect.md'),
              resolvePath('workflows/planning.md'),
            ],
          });
        } else {
          launchInteractiveSession({
            provider,
            systemPromptFiles: [
              resolvePath('agents/agent-kit-master.md'),
            ],
          });
        }
      }
      break;
    }

    default:
      if (isActionMode(action)) {
        openAction(action);
      }
  }
}
