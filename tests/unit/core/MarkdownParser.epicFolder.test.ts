import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import * as fs from 'node:fs';
import { parseEpicFolder, FOLDER_EPIC_H1_REGEX } from '@core/MarkdownParser.js';
import { LoadError } from '@core/Errors.js';

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

describe('parseEpicFolder', () => {
  const existsSyncMock = vi.mocked(fs.existsSync);
  const readdirSyncMock = vi.mocked(fs.readdirSync);
  const readFileSyncMock = vi.mocked(fs.readFileSync);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('parses a minimal valid folder with epic.md and no stories', () => {
    const folderPath = '/project/epic-1';
    const epicMdContent = '# Epic 1: Minimal Epic\n\nSome description.\n';
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return false;
      return false;
    });
    readFileSyncMock.mockImplementation((p) => {
      if (String(p) === `${folderPath}/epic.md`) return epicMdContent;
      return '';
    });

    const result = parseEpicFolder(folderPath);

    expect(result.epics).toHaveLength(1);
    const epic = result.epics[0]!;
    expect(epic.key).toBe('1');
    expect(epic.title).toBe('Minimal Epic');
    expect(epic.description).toBe('Some description.');
    expect(epic.stories).toHaveLength(0);
    expect(epic.orderIndex).toBe(0);
    expect(epic.contentHash).toBe(sha256(epicMdContent));
  });

  it('parses a folder with multiple story files in correct numeric sort order', () => {
    const folderPath = '/project/epic-1';
    const epicMdContent = '# Epic 1: Epic With Stories\n\n## Stories\n';
    const story11Content = '# Story 1.1: First Story\n\nContent of story 1.1\n';
    const story19Content = '# Story 1.9: Ninth Story\n\nContent of story 1.9\n';
    const story110Content = '# Story 1.10: Tenth Story\n\nContent of story 1.10\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return true;
      return false;
    });
    readdirSyncMock.mockImplementation((p) => {
      if (String(p) === `${folderPath}/stories`) {
        // Return in non-sorted order to verify our sort
        return ['story-1.10.md', 'story-1.1.md', 'story-1.9.md'] as unknown as fs.Dirent[];
      }
      return [];
    });
    readFileSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return epicMdContent;
      if (path === `${folderPath}/stories/story-1.1.md`) return story11Content;
      if (path === `${folderPath}/stories/story-1.9.md`) return story19Content;
      if (path === `${folderPath}/stories/story-1.10.md`) return story110Content;
      return '';
    });

    const result = parseEpicFolder(folderPath);
    const stories = result.epics[0]!.stories;

    expect(stories).toHaveLength(3);
    // Verify numeric sort: 1.1 < 1.9 < 1.10
    expect(stories[0]!.key).toBe('1.1');
    expect(stories[1]!.key).toBe('1.9');
    expect(stories[2]!.key).toBe('1.10');
    // Verify orderIndex assigned after sort
    expect(stories[0]!.orderIndex).toBe(0);
    expect(stories[1]!.orderIndex).toBe(1);
    expect(stories[2]!.orderIndex).toBe(2);
  });

  it('returns stories=[] when stories/ directory does not exist', () => {
    const folderPath = '/project/epic-2';
    const epicMdContent = '# Epic 2: Epic No Stories Dir\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return false;
      return false;
    });
    readFileSyncMock.mockImplementation((p) => {
      if (String(p) === `${folderPath}/epic.md`) return epicMdContent;
      return '';
    });

    const result = parseEpicFolder(folderPath);
    expect(result.epics[0]!.stories).toHaveLength(0);
  });

  it('returns stories=[] when stories/ directory is empty', () => {
    const folderPath = '/project/epic-2';
    const epicMdContent = '# Epic 2: Epic Empty Stories\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return true;
      return false;
    });
    readdirSyncMock.mockReturnValue([]);
    readFileSyncMock.mockImplementation((p) => {
      if (String(p) === `${folderPath}/epic.md`) return epicMdContent;
      return '';
    });

    const result = parseEpicFolder(folderPath);
    expect(result.epics[0]!.stories).toHaveLength(0);
  });

  it('throws LoadError when epic.md is missing', () => {
    const folderPath = '/project/epic-3';
    existsSyncMock.mockReturnValue(false);

    expect(() => parseEpicFolder(folderPath)).toThrow(LoadError);
    expect(() => parseEpicFolder(folderPath)).toThrow(`Epic folder missing epic.md: ${folderPath}`);
  });

  it('throws LoadError when epic.md has no valid h1 header', () => {
    const folderPath = '/project/epic-3';
    existsSyncMock.mockImplementation((p) => {
      return String(p) === `${folderPath}/epic.md`;
    });
    readFileSyncMock.mockReturnValue('## Not a valid h1 header\n\nContent\n');

    expect(() => parseEpicFolder(folderPath)).toThrow(LoadError);
    expect(() => parseEpicFolder(folderPath)).toThrow(`Invalid epic.md format: ${folderPath}`);
  });

  it('throws LoadError when a story file has no valid h1 header', () => {
    const folderPath = '/project/epic-1';
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return true;
      return false;
    });
    readdirSyncMock.mockImplementation((p) => {
      if (String(p) === `${folderPath}/stories`) {
        return ['story-1.1.md'] as unknown as fs.Dirent[];
      }
      return [];
    });
    readFileSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return '# Epic 1: Valid Epic\n';
      if (path === `${folderPath}/stories/story-1.1.md`) return '## Not a valid story header\n\nContent\n';
      return '';
    });

    expect(() => parseEpicFolder(folderPath)).toThrow(LoadError);
    expect(() => parseEpicFolder(folderPath)).toThrow('Invalid story file format:');
  });

  it('computes correct SHA256 hashes for epic and stories', () => {
    const folderPath = '/project/epic-1';
    const epicMdContent = '# Epic 1: Hash Test\n';
    const storyContent = '# Story 1.1: Story Hash Test\n\nContent\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return true;
      return false;
    });
    readdirSyncMock.mockImplementation((p) => {
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

    const result = parseEpicFolder(folderPath);
    expect(result.epics[0]!.contentHash).toBe(sha256(epicMdContent));
    expect(result.epics[0]!.stories[0]!.contentHash).toBe(sha256(storyContent));
  });

  it('correctly extracts description between header and first ## heading', () => {
    const folderPath = '/project/epic-1';
    const epicMdContent = '# Epic 1: Desc Test\n\nThis is the description.\n\nMore description.\n\n## Stories\n\n| Story | Status |\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return false;
      return false;
    });
    readFileSyncMock.mockReturnValue(epicMdContent);

    const result = parseEpicFolder(folderPath);
    const desc = result.epics[0]!.description;
    expect(desc).toBe('This is the description.\n\nMore description.');
    expect(desc).not.toContain('## Stories');
  });

  it('returns description="" when header immediately followed by ## heading', () => {
    const folderPath = '/project/epic-1';
    const epicMdContent = '# Epic 1: No Desc\n## Stories\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return false;
      return false;
    });
    readFileSyncMock.mockReturnValue(epicMdContent);

    const result = parseEpicFolder(folderPath);
    expect(result.epics[0]!.description).toBe('');
  });

  it('preserves full story content including the header line', () => {
    const folderPath = '/project/epic-1';
    const epicMdContent = '# Epic 1: Content Test\n';
    const storyContent = '# Story 1.1: Full Content\n\nThis is the full story content.\n\n## AC\n\n- criterion 1\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return true;
      return false;
    });
    readdirSyncMock.mockImplementation((p) => {
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

    const result = parseEpicFolder(folderPath);
    const story = result.epics[0]!.stories[0]!;
    expect(story.content).toBe(storyContent);
    expect(story.content).toContain('# Story 1.1: Full Content');
    expect(story.content).toContain('criterion 1');
  });

  it('finds h1 header even with blank lines before it', () => {
    const folderPath = '/project/epic-1';
    const epicMdContent = '\n\n# Epic 1: Blank Lines Before Header\n\nDescription.\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return false;
      return false;
    });
    readFileSyncMock.mockReturnValue(epicMdContent);

    const result = parseEpicFolder(folderPath);
    expect(result.epics[0]!.key).toBe('1');
    expect(result.epics[0]!.title).toBe('Blank Lines Before Header');
  });

  it('handles epic number > 9 (e.g., epic-10)', () => {
    const folderPath = '/project/epic-10';
    const epicMdContent = '# Epic 10: Large Number\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return false;
      return false;
    });
    readFileSyncMock.mockReturnValue(epicMdContent);

    const result = parseEpicFolder(folderPath);
    expect(result.epics[0]!.key).toBe('10');
    expect(result.epics[0]!.title).toBe('Large Number');
  });

  it('only counts story files matching story-N.M.md pattern (ignores drafts)', () => {
    const folderPath = '/project/epic-1';
    const epicMdContent = '# Epic 1: Filter Stories\n';

    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return true;
      if (path === `${folderPath}/stories`) return true;
      return false;
    });
    readdirSyncMock.mockImplementation((p) => {
      if (String(p) === `${folderPath}/stories`) {
        return ['story-1.1.md', 'story-draft.md', 'notes.txt', 'story-1.2.md'] as unknown as fs.Dirent[];
      }
      return [];
    });
    readFileSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === `${folderPath}/epic.md`) return epicMdContent;
      if (path === `${folderPath}/stories/story-1.1.md`) return '# Story 1.1: Story One\n\nContent\n';
      if (path === `${folderPath}/stories/story-1.2.md`) return '# Story 1.2: Story Two\n\nContent\n';
      return '';
    });

    const result = parseEpicFolder(folderPath);
    expect(result.epics[0]!.stories).toHaveLength(2);
  });
});

describe('FOLDER_EPIC_H1_REGEX', () => {
  it('matches valid epic h1 lines', () => {
    expect(FOLDER_EPIC_H1_REGEX.test('# Epic 1: My Title')).toBe(true);
    expect(FOLDER_EPIC_H1_REGEX.test('# Epic 10: Large Epic')).toBe(true);
    expect(FOLDER_EPIC_H1_REGEX.test('# Epic 99: Another One')).toBe(true);
  });

  it('captures epic number and title from the match', () => {
    const match = FOLDER_EPIC_H1_REGEX.exec('# Epic 3: Project Foundation');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('3');
    expect(match![2]).toBe('Project Foundation');
  });

  it('does not match story h1 lines', () => {
    expect(FOLDER_EPIC_H1_REGEX.test('# Story 1.1: My Story')).toBe(false);
  });

  it('does not match epic h2 lines (##)', () => {
    expect(FOLDER_EPIC_H1_REGEX.test('## Epic 1: Section')).toBe(false);
  });

  it('does not match plain text lines', () => {
    expect(FOLDER_EPIC_H1_REGEX.test('Epic 1: No hash')).toBe(false);
    expect(FOLDER_EPIC_H1_REGEX.test('# Not an epic line')).toBe(false);
  });

  it('does not match epic lines with non-numeric keys', () => {
    expect(FOLDER_EPIC_H1_REGEX.test('# Epic A: Alpha')).toBe(false);
  });
});
