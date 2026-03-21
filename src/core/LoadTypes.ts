import type { ParsedEpic, ParsedStory, ParsedContent } from '@core/ParserTypes.js';

export type ComparisonStatus = 'new' | 'updated' | 'skipped';

export interface EpicFolderInfo {
  folderPath: string;
  epicNumber: number;
  title: string;
  storyCount: number;
}

export interface EpicComparison {
  status: ComparisonStatus;
  epicKey: string;
  title: string;
  parsedEpic: ParsedEpic;
  existingId?: number;
  oldHash?: string;
  newHash: string;
  storyComparisons: StoryComparison[];
}

export interface StoryComparison {
  status: ComparisonStatus;
  storyKey: string;
  title: string;
  parsedStory: ParsedStory;
  existingId?: number;
  oldHash?: string;
  newHash: string;
  oldContent?: string;
  newContent: string;
}

export interface ComparisonResult {
  epics: EpicComparison[];
  summary: {
    newEpics: number;
    updatedEpics: number;
    skippedEpics: number;
    newStories: number;
    updatedStories: number;
    skippedStories: number;
  };
}

export interface LoadResult {
  insertedEpics: number;
  updatedEpics: number;
  insertedStories: number;
  updatedStories: number;
}

export interface IMarkdownParser {
  parseEpicsAndStories(markdown: string): ParsedContent;
  parseEpicFolder(folderPath: string): ParsedContent;
}

export interface ILoadService {
  normalizePath(rawPath: string): string;
  compareWithDatabase(projectId: number, parsed: ParsedContent): ComparisonResult;
  saveToDatabase(projectId: number, comparison: ComparisonResult, sourceFile: string): LoadResult;
}
