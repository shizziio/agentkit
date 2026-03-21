import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';

import { AGENTKIT_DIR } from '@config/defaults.js';
import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('OutputFileManager');

export type ReadOutputResult =
  | { success: true; data: unknown }
  | { success: false; error: 'OUTPUT_FILE_MISSING' | 'INVALID_OUTPUT_JSON'; rawText?: string };

export function getOutputPath(projectRoot: string, taskId: number): string {
  return resolve(projectRoot, AGENTKIT_DIR, '.outputs', `task-${taskId}.json`);
}

export function ensureOutputDir(projectRoot: string): void {
  const outputDir = resolve(projectRoot, AGENTKIT_DIR, '.outputs');
  mkdirSync(outputDir, { recursive: true });
}

export function readOutputFile(outputPath: string): ReadOutputResult {
  try {
    if (!existsSync(outputPath)) {
      return { success: false, error: 'OUTPUT_FILE_MISSING' };
    }
    const fileContent = readFileSync(outputPath, 'utf-8');
    try {
      const data: unknown = JSON.parse(fileContent);
      return { success: true, data };
    } catch {
      return { success: false, error: 'INVALID_OUTPUT_JSON', rawText: fileContent };
    }
  } catch {
    return { success: false, error: 'OUTPUT_FILE_MISSING' };
  }
}

export function cleanupStaleOutputs(projectRoot: string): void {
  const outputDir = resolve(projectRoot, AGENTKIT_DIR, '.outputs');
  try {
    if (!existsSync(outputDir)) {
      return;
    }
    const entries = readdirSync(outputDir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      try {
        unlinkSync(resolve(outputDir, entry.name));
        count++;
      } catch (err) {
        logger.error('cleanupStaleOutputs: failed to delete file', { file: entry.name, err });
      }
    }
    logger.info('cleanupStaleOutputs: cleaned', { count });
  } catch (err) {
    logger.error('cleanupStaleOutputs: error', { err });
  }
}

export function deleteOutputFile(outputPath: string): void {
  try {
    if (existsSync(outputPath)) {
      unlinkSync(outputPath);
    }
  } catch (err) {
    logger.error('deleteOutputFile: error', { outputPath, err });
  }
}
