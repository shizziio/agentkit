import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories } from '@core/db/schema.js';
import { LoadService } from '@core/LoadService.js';
import { LoadError } from '@core/Errors.js';
import type { ParsedContent } from '@core/ParserTypes.js';

function makeParsed(overrides?: Partial<ParsedContent>): ParsedContent {
  return {
    epics: overrides?.epics ?? [
      {
        key: '1',
        title: 'First Epic',
        description: 'Description of first epic',
        contentHash: 'hash-epic-1',
        orderIndex: 0,
        stories: [
          {
            key: '1.1',
            title: 'First Story',
            content: 'Story content 1.1',
            contentHash: 'hash-story-1-1',
            orderIndex: 0,
          },
        ],
      },
    ],
  };
}

describe('LoadService', () => {
  let db: DrizzleDB;
  let service: LoadService;
  let projectId: number;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    const inserted = db.insert(projects).values({ projectName: 'test-project' }).returning({ id: projects.id }).get();
    projectId = inserted.id;
    service = new LoadService(db);
  });

  describe('normalizePath', () => {
    it('should trim whitespace', () => {
      expect(service.normalizePath('  /path/to/file.md  ')).toBe('/path/to/file.md');
    });

    it('should remove surrounding single quotes', () => {
      expect(service.normalizePath("'/path/to/file.md'")).toBe('/path/to/file.md');
    });

    it('should remove surrounding double quotes', () => {
      expect(service.normalizePath('"/path/to/file.md"')).toBe('/path/to/file.md');
    });

    it('should unescape backslash-space', () => {
      expect(service.normalizePath('/path/to/my\\ file.md')).toBe('/path/to/my file.md');
    });

    it('should handle combined: quotes, whitespace, escaped spaces', () => {
      expect(service.normalizePath("  '/path/to/my\\ file.md'  ")).toBe('/path/to/my file.md');
    });

    it('should throw LoadError for empty path', () => {
      expect(() => service.normalizePath('   ')).toThrow(LoadError);
      expect(() => service.normalizePath("''")).toThrow(LoadError);
    });
  });

  describe('compareWithDatabase', () => {
    it('should identify all epics as NEW when database is empty', () => {
      const parsed = makeParsed();
      const result = service.compareWithDatabase(projectId, parsed);
      expect(result.epics[0]!.status).toBe('new');
      expect(result.summary.newEpics).toBe(1);
      expect(result.summary.newStories).toBe(1);
    });

    it('should identify epic as SKIPPED when hash matches', () => {
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'First Epic',
        description: 'Description of first epic',
        contentHash: 'hash-epic-1',
        sourceFile: 'test.md',
        orderIndex: 0,
      } as any).run();

      const existingEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      db.insert(stories).values({
        epicId: existingEpic.id,
        storyKey: '1.1',
        title: 'First Story',
        content: 'Story content 1.1',
        contentHash: 'hash-story-1-1',
        orderIndex: 0,
      } as any).run();

      const parsed = makeParsed();
      const result = service.compareWithDatabase(projectId, parsed);
      expect(result.epics[0]!.status).toBe('skipped');
      expect(result.summary.skippedEpics).toBe(1);
      expect(result.summary.skippedStories).toBe(1);
    });

    it('should identify epic as UPDATED when hash differs', () => {
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'Old Title',
        description: 'Old description',
        contentHash: 'old-hash',
        sourceFile: 'test.md',
        orderIndex: 0,
      } as any).run();

      const existingEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      db.insert(stories).values({
        epicId: existingEpic.id,
        storyKey: '1.1',
        title: 'First Story',
        content: 'Story content 1.1',
        contentHash: 'hash-story-1-1',
        orderIndex: 0,
      } as any).run();

      const parsed = makeParsed();
      const result = service.compareWithDatabase(projectId, parsed);
      expect(result.epics[0]!.status).toBe('updated');
      expect(result.epics[0]!.oldHash).toBe('old-hash');
      expect(result.summary.updatedEpics).toBe(1);
    });

    it('should identify stories as NEW within existing epic', () => {
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'First Epic',
        contentHash: 'old-hash',
        sourceFile: 'test.md',
        orderIndex: 0,
      } as any).run();

      const parsed = makeParsed();
      const result = service.compareWithDatabase(projectId, parsed);
      const storyComps = result.epics[0]!.storyComparisons;
      expect(storyComps[0]!.status).toBe('new');
      expect(result.summary.newStories).toBe(1);
    });

    it('should identify stories as UPDATED when content changes', () => {
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'First Epic',
        contentHash: 'old-hash',
        sourceFile: 'test.md',
        orderIndex: 0,
      } as any).run();

      const existingEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      db.insert(stories).values({
        epicId: existingEpic.id,
        storyKey: '1.1',
        title: 'First Story',
        content: 'Old content',
        contentHash: 'old-story-hash',
        orderIndex: 0,
      } as any).run();

      const parsed = makeParsed();
      const result = service.compareWithDatabase(projectId, parsed);
      const storyComps = result.epics[0]!.storyComparisons;
      expect(storyComps[0]!.status).toBe('updated');
      expect(storyComps[0]!.oldContent).toBe('Old content');
      expect(result.summary.updatedStories).toBe(1);
    });

    it('should identify stories as SKIPPED when content unchanged', () => {
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'First Epic',
        contentHash: 'hash-epic-1',
        sourceFile: 'test.md',
        orderIndex: 0,
      } as any).run();

      const existingEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      db.insert(stories).values({
        epicId: existingEpic.id,
        storyKey: '1.1',
        title: 'First Story',
        content: 'Story content 1.1',
        contentHash: 'hash-story-1-1',
        orderIndex: 0,
      } as any).run();

      const parsed = makeParsed();
      const result = service.compareWithDatabase(projectId, parsed);
      const storyComps = result.epics[0]!.storyComparisons;
      expect(storyComps[0]!.status).toBe('skipped');
      expect(result.summary.skippedStories).toBe(1);
    });

    it('should return correct summary counts', () => {
      // Insert one existing epic with one story
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'First Epic',
        contentHash: 'old-hash',
        sourceFile: 'test.md',
        orderIndex: 0,
      } as any).run();

      const existingEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      db.insert(stories).values({
        epicId: existingEpic.id,
        storyKey: '1.1',
        title: 'First Story',
        content: 'Old content',
        contentHash: 'old-hash',
        orderIndex: 0,
      } as any).run();

      const parsed: ParsedContent = {
        epics: [
          {
            key: '1',
            title: 'Updated Epic',
            description: 'Updated desc',
            contentHash: 'new-hash',
            orderIndex: 0,
            stories: [
              { key: '1.1', title: 'Updated Story', content: 'New content', contentHash: 'new-story-hash', orderIndex: 0 },
              { key: '1.2', title: 'Brand New Story', content: 'New story', contentHash: 'brand-new-hash', orderIndex: 1 },
            ],
          },
          {
            key: '2',
            title: 'New Epic',
            description: 'A new epic',
            contentHash: 'hash-epic-2',
            orderIndex: 1,
            stories: [],
          },
        ],
      };

      const result = service.compareWithDatabase(projectId, parsed);
      expect(result.summary.newEpics).toBe(1);
      expect(result.summary.updatedEpics).toBe(1);
      expect(result.summary.newStories).toBe(1);
      expect(result.summary.updatedStories).toBe(1);
    });
  });

  describe('saveToDatabase', () => {
    it('should insert new epics and stories', () => {
      const parsed = makeParsed();
      const comparison = service.compareWithDatabase(projectId, parsed);
      const result = service.saveToDatabase(projectId, comparison, 'test.md');

      expect(result.insertedEpics).toBe(1);
      expect(result.insertedStories).toBe(1);

      const savedEpics = db.select().from(epics).all();
      expect(savedEpics).toHaveLength(1);
      expect(savedEpics[0]!.epicKey).toBe('1');
      expect(savedEpics[0]!.sourceFile).toBe('test.md');

      const savedStories = db.select().from(stories).all();
      expect(savedStories).toHaveLength(1);
      expect(savedStories[0]!.storyKey).toBe('1.1');
    });

    it('should update changed epics and stories', () => {
      // Insert initial data
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'Old Title',
        contentHash: 'old-hash',
        sourceFile: 'old.md',
        orderIndex: 0,
      } as any).run();

      const existingEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      db.insert(stories).values({
        epicId: existingEpic.id,
        storyKey: '1.1',
        title: 'Old Story',
        content: 'Old content',
        contentHash: 'old-story-hash',
        orderIndex: 0,
      } as any).run();

      const parsed = makeParsed();
      const comparison = service.compareWithDatabase(projectId, parsed);
      const result = service.saveToDatabase(projectId, comparison, 'test.md');

      expect(result.updatedEpics).toBe(1);
      expect(result.updatedStories).toBe(1);

      const updatedEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      expect(updatedEpic.title).toBe('First Epic');
      expect(updatedEpic.contentHash).toBe('hash-epic-1');
      expect(updatedEpic.sourceFile).toBe('test.md');
    });

    it('should not modify skipped items', () => {
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'First Epic',
        description: 'Description of first epic',
        contentHash: 'hash-epic-1',
        sourceFile: 'original.md',
        orderIndex: 0,
      } as any).run();

      const existingEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      db.insert(stories).values({
        epicId: existingEpic.id,
        storyKey: '1.1',
        title: 'First Story',
        content: 'Story content 1.1',
        contentHash: 'hash-story-1-1',
        orderIndex: 0,
      } as any).run();

      const parsed = makeParsed();
      const comparison = service.compareWithDatabase(projectId, parsed);
      expect(comparison.summary.skippedEpics).toBe(1);

      const result = service.saveToDatabase(projectId, comparison, 'test.md');
      expect(result.insertedEpics).toBe(0);
      expect(result.updatedEpics).toBe(0);
      expect(result.insertedStories).toBe(0);
      expect(result.updatedStories).toBe(0);

      const savedEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      expect(savedEpic.sourceFile).toBe('original.md');
    });

    it('should increment version on update', () => {
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'Old Title',
        contentHash: 'old-hash',
        sourceFile: 'old.md',
        orderIndex: 0,
      } as any).run();

      const existingEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      expect(existingEpic.version).toBe(1);

      db.insert(stories).values({
        epicId: existingEpic.id,
        storyKey: '1.1',
        title: 'Old Story',
        content: 'Old content',
        contentHash: 'old-story-hash',
        orderIndex: 0,
      } as any).run();

      const parsed = makeParsed();
      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'test.md');

      const updatedEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      expect(updatedEpic.version).toBe(2);

      const updatedStory = db.select().from(stories).where(eq(stories.storyKey as any, '1.1') as any).get()!;
      expect(updatedStory.version).toBe(2);
    });

    it('should set sourceFile on epics', () => {
      const parsed = makeParsed();
      const comparison = service.compareWithDatabase(projectId, parsed);
      service.saveToDatabase(projectId, comparison, 'my-epics.md');

      const savedEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      expect(savedEpic.sourceFile).toBe('my-epics.md');
    });

    it('should handle mixed new/updated/skipped in one transaction', () => {
      // Insert existing epic 1 with story 1.1
      db.insert(epics).values({
        projectId,
        epicKey: '1',
        title: 'Existing Epic',
        contentHash: 'existing-hash',
        sourceFile: 'test.md',
        orderIndex: 0,
      } as any).run();

      const existingEpic = db.select().from(epics).where(eq(epics.epicKey as any, '1') as any).get()!;
      db.insert(stories).values({
        epicId: existingEpic.id,
        storyKey: '1.1',
        title: 'Existing Story',
        content: 'Existing content',
        contentHash: 'existing-story-hash',
        orderIndex: 0,
      } as any).run();

      const parsed: ParsedContent = {
        epics: [
          {
            key: '1',
            title: 'Updated Epic',
            description: 'Updated',
            contentHash: 'updated-epic-hash',
            orderIndex: 0,
            stories: [
              { key: '1.1', title: 'Updated Story', content: 'Updated content', contentHash: 'updated-story-hash', orderIndex: 0 },
            ],
          },
          {
            key: '2',
            title: 'New Epic',
            description: 'Brand new',
            contentHash: 'new-epic-hash',
            orderIndex: 1,
            stories: [
              { key: '2.1', title: 'New Story', content: 'New content', contentHash: 'new-story-hash', orderIndex: 0 },
            ],
          },
        ],
      };

      const comparison = service.compareWithDatabase(projectId, parsed);
      const result = service.saveToDatabase(projectId, comparison, 'test.md');

      expect(result.insertedEpics).toBe(1);
      expect(result.updatedEpics).toBe(1);
      expect(result.insertedStories).toBe(1);
      expect(result.updatedStories).toBe(1);

      const allEpics = db.select().from(epics).all();
      expect(allEpics).toHaveLength(2);

      const allStories = db.select().from(stories).all();
      expect(allStories).toHaveLength(2);
    });
  });
});
