import { resolve, normalize } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

import { AGENTKIT_DIR } from '@config/defaults.js';
import { ConfigError } from '@core/Errors.js';
import type { FileOwnership } from '@core/ConfigTypes.js';
import { Logger } from '@core/Logger.js';
import { getGlobalTeamsDir } from '@shared/GlobalPath.js';

const logger = Logger.getOrNoop('PromptLoader');

export function loadPrompt(promptPath: string, projectRoot: string): string {
  const localTeamsBase = resolve(projectRoot, AGENTKIT_DIR, 'teams');
  const localResolvedPath = normalize(resolve(localTeamsBase, promptPath));

  // 1. Try project-local override
  if (localResolvedPath.startsWith(localTeamsBase) && existsSync(localResolvedPath)) {
    try {
      const content = readFileSync(localResolvedPath, 'utf-8');
      logger.debug('promptLoader: loaded', { stageName: promptPath, source: 'local' });
      return content;
    } catch {
      // Ignore and fallback
    }
  }

  // 2. Fallback to global (~/.agentkit/teams/)
  const bundledTeamsBase = getGlobalTeamsDir();
  const bundledResolvedPath = normalize(resolve(bundledTeamsBase, promptPath));

  if (!bundledResolvedPath.startsWith(bundledTeamsBase)) {
    logger.error('promptLoader: load failed', { stageName: promptPath, error: 'Path escapes teams directory' });
    throw new ConfigError(`Prompt path escapes teams directory: ${promptPath}`);
  }

  logger.warn('promptLoader: file not found, using fallback', { stageName: promptPath, path: localResolvedPath });

  try {
    const content = readFileSync(bundledResolvedPath, 'utf-8');
    logger.debug('promptLoader: loaded', { stageName: promptPath, source: 'bundled' });
    return content;
  } catch {
    logger.error('promptLoader: load failed', { stageName: promptPath, error: 'Prompt file not found' });
    throw new ConfigError(`Prompt file not found: ${promptPath}`);
  }
}

export interface InjectInputOptions {
  input: string;
  taskId?: number;
  storyTitle?: string;
  storyContent?: string;
  outputFile?: string;
}

const STAGE_LABELS: Record<string, string> = {
  sm: 'SM Plan',
  tester: 'Test Cases',
  review: 'Review Feedback',
  dev: 'Developer Output',
};

/**
 * If input is a chain JSON (from Router.buildChainInput), format it as
 * labeled sections so the AI agent sees all ancestor context clearly.
 * Falls through to raw input for non-chain inputs (e.g. first stage).
 */
function formatChainInput(input: string): string {
  try {
    const parsed: unknown = JSON.parse(input);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'chain' in parsed &&
      Array.isArray((parsed as { chain: unknown }).chain)
    ) {
      const chain = (parsed as { chain: Array<{ stage: string; taskId: number; output: string }> }).chain;
      const sections: string[] = [];
      const lastIdx = chain.length - 1;

      for (let i = 0; i < chain.length; i++) {
        const entry = chain[i];
        if (!entry) continue;
        const label = STAGE_LABELS[entry.stage] ?? entry.stage;
        const suffix = i === lastIdx ? ' — LATEST' : '';
        sections.push(`### ${label} (Task #${entry.taskId})${suffix}\n${entry.output}`);
      }

      return sections.join('\n\n');
    }
  } catch {
    // Not JSON or not chain format — fall through
  }
  return input;
}

const RESUME_PROMPT_TEMPLATE = `You are continuing work on Story {{STORY_TITLE}}.
Review feedback:
{{TASK_INPUT}}

Continue from your previous session. Output to: {{OUTPUT_FILE}}`;

export function extractLatestFeedback(chainInput: string | null): string {
  if (!chainInput) return '(no previous feedback)';
  try {
    const parsed: unknown = JSON.parse(chainInput);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'chain' in parsed &&
      Array.isArray((parsed as { chain: unknown }).chain)
    ) {
      const chain = (parsed as { chain: Array<{ output?: string }> }).chain;
      if (chain.length > 0) {
        const last = chain[chain.length - 1];
        return last?.output ?? '(empty output)';
      }
    }
  } catch {
    // Not JSON — fall through
  }
  return chainInput;
}

export function buildResumePrompt(
  storyTitle: string,
  chainInput: string | null,
  outputFile: string
): string {
  const feedback = extractLatestFeedback(chainInput);
  return RESUME_PROMPT_TEMPLATE
    .replace(/\{\{STORY_TITLE\}\}/g, storyTitle)
    .replace(/\{\{TASK_INPUT\}\}/g, feedback)
    .replace(/\{\{OUTPUT_FILE\}\}/g, outputFile);
}

export function injectInput(template: string, options: InjectInputOptions): string {
  const { input, taskId, storyTitle, storyContent, outputFile } = options;

  const formattedInput = formatChainInput(input);
  let result: string;

  if (template.includes('{{TASK_INPUT}}')) {
    result = template.replace(/\{\{TASK_INPUT\}\}/g, formattedInput);
    if (taskId !== undefined) {
      result = result.replace(/\{\{TASK_ID\}\}/g, String(taskId));
    }
    result = result.replace(/\{\{STORY_TITLE\}\}/g, storyTitle ?? '');
    result = result.replace(/\{\{STORY_CONTENT\}\}/g, storyContent ?? '');
  } else {
    result = `${template}\n\n---\nINPUT:\n${formattedInput}`;
  }

  if (outputFile !== undefined) {
    result = result.replace(/\{\{OUTPUT_FILE\}\}/g, outputFile);
  }

  return result;
}

/**
 * Build a file ownership section to inject into stage prompts.
 * Returns empty string if ownership is not configured.
 */
export function buildOwnershipSection(teamName: string, ownership?: FileOwnership): string {
  if (!ownership || !ownership.include || ownership.include.length === 0) return '';

  const lines: string[] = [
    '',
    `## File Ownership (team: ${teamName})`,
    `You MUST only modify files matching: ${ownership.include.join(', ')}`,
    'You MUST NOT modify files outside these patterns.',
  ];

  if (ownership.exclude && ownership.exclude.length > 0) {
    lines.push(`Excluded from ownership: ${ownership.exclude.join(', ')}`);
  }

  lines.push('If you need changes outside your scope, document it as a contract request in the output.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Read and return the content of a contract file, if it exists.
 * Contract paths are relative to the project root's _agentkit-output/planning/ directory.
 */
export function loadContractContent(contractPath: string, projectRoot: string): string | null {
  const fullPath = resolve(projectRoot, '_agentkit-output', 'planning', contractPath);
  if (!existsSync(fullPath)) return null;
  try {
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Parse an architect.md file for consumed contract references.
 * Looks for lines like: `epic-{M}/contracts/{name}.contract.md`
 * Returns an array of relative paths (relative to _agentkit-output/planning/).
 */
export function parseConsumedContracts(architectContent: string): string[] {
  const contractPaths: string[] = [];
  const regex = /epic-\d+\/contracts\/[\w.-]+\.contract\.md/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(architectContent)) !== null) {
    if (!contractPaths.includes(match[0])) {
      contractPaths.push(match[0]);
    }
  }
  return contractPaths;
}

/**
 * Load consumed contracts from an epic's architect.md and build a section
 * to inject into review/tester stage prompts.
 *
 * @param epicKey - The epic key (e.g. "31") to find its architect.md
 * @param projectRoot - Project root directory
 * @returns Contract section string to append to prompt, or empty string
 */
export function buildConsumedContractsSection(epicKey: string, projectRoot: string): string {
  const architectPath = resolve(
    projectRoot, '_agentkit-output', 'planning', `epic-${epicKey}`, 'architect.md'
  );

  if (!existsSync(architectPath)) return '';

  let architectContent: string;
  try {
    architectContent = readFileSync(architectPath, 'utf-8');
  } catch {
    return '';
  }

  const contractPaths = parseConsumedContracts(architectContent);
  if (contractPaths.length === 0) return '';

  const sections: string[] = [
    '',
    '## Consumed Contracts (verify implementation matches these)',
  ];

  for (const contractPath of contractPaths) {
    const content = loadContractContent(contractPath, projectRoot);
    if (content) {
      sections.push('');
      sections.push(`### Contract: ${contractPath}`);
      sections.push(content);
    } else {
      logger.warn('promptLoader: consumed contract not found', { contractPath });
      sections.push('');
      sections.push(`### Contract: ${contractPath} (NOT FOUND)`);
    }
  }

  sections.push('');
  return sections.join('\n');
}

/**
 * Build a rules section from enabled custom rules.
 * Returns empty string if no rules are enabled.
 */
export function buildRulesSection(rulesContent: string): string {
  if (!rulesContent) return '';
  return `\n\n## Project Rules\n\nThe following rules MUST be followed in all work:\n\n${rulesContent}\n`;
}
