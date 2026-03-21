import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import * as fs from 'node:fs';
import { MarkdownParser } from '@core/MarkdownParser.js';
import { ConfigError } from '@core/Errors.js';

const existsSyncMock = vi.mocked(fs.existsSync);
const readFileSyncMock = vi.mocked(fs.readFileSync);

function makeEpicJson(overrides: Record<string, unknown> = {}): string {
  const base = {
    $schema: 'agentkit-epic-v1',
    key: '21',
    title: 'Epic 21: JSON Schema Upgrade',
    stories: [
      {
        key: '21.1',
        title: 'Story 21.1: Parser Upgrade',
        file: 'stories/story-21.1.md',
        dependsOn: [],
      },
    ],
    ...overrides,
  };
  return JSON.stringify(base);
}

describe('MarkdownParser', () => {
  let parser: MarkdownParser;

  beforeEach(() => {
    vi.resetAllMocks();
    parser = new MarkdownParser();
  });

  // ────────────────────────────────────────────────────────────
  // AC1: Valid epic.json is parsed correctly
  // ────────────────────────────────────────────────────────────
  describe('parseEpicJson', () => {
    it('should return ParsedContent with epic metadata from epic.json (AC1)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      const storyContent = '# Story 21.1: Parser Upgrade\n\nStory content here.\n';

      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === jsonPath) return makeEpicJson();
        if (path === '/project/epic-21/stories/story-21.1.md') return storyContent;
        return '';
      });
      existsSyncMock.mockImplementation((p) => {
        return String(p) === '/project/epic-21/stories/story-21.1.md';
      });

      const result = parser.parseEpicJson(jsonPath);

      expect(result.epics).toHaveLength(1);
      const epic = result.epics[0]!;
      expect(epic.key).toBe('21');
      expect(epic.title).toBe('Epic 21: JSON Schema Upgrade');
      expect(epic.stories).toHaveLength(1);
    });

    it('should read story content from the .md file referenced by the file field (AC1)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      const storyContent = '# Story 21.1: Parser Upgrade\n\nFull story text.\n';

      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === jsonPath) return makeEpicJson();
        if (path === '/project/epic-21/stories/story-21.1.md') return storyContent;
        return '';
      });
      existsSyncMock.mockImplementation((p) => {
        return String(p) === '/project/epic-21/stories/story-21.1.md';
      });

      const result = parser.parseEpicJson(jsonPath);
      const story = result.epics[0]!.stories[0]!;

      expect(story.content).toBe(storyContent);
      expect(story.key).toBe('21.1');
      expect(story.title).toBe('Story 21.1: Parser Upgrade');
    });

    // ────────────────────────────────────────────────────────────
    // AC2: dependsOn preserved in ParsedStory
    // ────────────────────────────────────────────────────────────
    it('should preserve dependsOn array from epic.json story entry (AC2)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      const jsonWithDeps = makeEpicJson({
        stories: [
          {
            key: '21.2',
            title: 'Story 21.2: Depends',
            file: 'stories/story-21.2.md',
            dependsOn: ['21.1'],
          },
        ],
      });

      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === jsonPath) return jsonWithDeps;
        if (path === '/project/epic-21/stories/story-21.2.md') return '# Story 21.2: Depends\n\nContent\n';
        return '';
      });
      existsSyncMock.mockImplementation((p) => {
        return String(p) === '/project/epic-21/stories/story-21.2.md';
      });

      const result = parser.parseEpicJson(jsonPath);
      const story = result.epics[0]!.stories[0]!;

      expect(story.dependsOn).toEqual(['21.1']);
    });

    it('should default dependsOn to [] when field is absent from story entry (edge case)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      const jsonNoDeps = JSON.stringify({
        $schema: 'agentkit-epic-v1',
        key: '21',
        title: 'Epic 21',
        stories: [
          {
            key: '21.1',
            title: 'Story 21.1',
            file: 'stories/story-21.1.md',
            // no dependsOn
          },
        ],
      });

      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === jsonPath) return jsonNoDeps;
        if (path === '/project/epic-21/stories/story-21.1.md') return '# Story 21.1: Title\n\nContent\n';
        return '';
      });
      existsSyncMock.mockImplementation((p) => {
        return String(p) === '/project/epic-21/stories/story-21.1.md';
      });

      const result = parser.parseEpicJson(jsonPath);
      const story = result.epics[0]!.stories[0]!;

      expect(story.dependsOn).toEqual([]);
    });

    // ────────────────────────────────────────────────────────────
    // AC4: Invalid JSON throws ConfigError (no fallback)
    // ────────────────────────────────────────────────────────────
    it('should throw ConfigError on JSON syntax error (AC4)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      readFileSyncMock.mockReturnValue('{ invalid json :::');

      expect(() => parser.parseEpicJson(jsonPath)).toThrow(ConfigError);
      expect(() => parser.parseEpicJson(jsonPath)).toThrow(/epic\.json parse error/i);
    });

    it('should throw ConfigError with path info on JSON syntax error (AC4)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      readFileSyncMock.mockReturnValue('{broken:}');

      expect(() => parser.parseEpicJson(jsonPath)).toThrow(jsonPath);
    });

    it('should throw ConfigError when required field "key" is missing (AC4)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      readFileSyncMock.mockReturnValue(
        JSON.stringify({ $schema: 'agentkit-epic-v1', title: 'Epic 21', stories: [] }),
      );

      expect(() => parser.parseEpicJson(jsonPath)).toThrow(ConfigError);
    });

    it('should throw ConfigError when required field "title" is missing (AC4)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      readFileSyncMock.mockReturnValue(
        JSON.stringify({ $schema: 'agentkit-epic-v1', key: '21', stories: [] }),
      );

      expect(() => parser.parseEpicJson(jsonPath)).toThrow(ConfigError);
    });

    it('should throw ConfigError when required field "stories" is missing (AC4)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      readFileSyncMock.mockReturnValue(
        JSON.stringify({ $schema: 'agentkit-epic-v1', key: '21', title: 'Epic 21' }),
      );

      expect(() => parser.parseEpicJson(jsonPath)).toThrow(ConfigError);
    });

    it('should throw ConfigError when "stories" is not an array (AC4)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      readFileSyncMock.mockReturnValue(
        JSON.stringify({ $schema: 'agentkit-epic-v1', key: '21', title: 'Epic 21', stories: 'not-array' }),
      );

      expect(() => parser.parseEpicJson(jsonPath)).toThrow(ConfigError);
    });

    it('should throw ConfigError when $schema value is not "agentkit-epic-v1" (edge case)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      readFileSyncMock.mockReturnValue(
        JSON.stringify({ $schema: 'wrong-schema', key: '21', title: 'Epic 21', stories: [] }),
      );

      expect(() => parser.parseEpicJson(jsonPath)).toThrow(ConfigError);
    });

    // ────────────────────────────────────────────────────────────
    // AC5: Story file missing throws ConfigError
    // ────────────────────────────────────────────────────────────
    it('should throw ConfigError when referenced story file does not exist (AC5)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      readFileSyncMock.mockImplementation((p) => {
        if (String(p) === jsonPath) return makeEpicJson({
          stories: [
            { key: '21.9', title: 'Story 21.9', file: 'stories/story-21.9.md', dependsOn: [] },
          ],
        });
        return '';
      });
      existsSyncMock.mockReturnValue(false);

      expect(() => parser.parseEpicJson(jsonPath)).toThrow(ConfigError);
      expect(() => parser.parseEpicJson(jsonPath)).toThrow('Story file not found: stories/story-21.9.md');
    });

    // ────────────────────────────────────────────────────────────
    // AC6: Stories sorted in ascending numeric key order
    // ────────────────────────────────────────────────────────────
    it('should sort stories in ascending numeric key order (e.g. 21.2 before 21.10) (AC6)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      const unsortedJson = JSON.stringify({
        $schema: 'agentkit-epic-v1',
        key: '21',
        title: 'Epic 21',
        stories: [
          { key: '21.10', title: 'Story 21.10', file: 'stories/story-21.10.md', dependsOn: [] },
          { key: '21.2', title: 'Story 21.2', file: 'stories/story-21.2.md', dependsOn: [] },
          { key: '21.9', title: 'Story 21.9', file: 'stories/story-21.9.md', dependsOn: [] },
        ],
      });

      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === jsonPath) return unsortedJson;
        if (path.endsWith('.md')) return `# Story X\n\nContent\n`;
        return '';
      });
      existsSyncMock.mockImplementation((p) => String(p).endsWith('.md'));

      const result = parser.parseEpicJson(jsonPath);
      const stories = result.epics[0]!.stories;

      expect(stories).toHaveLength(3);
      expect(stories[0]!.key).toBe('21.2');
      expect(stories[1]!.key).toBe('21.9');
      expect(stories[2]!.key).toBe('21.10');
    });

    it('should assign orderIndex sequentially after sort (AC6)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      const unsortedJson = JSON.stringify({
        $schema: 'agentkit-epic-v1',
        key: '21',
        title: 'Epic 21',
        stories: [
          { key: '21.10', title: 'Story 21.10', file: 'stories/story-21.10.md', dependsOn: [] },
          { key: '21.1', title: 'Story 21.1', file: 'stories/story-21.1.md', dependsOn: [] },
        ],
      });

      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === jsonPath) return unsortedJson;
        if (path.endsWith('.md')) return '# Story X\n\nContent\n';
        return '';
      });
      existsSyncMock.mockImplementation((p) => String(p).endsWith('.md'));

      const result = parser.parseEpicJson(jsonPath);
      const stories = result.epics[0]!.stories;

      expect(stories[0]!.key).toBe('21.1');
      expect(stories[0]!.orderIndex).toBe(0);
      expect(stories[1]!.key).toBe('21.10');
      expect(stories[1]!.orderIndex).toBe(1);
    });

    // ────────────────────────────────────────────────────────────
    // Edge: empty stories array
    // ────────────────────────────────────────────────────────────
    it('should return ParsedEpic with empty stories array when stories is [] (edge case)', () => {
      const jsonPath = '/project/epic-21/epic.json';
      readFileSyncMock.mockReturnValue(
        JSON.stringify({ $schema: 'agentkit-epic-v1', key: '21', title: 'Epic 21', stories: [] }),
      );

      const result = parser.parseEpicJson(jsonPath);
      expect(result.epics[0]!.stories).toHaveLength(0);
    });
  });

  // ────────────────────────────────────────────────────────────
  // parseEpicFolder — epic.json path
  // ────────────────────────────────────────────────────────────
  describe('parseEpicFolder (epic.json integration)', () => {
    it('should use epic.json when present (AC1 via parseEpicFolder)', () => {
      const folderPath = '/project/epic-21';
      const storyContent = '# Story 21.1: Parser Upgrade\n\nStory text.\n';

      existsSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === `${folderPath}/epic.json`) return true;
        if (path === `${folderPath}/stories/story-21.1.md`) return true;
        return false;
      });
      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === `${folderPath}/epic.json`) return makeEpicJson();
        if (path === `${folderPath}/stories/story-21.1.md`) return storyContent;
        return '';
      });

      const result = parser.parseEpicFolder(folderPath);

      expect(result.epics).toHaveLength(1);
      expect(result.epics[0]!.key).toBe('21');
      expect(result.epics[0]!.stories[0]!.content).toBe(storyContent);
    });

    it('should NOT fall back to epic.md when epic.json exists but is invalid (AC4)', () => {
      const folderPath = '/project/epic-21';

      existsSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === `${folderPath}/epic.json`) return true;
        if (path === `${folderPath}/epic.md`) return true;
        return false;
      });
      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === `${folderPath}/epic.json`) return '{invalid json!!!';
        if (path === `${folderPath}/epic.md`) return '# Epic 21: Valid Epic\n';
        return '';
      });

      expect(() => parser.parseEpicFolder(folderPath)).toThrow(ConfigError);
    });

    it('should take epic.json precedence when both epic.json AND epic.md are present (edge case)', () => {
      const folderPath = '/project/epic-21';
      const storyContent = '# Story 21.1: Parser Upgrade\n\nContent.\n';

      existsSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === `${folderPath}/epic.json`) return true;
        if (path === `${folderPath}/epic.md`) return true;
        if (path === `${folderPath}/stories/story-21.1.md`) return true;
        return false;
      });
      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === `${folderPath}/epic.json`) return makeEpicJson();
        if (path === `${folderPath}/epic.md`) return '# Epic 99: Should Not Be Used\n';
        if (path === `${folderPath}/stories/story-21.1.md`) return storyContent;
        return '';
      });

      const result = parser.parseEpicFolder(folderPath);

      // Should come from epic.json (key '21'), not epic.md (key '99')
      expect(result.epics[0]!.key).toBe('21');
      expect(result.epics[0]!.title).toBe('Epic 21: JSON Schema Upgrade');
    });

    // ────────────────────────────────────────────────────────────
    // AC3: Fallback to epic.md when epic.json absent
    // ────────────────────────────────────────────────────────────
    it('should fall back to epic.md behavior when epic.json is absent (AC3)', () => {
      const folderPath = '/project/epic-1';
      const epicMdContent = '# Epic 1: Fallback Epic\n\nDescription.\n';

      existsSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === `${folderPath}/epic.json`) return false;
        if (path === `${folderPath}/epic.md`) return true;
        if (path === `${folderPath}/stories`) return false;
        return false;
      });
      readFileSyncMock.mockImplementation((p) => {
        if (String(p) === `${folderPath}/epic.md`) return epicMdContent;
        return '';
      });

      const result = parser.parseEpicFolder(folderPath);

      expect(result.epics).toHaveLength(1);
      expect(result.epics[0]!.key).toBe('1');
      expect(result.epics[0]!.title).toBe('Fallback Epic');
      expect(result.epics[0]!.description).toBe('Description.');
    });

    it('should preserve full epic.md behavior (stories loaded) when epic.json absent (AC3)', () => {
      const folderPath = '/project/epic-1';
      const epicMdContent = '# Epic 1: Epic With Stories\n';
      const storyContent = '# Story 1.1: Some Story\n\nContent\n';

      existsSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === `${folderPath}/epic.json`) return false;
        if (path === `${folderPath}/epic.md`) return true;
        if (path === `${folderPath}/stories`) return true;
        return false;
      });
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (String(p) === `${folderPath}/stories`) {
          return ['story-1.1.md'] as unknown as fs.Dirent[];
        }
        return [];
      });
      readFileSyncMock.mockImplementation((p) => {
        const path = String(p);
        if (path === `${folderPath}/epic.md`) return epicMdContent;
        if (path === `${folderPath}/stories/story-1.1.md`) return storyContent;
        return '';
      });

      const result = parser.parseEpicFolder(folderPath);
      expect(result.epics[0]!.stories).toHaveLength(1);
      expect(result.epics[0]!.stories[0]!.key).toBe('1.1');
    });
  });
});

// ────────────────────────────────────────────────────────────
// AC7: EpicDiscovery finds folders with epic.json (no epic.md)
// ────────────────────────────────────────────────────────────
describe('findEpicFolders (epic.json discovery)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should detect epic folder that has epic.json but no epic.md (AC7)', async () => {
    const { findEpicFolders } = await import('@core/EpicDiscovery.js');

    const projectRoot = '/project';
    const folderPath = '/project/epic-21';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === projectRoot) return true;
      if (path === `${projectRoot}/docs`) return false;
      if (path === `${projectRoot}/_bmad-output/planning-artifacts`) return false;
      if (path === `${folderPath}/epic.json`) return true;
      if (path === `${folderPath}/epic.md`) return false;
      if (path === `${folderPath}/stories`) return false;
      return false;
    });
    vi.mocked(fs.readdirSync).mockImplementation((p, opts) => {
      const path = String(p);
      if (path === projectRoot) {
        return [
          { name: 'epic-21', isDirectory: () => true, isFile: () => false },
        ] as unknown as fs.Dirent[];
      }
      return [];
    });
    readFileSyncMock.mockImplementation((p) => {
      if (String(p) === `${folderPath}/epic.json`) {
        return JSON.stringify({ $schema: 'agentkit-epic-v1', key: '21', title: 'Epic 21: JSON Epic', stories: [] });
      }
      return '';
    });

    const result = findEpicFolders(projectRoot);
    expect(result.some((f) => f.epicNumber === 21)).toBe(true);
  });

  it('should extract title and storyCount from epic.json for discovered folders (AC7)', async () => {
    const { findEpicFolders } = await import('@core/EpicDiscovery.js');

    const projectRoot = '/project';
    const folderPath = '/project/epic-21';
    const epicJson = JSON.stringify({
      $schema: 'agentkit-epic-v1',
      key: '21',
      title: 'Epic 21: Discovery Title',
      stories: [
        { key: '21.1', title: 'Story 1', file: 'stories/story-21.1.md', dependsOn: [] },
        { key: '21.2', title: 'Story 2', file: 'stories/story-21.2.md', dependsOn: [] },
      ],
    });

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === projectRoot) return true;
      if (path === `${projectRoot}/docs`) return false;
      if (path === `${projectRoot}/_bmad-output/planning-artifacts`) return false;
      if (path === `${folderPath}/epic.json`) return true;
      if (path === `${folderPath}/epic.md`) return false;
      return false;
    });
    vi.mocked(fs.readdirSync).mockImplementation((p) => {
      if (String(p) === projectRoot) {
        return [
          { name: 'epic-21', isDirectory: () => true, isFile: () => false },
        ] as unknown as fs.Dirent[];
      }
      return [];
    });
    readFileSyncMock.mockReturnValue(epicJson);

    const result = findEpicFolders(projectRoot);
    const epic21 = result.find((f) => f.epicNumber === 21);

    expect(epic21).toBeDefined();
    expect(epic21!.title).toBe('Epic 21: Discovery Title');
    expect(epic21!.storyCount).toBe(2);
  });
});
