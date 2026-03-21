import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTKIT_DIR } from '@config/defaults.js';
import { AgentKitError } from './Errors.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('UninstallService');

export class UninstallService {
  checkExists(projectPath: string): boolean {
    const agentkitDir = join(projectPath, AGENTKIT_DIR);
    return existsSync(agentkitDir);
  }

  uninstall(projectPath: string): void {
    const agentkitDir = join(projectPath, AGENTKIT_DIR);

    if (!this.checkExists(projectPath)) {
      throw new AgentKitError(`No ${AGENTKIT_DIR}/ directory found in the current directory.`, 'UNINSTALL_ERROR');
    }

    logger.info('uninstall: starting', { projectDir: projectPath });

    try {
      rmSync(agentkitDir, { recursive: true, force: true });
      logger.info('uninstall: complete');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('uninstall: failed', { error: message });
      throw new AgentKitError(`Failed to remove ${AGENTKIT_DIR}/ directory: ${message}`, 'UNINSTALL_ERROR');
    }
  }
}
