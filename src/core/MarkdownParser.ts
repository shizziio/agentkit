import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { ParsedContent, ParsedEpic, ParsedStory } from '@core/ParserTypes.js';
import { LoadError, ParserError, ConfigError } from '@core/Errors.js';
import type { IMarkdownParser } from '@core/LoadTypes.js';

const EPIC_REGEX = /^##\s+Epic\s+(\d+):\s*(.+)$/;
const STORY_REGEX = /^###\s+Story\s+(\d+\.\d+):\s*(.+)$/;

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export class MarkdownParser implements IMarkdownParser {
  public parseEpicsAndStories(markdown: string): ParsedContent {
    const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    const epics: ParsedEpic[] = [];

    interface EpicAccum {
      key: string;
      title: string;
      startLine: number;
      descriptionLines: string[];
      stories: StoryAccum[];
    }

    interface StoryAccum {
      key: string;
      title: string;
      contentLines: string[];
    }

    let currentEpic: EpicAccum | null = null;
    let currentStory: StoryAccum | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Start an epic
      const epicMatch = EPIC_REGEX.exec(line.trimEnd());
      if (epicMatch) {
        if (currentStory && currentEpic) {
          currentEpic.stories.push(currentStory);
          currentStory = null;
        }
        if (currentEpic) {
          this.finalizeEpic(currentEpic, epics, lines);
        }
        currentEpic = {
          key: epicMatch[1]!,
          title: epicMatch[2]!.trim(),
          startLine: i,
          descriptionLines: [],
          stories: [],
        };
        currentStory = null;
        continue;
      }

      // Any level-2 heading (##) that didn't match EPIC_REGEX is malformed
      if (/^##[^#]/.test(line)) {
        throw new ParserError(`Malformed ## heading: "${line.trimEnd()}"`, i + 1);
      }

      // Start a story (only if we are inside an epic)
      const storyMatch = STORY_REGEX.exec(line.trimEnd());
      if (storyMatch && currentEpic) {
        if (currentStory) {
          currentEpic.stories.push(currentStory);
        }
        currentStory = {
          key: storyMatch[1]!,
          title: storyMatch[2]!.trim(),
          contentLines: [line],
        };
        continue;
      }

      // Any level-3 heading (###) that didn't match STORY_REGEX is malformed
      if (/^###[^#]/.test(line)) {
        throw new ParserError(`Malformed ### heading: "${line.trimEnd()}"`, i + 1);
      }

      // Accumulate content if we are inside a block
      if (currentStory) {
        currentStory.contentLines.push(line);
      } else if (currentEpic) {
        currentEpic.descriptionLines.push(line);
      }
      // Else: ignore content before the first epic
    }

    // Finalize last epic
    if (currentEpic) {
      if (currentStory) {
        currentEpic.stories.push(currentStory);
      }
      this.finalizeEpic(currentEpic, epics, lines);
    }

    return { epics };
  }

  private finalizeEpic(
    accum: {
      key: string;
      title: string;
      startLine: number;
      descriptionLines: string[];
      stories: { key: string; title: string; contentLines: string[] }[];
    },
    epics: ParsedEpic[],
    allLines: string[],
  ): void {
    // Find the end of this epic block: next epic heading or EOF
    let endLine = allLines.length;
    for (let j = accum.startLine + 1; j < allLines.length; j++) {
      if (EPIC_REGEX.test(allLines[j]!.trimEnd())) {
        endLine = j;
        break;
      }
    }

    const epicBlockLines = allLines.slice(accum.startLine, endLine);
    const epicBlockText = this.trimTrailingBlankLines(epicBlockLines).join('\n');
    const epicHash = sha256(epicBlockText);

    const description = this.trimTrailingBlankLines(accum.descriptionLines).join('\n').trim();

    const stories: ParsedStory[] = accum.stories.map((s, idx) => {
      const storyContent = this.trimTrailingBlankLines(s.contentLines).join('\n');
      return {
        key: s.key,
        title: s.title,
        content: storyContent,
        contentHash: sha256(storyContent),
        orderIndex: idx,
      };
    });

    epics.push({
      key: accum.key,
      title: accum.title,
      description,
      contentHash: epicHash,
      stories,
      orderIndex: epics.length,
    });
  }

  private trimTrailingBlankLines(lines: string[]): string[] {
    const result = [...lines];
    while (result.length > 0 && result[result.length - 1]!.trim() === '') {
      result.pop();
    }
    return result;
  }

  public parseEpicJson(jsonPath: string): ParsedContent {
    interface EpicJsonStory {
      key: string;
      title: string;
      file: string;
      dependsOn?: string[];
    }

    interface EpicJsonSchema {
      $schema: string;
      key: string;
      title: string;
      team?: string;
      dependsOn?: string[];
      stories: EpicJsonStory[];
    }

    const rawJson = readFileSync(jsonPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConfigError(`epic.json parse error: ${jsonPath}: ${msg}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new ConfigError(`epic.json must be an object: ${jsonPath}`);
    }

    const obj = parsed as Record<string, unknown>;

    if (obj['$schema'] !== 'agentkit-epic-v1') {
      throw new ConfigError(`epic.json $schema must be "agentkit-epic-v1": ${jsonPath}`);
    }
    if (typeof obj['key'] !== 'string' || !obj['key']) {
      throw new ConfigError(`epic.json missing required field "key": ${jsonPath}`);
    }
    if (typeof obj['title'] !== 'string' || !obj['title']) {
      throw new ConfigError(`epic.json missing required field "title": ${jsonPath}`);
    }
    if (!Array.isArray(obj['stories'])) {
      throw new ConfigError(`epic.json "stories" must be an array: ${jsonPath}`);
    }

    const schema = obj as unknown as EpicJsonSchema;
    const folderDir = dirname(jsonPath);

    const parsedStories: ParsedStory[] = [];

    for (const story of schema.stories) {
      if (typeof story.key !== 'string' || !story.key) {
        throw new ConfigError(`epic.json story entry missing "key" field: ${jsonPath}`);
      }
      if (typeof story.title !== 'string' || !story.title) {
        throw new ConfigError(`epic.json story entry missing "title" field: ${jsonPath}`);
      }
      if (typeof story.file !== 'string' || !story.file) {
        throw new ConfigError(`epic.json story entry missing "file" field: ${jsonPath}`);
      }

      const storyMdPath = join(folderDir, story.file);
      if (!existsSync(storyMdPath)) {
        throw new ConfigError(`Story file not found: ${story.file}`);
      }

      const rawContent = readFileSync(storyMdPath, 'utf-8');

      parsedStories.push({
        key: story.key,
        title: story.title,
        content: rawContent,
        contentHash: sha256(rawContent),
        orderIndex: 0, // assigned after sort
        dependsOn: Array.isArray(story.dependsOn) ? story.dependsOn : [],
      });
    }

    // Sort stories by numeric key (e.g. '21.2' < '21.10')
    parsedStories.sort((a, b) => {
      const [aMajor, aMinor] = a.key.split('.').map(Number) as [number, number];
      const [bMajor, bMinor] = b.key.split('.').map(Number) as [number, number];
      if (aMajor !== bMajor) return aMajor - bMajor;
      return aMinor - bMinor;
    });

    for (let i = 0; i < parsedStories.length; i++) {
      parsedStories[i]!.orderIndex = i;
    }

    // Discover contract files from epic folder
    const contractFiles = this.discoverContracts(folderDir);

    const epicResult: ParsedEpic = {
      key: schema.key,
      title: schema.title,
      description: '',
      contentHash: sha256(rawJson),
      stories: parsedStories,
      orderIndex: 0,
      dependsOn: Array.isArray(schema.dependsOn) ? schema.dependsOn : [],
      team: typeof schema.team === 'string' && schema.team ? schema.team : undefined,
      contracts: contractFiles.length > 0 ? contractFiles : undefined,
    };

    return { epics: [epicResult] };
  }

  public parseEpicFolder(folderPath: string): ParsedContent {
    const epicJsonPath = join(folderPath, 'epic.json');
    if (existsSync(epicJsonPath)) {
      return this.parseEpicJson(epicJsonPath);
    }

    const epicMdPath = join(folderPath, 'epic.md');
    if (!existsSync(epicMdPath)) {
      throw new LoadError(`Epic folder missing epic.md: ${folderPath}`);
    }

    const rawEpicContent = readFileSync(epicMdPath, 'utf-8');
    const epicContent = rawEpicContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const epicLines = epicContent.split('\n');

    let epicKey = '';
    let epicTitle = '';
    let headerLineIndex = -1;
    for (let i = 0; i < epicLines.length; i++) {
      const line = epicLines[i]!;
      if (line.trim() === '') continue;
      const match = FOLDER_EPIC_H1_REGEX.exec(line.trimEnd());
      if (match) {
        epicKey = match[1]!;
        epicTitle = match[2]!.trim();
        headerLineIndex = i;
        break;
      }
    }

    if (headerLineIndex === -1) {
      throw new LoadError(`Invalid epic.md format: ${folderPath}`);
    }

    const contentHash = sha256(rawEpicContent);

    // Extract description: lines between header and first ## heading (or EOF)
    const descriptionLines: string[] = [];
    for (let i = headerLineIndex + 1; i < epicLines.length; i++) {
      const line = epicLines[i]!;
      if (line.startsWith('## ')) break;
      descriptionLines.push(line);
    }
    const description = this.trimTrailingBlankLines(descriptionLines).join('\n').trim();

    // Read stories
    const storiesDir = join(folderPath, 'stories');
    const parsedStories: ParsedStory[] = [];

    if (existsSync(storiesDir)) {
      let storyFiles: string[] = [];
      try {
        storyFiles = readdirSync(storiesDir).filter((f) =>
          /^story-\d+\.\d+\.md$/i.test(f),
        );
      } catch {
        // skip inaccessible
      }

      for (const storyFile of storyFiles) {
        const storyPath = join(storiesDir, storyFile);
        const rawStoryContent = readFileSync(storyPath, 'utf-8');
        const storyContent = rawStoryContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const storyLines = storyContent.split('\n');

        let storyKey = '';
        let storyTitle = '';
        for (const line of storyLines) {
          if (line.trim() === '') continue;
          const match = FOLDER_STORY_H1_REGEX.exec(line.trimEnd());
          if (match) {
            storyKey = match[1]!;
            storyTitle = match[2]!.trim();
            break;
          }
        }

        if (!storyKey) {
          throw new LoadError(`Invalid story file format: ${storyPath}`);
        }

        parsedStories.push({
          key: storyKey,
          title: storyTitle,
          content: storyContent,
          contentHash: sha256(rawStoryContent),
          orderIndex: 0, // assigned after sort
        });
      }
    }

    // Sort stories by numeric key (e.g. '1.9' < '1.10')
    parsedStories.sort((a, b) => {
      // Safe: key format 'N.M' guaranteed by FOLDER_STORY_H1_REGEX match before push
      const [aMajor, aMinor] = a.key.split('.').map(Number) as [number, number];
      const [bMajor, bMinor] = b.key.split('.').map(Number) as [number, number];
      if (aMajor !== bMajor) return aMajor - bMajor;
      return aMinor - bMinor;
    });

    // Assign orderIndex after sort
    for (let i = 0; i < parsedStories.length; i++) {
      parsedStories[i]!.orderIndex = i;
    }

    // Discover contract files
    const contractFiles = this.discoverContracts(folderPath);

    const epicResult: ParsedEpic = {
      key: epicKey,
      title: epicTitle,
      description,
      contentHash,
      stories: parsedStories,
      orderIndex: 0,
      contracts: contractFiles.length > 0 ? contractFiles : undefined,
    };

    return { epics: [epicResult] };
  }

  private discoverContracts(folderPath: string): string[] {
    const contractsDir = join(folderPath, 'contracts');
    if (!existsSync(contractsDir)) return [];
    try {
      return readdirSync(contractsDir)
        .filter((f) => f.endsWith('.contract.md'))
        .sort();
    } catch {
      return [];
    }
  }
}

export const FOLDER_EPIC_H1_REGEX = /^#\s+Epic\s+(\d+):\s*(.+)$/;
const FOLDER_STORY_H1_REGEX = /^#\s+Story\s+(\d+\.\d+):\s*(.+)$/;

/** @deprecated Use MarkdownParser class */
export function parseEpicsAndStories(markdown: string): ParsedContent {
  return new MarkdownParser().parseEpicsAndStories(markdown);
}

/** @deprecated Use MarkdownParser class */
export function parseEpicFolder(folderPath: string): ParsedContent {
  return new MarkdownParser().parseEpicFolder(folderPath);
}
