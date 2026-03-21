import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { UninstallService } from '@core/UninstallService.js';
import { UninstallWizard } from '@ui/uninstall/UninstallWizard.js';
import { AGENTKIT_DIR } from '@config/defaults.js';
import { Logger } from '@core/Logger.js';

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description(`Remove the ${AGENTKIT_DIR}/ directory and all its data`)
    .option('--force', 'Skip confirmation and delete immediately')
    .action(async (options) => {
      const logger = Logger.getOrNoop('CLI:Uninstall');
      logger.info('uninstall: invoked');
      const service = new UninstallService();

      if (!service.checkExists(process.cwd())) {
        process.stderr.write(`Error: No ${AGENTKIT_DIR}/ directory found in the current directory.\n`);
        process.exit(1);
      }

      if (options.force) {
        try {
          service.uninstall(process.cwd());
          process.stdout.write(`Successfully removed ${AGENTKIT_DIR}/ directory.\n`);
          process.exit(0);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Error: ${message}\n`);
          process.exit(1);
        }
      }

      const app = render(
        React.createElement(UninstallWizard, {
          onConfirm: async () => {
            service.uninstall(process.cwd());
          },
          onCancel: () => {
            // Nothing special needed, wizard handles exit
          }
        })
      );

      await app.waitUntilExit();
    });
}
