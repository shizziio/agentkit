import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { EpicFolderInfo } from '@core/LoadTypes.js';
import { Logger } from '@core/Logger.js';
import { FOLDER_EPIC_H1_REGEX } from '@core/MarkdownParser.js';

const logger = Logger.getOrNoop('EpicDiscovery');

const EPIC_FOLDER_REGEX = /^epic-(\d+)$/;

const EPIC_FILE_PATTERNS = [
  /^epics?\.md$/i,
  /^epic-.*\.md$/i,
  /^epics-.*\.md$/i,
];

function getSearchDirs(projectRoot: string): string[] {
  return [
    projectRoot,
    join(projectRoot, 'docs'),
    join(projectRoot, '_agentkit-output', 'planning'),
  ];
}

export function findEpicFolders(projectRoot: string): EpicFolderInfo[] {
  const foundFolders: EpicFolderInfo[] = [];
  const seenPaths = new Set<string>();

  for (const dir of getSearchDirs(projectRoot)) {
    if (!existsSync(dir)) continue;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const match = EPIC_FOLDER_REGEX.exec(entry.name);
        if (!match) continue;

        const epicNumber = parseInt(match[1]!, 10);
        const folderPath = resolve(dir, entry.name);

        if (seenPaths.has(folderPath)) continue;

        const epicJsonPath = join(folderPath, 'epic.json');
        const epicMdPath = join(folderPath, 'epic.md');
        if (!existsSync(epicJsonPath) && !existsSync(epicMdPath)) continue;

        let title = '';
        let storyCount = 0;

        if (existsSync(epicJsonPath)) {
          try {
            const epicJsonContent = readFileSync(epicJsonPath, 'utf-8');
            const parsed = JSON.parse(epicJsonContent) as Record<string, unknown>;
            title = typeof parsed['title'] === 'string' ? parsed['title'] : '';
            storyCount = Array.isArray(parsed['stories']) ? parsed['stories'].length : 0;
          } catch {
            continue;
          }
        } else {
          try {
            const epicMdContent = readFileSync(epicMdPath, 'utf-8');
            const lines = epicMdContent.replace(/\r\n/g, '\n').split('\n');
            for (const line of lines) {
              if (line.trim() === '') continue;
              const h1Match = FOLDER_EPIC_H1_REGEX.exec(line.trimEnd());
              if (h1Match) {
                title = h1Match[2]!.trim();
                break;
              }
            }
          } catch {
            continue;
          }

          const storiesDir = join(folderPath, 'stories');
          if (existsSync(storiesDir)) {
            try {
              const storyFiles = readdirSync(storiesDir);
              storyCount = storyFiles.filter((f) => /^story-\d+\.\d+\.md$/i.test(f)).length;
            } catch {
              // skip inaccessible
            }
          }
        }

        seenPaths.add(folderPath);
        logger.debug('load: found epic folder', { folderPath, epicNumber, title, storyCount });
        foundFolders.push({ folderPath, epicNumber, title, storyCount });
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  foundFolders.sort((a, b) => b.epicNumber - a.epicNumber);
  return foundFolders;
}

export function findEpicFiles(projectRoot: string): string[] {
  const foundFiles: string[] = [];

  for (const dir of getSearchDirs(projectRoot)) {
    if (!existsSync(dir)) continue;

    try {
      const files = readdirSync(dir);
      for (const file of files) {
        const isMatch = EPIC_FILE_PATTERNS.some((p) => p.test(file));
        if (isMatch) {
          foundFiles.push(resolve(dir, file));
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return [...new Set(foundFiles)];
}
