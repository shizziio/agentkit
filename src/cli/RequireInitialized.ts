import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AGENTKIT_DIR } from '@config/defaults.js';

export function requireInitialized(): void {
  const agentkitDir = join(process.cwd(), AGENTKIT_DIR);
  if (!existsSync(agentkitDir)) {
    process.stderr.write('Project not initialized. Run `agentkit init` first.\n');
    process.exit(1);
  }
}
