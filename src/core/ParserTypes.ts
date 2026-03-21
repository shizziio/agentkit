export interface ParsedStory {
  key: string;
  title: string;
  content: string;
  contentHash: string;
  orderIndex: number;
  dependsOn?: string[];
}

export interface ParsedEpic {
  key: string;
  title: string;
  description: string;
  contentHash: string;
  stories: ParsedStory[];
  orderIndex: number;
  dependsOn?: string[];
  team?: string;
  contracts?: string[];
}

export interface ParsedContent {
  epics: ParsedEpic[];
}
