import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { InitService } from '@core/InitService.js';
import { InitWizard } from '@ui/init/InitWizard.js';
import { Logger } from '@core/Logger.js';

const __dirname_current = dirname(fileURLToPath(import.meta.url));

function getPackageVersion(): string {
  try {
    const pkgPath = join(__dirname_current, '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new agentkit project')
    .action(async () => {
      try {
        const logger = Logger.getOrNoop('CLI:Init');
        logger.info('init: invoked');
        const initService = new InitService();
        const version = getPackageVersion();
        const directoryExists = initService.checkExists(process.cwd());

        const app = render(
          React.createElement(InitWizard, {
            version,
            directoryExists,
            onScaffold: (options) => {
              return Promise.resolve(initService.scaffoldProject(options));
            },
            onComplete: () => {
              app.unmount();
            },
          }),
        );

        await app.waitUntilExit();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
