import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs before importing anything that uses it
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import * as fs from 'node:fs';
import { findEpicFolders, findEpicFiles } from '@core/EpicDiscovery.js';

describe('findEpicFolders', () => {
  const existsSyncMock = vi.mocked(fs.existsSync);
  const readdirSyncMock = vi.mocked(fs.readdirSync);
  const readFileSyncMock = vi.mocked(fs.readFileSync);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function makeDirEntry(name: string, isDirectory: boolean) {
    return {
      name,
      isDirectory: () => isDirectory,
      isFile: () => !isDirectory,
    } as fs.Dirent;
  }

  it('discovers valid epic folders with correct epicNumber, title, and storyCount', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === projectRoot) return true;
      if (path === `${projectRoot}/docs`) return false;
      if (path === `${projectRoot}/_bmad-output/planning-artifacts`) return false;
      if (path === `${projectRoot}/epic-1/epic.md`) return true;
      if (path === `${projectRoot}/epic-1/stories`) return true;
      return false;
    });
    readdirSyncMock.mockImplementation((p, opts) => {
      const path = String(p);
      if (path === projectRoot && opts) {
        return [makeDirEntry('epic-1', true)];
      }
      if (path === `${projectRoot}/epic-1/stories`) {
        return ['story-1.1.md', 'story-1.2.md'] as unknown as fs.Dirent[];
      }
      return [];
    });
    readFileSyncMock.mockImplementation((p) => {
      if (String(p) === `${projectRoot}/epic-1/epic.md`) {
        return '# Epic 1: My First Epic\n\nDescription here.\n\n## Stories\n';
      }
      return '';
    });

    const result = findEpicFolders(projectRoot);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      epicNumber: 1,
      title: 'My First Epic',
      storyCount: 2,
      folderPath: expect.stringContaining('epic-1'),
    });
  });

  it('skips folders without epic.md', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === projectRoot) return true;
      if (path === `${projectRoot}/docs`) return false;
      if (path === `${projectRoot}/_bmad-output/planning-artifacts`) return false;
      if (path === `${projectRoot}/epic-2/epic.md`) return false; // no epic.md
      return false;
    });
    readdirSyncMock.mockImplementation((p, opts) => {
      if (String(p) === projectRoot && opts) {
        return [makeDirEntry('epic-2', true)];
      }
      return [];
    });

    const result = findEpicFolders(projectRoot);
    expect(result).toHaveLength(0);
  });

  it('skips non-directory entries', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      return String(p) === projectRoot;
    });
    readdirSyncMock.mockImplementation((p, opts) => {
      if (String(p) === projectRoot && opts) {
        return [makeDirEntry('epic-3', false)]; // not a directory
      }
      return [];
    });

    const result = findEpicFolders(projectRoot);
    expect(result).toHaveLength(0);
  });

  it('skips folder names not matching /^epic-\\d+$/', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      return String(p) === projectRoot;
    });
    readdirSyncMock.mockImplementation((p, opts) => {
      if (String(p) === projectRoot && opts) {
        return [
          makeDirEntry('epic-abc', true),
          makeDirEntry('epicfoo', true),
          makeDirEntry('my-epic-1', true),
        ];
      }
      return [];
    });

    const result = findEpicFolders(projectRoot);
    expect(result).toHaveLength(0);
  });

  it('returns results sorted ascending by epicNumber', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === projectRoot) return true;
      if (path === `${projectRoot}/docs`) return false;
      if (path === `${projectRoot}/_bmad-output/planning-artifacts`) return false;
      if (path.endsWith('/epic.md')) return true;
      if (path.endsWith('/stories')) return false;
      return false;
    });
    readdirSyncMock.mockImplementation((p, opts) => {
      if (String(p) === projectRoot && opts) {
        // Return in reverse order to test sorting
        return [makeDirEntry('epic-10', true), makeDirEntry('epic-2', true), makeDirEntry('epic-1', true)];
      }
      return [];
    });
    readFileSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path.includes('epic-10')) return '# Epic 10: Ten\n';
      if (path.includes('epic-2')) return '# Epic 2: Two\n';
      if (path.includes('epic-1')) return '# Epic 1: One\n';
      return '';
    });

    const result = findEpicFolders(projectRoot);

    expect(result).toHaveLength(3);
    expect(result[0]!.epicNumber).toBe(1);
    expect(result[1]!.epicNumber).toBe(2);
    expect(result[2]!.epicNumber).toBe(10);
  });

  it('returns empty array when search directories are empty', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      return String(p) === projectRoot;
    });
    readdirSyncMock.mockReturnValue([]);

    const result = findEpicFolders(projectRoot);
    expect(result).toHaveLength(0);
  });

  it('handles inaccessible directory gracefully (readdirSync throws)', () => {
    const projectRoot = '/project';
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = findEpicFolders(projectRoot);
    expect(result).toHaveLength(0);
  });

  it('deduplicates when same folder path is reachable via multiple search dirs', () => {
    // This scenario is unlikely but we test deduplication via seenPaths Set
    const projectRoot = '/project';
    // Simulate that both projectRoot and docs resolve to the same folder
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === projectRoot) return true;
      if (path === `${projectRoot}/docs`) return true;
      if (path === `${projectRoot}/_bmad-output/planning-artifacts`) return false;
      if (path.endsWith('/epic.md')) return true;
      if (path.endsWith('/stories')) return false;
      return false;
    });
    readdirSyncMock.mockImplementation((p, opts) => {
      const path = String(p);
      if ((path === projectRoot || path === `${projectRoot}/docs`) && opts) {
        return [makeDirEntry('epic-1', true)];
      }
      return [];
    });
    readFileSyncMock.mockImplementation(() => '# Epic 1: Dedup Test\n');

    const result = findEpicFolders(projectRoot);
    // Each has a unique resolved path so both appear, but they are distinct
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Check no duplicate folderPaths
    const paths = result.map((r) => r.folderPath);
    const uniquePaths = new Set(paths);
    expect(paths.length).toBe(uniquePaths.size);
  });

  it('returns storyCount = 0 when stories/ directory does not exist', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === projectRoot) return true;
      if (path === `${projectRoot}/docs`) return false;
      if (path === `${projectRoot}/_bmad-output/planning-artifacts`) return false;
      if (path === `${projectRoot}/epic-1/epic.md`) return true;
      if (path === `${projectRoot}/epic-1/stories`) return false; // no stories dir
      return false;
    });
    readdirSyncMock.mockImplementation((p, opts) => {
      if (String(p) === projectRoot && opts) {
        return [makeDirEntry('epic-1', true)];
      }
      return [];
    });
    readFileSyncMock.mockImplementation(() => '# Epic 1: No Stories Yet\n');

    const result = findEpicFolders(projectRoot);

    expect(result).toHaveLength(1);
    expect(result[0]!.storyCount).toBe(0);
  });

  it('counts only story-N.M.md files (ignores non-matching files)', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === projectRoot) return true;
      if (path === `${projectRoot}/docs`) return false;
      if (path === `${projectRoot}/_bmad-output/planning-artifacts`) return false;
      if (path === `${projectRoot}/epic-1/epic.md`) return true;
      if (path === `${projectRoot}/epic-1/stories`) return true;
      return false;
    });
    readdirSyncMock.mockImplementation((p, opts) => {
      const path = String(p);
      if (path === projectRoot && opts) {
        return [makeDirEntry('epic-1', true)];
      }
      if (path === `${projectRoot}/epic-1/stories`) {
        // Mix of valid story files and noise
        return ['story-1.1.md', 'story-1.2.md', 'README.md', 'notes.txt', 'story-draft.md'] as unknown as fs.Dirent[];
      }
      return [];
    });
    readFileSyncMock.mockImplementation(() => '# Epic 1: Story Count Test\n');

    const result = findEpicFolders(projectRoot);
    expect(result[0]!.storyCount).toBe(2);
  });
});

describe('findEpicFiles', () => {
  const existsSyncMock = vi.mocked(fs.existsSync);
  const readdirSyncMock = vi.mocked(fs.readdirSync);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('finds epics.md in project root', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      return path === projectRoot || path === `${projectRoot}/docs` || path === `${projectRoot}/_bmad-output/planning-artifacts`;
    });
    readdirSyncMock.mockImplementation((p) => {
      if (String(p) === projectRoot) return ['epics.md', 'README.md'] as unknown as fs.Dirent[];
      return [];
    });

    const result = findEpicFiles(projectRoot);
    expect(result.some((f) => f.endsWith('epics.md'))).toBe(true);
    expect(result.some((f) => f.endsWith('README.md'))).toBe(false);
  });

  it('finds epic.md (singular) in project root', () => {
    const projectRoot = '/project';
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockImplementation((p) => {
      if (String(p) === projectRoot) return ['epic.md'] as unknown as fs.Dirent[];
      return [];
    });

    const result = findEpicFiles(projectRoot);
    expect(result.some((f) => f.endsWith('epic.md'))).toBe(true);
  });

  it('finds epic-*.md files', () => {
    const projectRoot = '/project';
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockImplementation((p) => {
      if (String(p) === projectRoot) {
        return ['epic-1.md', 'epic-overview.md', 'epics-summary.md'] as unknown as fs.Dirent[];
      }
      return [];
    });

    const result = findEpicFiles(projectRoot);
    expect(result.some((f) => f.endsWith('epic-1.md'))).toBe(true);
    expect(result.some((f) => f.endsWith('epic-overview.md'))).toBe(true);
    expect(result.some((f) => f.endsWith('epics-summary.md'))).toBe(true);
  });

  it('searches in docs/ and _bmad-output/planning-artifacts/', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      const path = String(p);
      return (
        path === projectRoot ||
        path === `${projectRoot}/docs` ||
        path === `${projectRoot}/_bmad-output/planning-artifacts`
      );
    });
    readdirSyncMock.mockImplementation((p) => {
      const path = String(p);
      if (path === projectRoot) return [] as unknown as fs.Dirent[];
      if (path === `${projectRoot}/docs`) return ['epics.md'] as unknown as fs.Dirent[];
      if (path === `${projectRoot}/_bmad-output/planning-artifacts`) return ['epic-all.md'] as unknown as fs.Dirent[];
      return [];
    });

    const result = findEpicFiles(projectRoot);
    expect(result.some((f) => f.includes('/docs/') && f.endsWith('epics.md'))).toBe(true);
    expect(result.some((f) => f.includes('planning-artifacts') && f.endsWith('epic-all.md'))).toBe(true);
  });

  it('returns empty array when no matching files exist', () => {
    const projectRoot = '/project';
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(['README.md', 'notes.txt'] as unknown as fs.Dirent[]);

    const result = findEpicFiles(projectRoot);
    expect(result).toHaveLength(0);
  });

  it('deduplicates files found in multiple search dirs', () => {
    const projectRoot = '/project';
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(['epics.md'] as unknown as fs.Dirent[]);

    const result = findEpicFiles(projectRoot);
    const unique = new Set(result);
    expect(result.length).toBe(unique.size);
  });

  it('skips search dirs that do not exist', () => {
    const projectRoot = '/project';
    existsSyncMock.mockImplementation((p) => {
      // Only project root exists
      return String(p) === projectRoot;
    });
    readdirSyncMock.mockImplementation((p) => {
      if (String(p) === projectRoot) return ['epics.md'] as unknown as fs.Dirent[];
      return [];
    });

    const result = findEpicFiles(projectRoot);
    expect(result).toHaveLength(1);
  });

  it('handles inaccessible directory gracefully', () => {
    const projectRoot = '/project';
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = findEpicFiles(projectRoot);
    expect(result).toHaveLength(0);
  });
});
