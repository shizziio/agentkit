import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseEpicsAndStories } from '@core/MarkdownParser';
import { ParserError } from '@core/Errors';

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

describe('parseEpicsAndStories', () => {
  it('should parse a single epic with one story', () => {
    const md = [
      '## Epic 1: Setup',
      'Epic description here.',
      '### Story 1.1: Init project',
      'Story content here.',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    expect(result.epics).toHaveLength(1);

    const epic = result.epics[0]!;
    expect(epic.key).toBe('1');
    expect(epic.title).toBe('Setup');
    expect(epic.description).toBe('Epic description here.');
    expect(epic.orderIndex).toBe(0);
    expect(epic.stories).toHaveLength(1);

    const story = epic.stories[0]!;
    expect(story.key).toBe('1.1');
    expect(story.title).toBe('Init project');
    expect(story.content).toBe('### Story 1.1: Init project\nStory content here.');
    expect(story.orderIndex).toBe(0);
  });

  it('should parse multiple epics with multiple stories', () => {
    const md = [
      '## Epic 1: First',
      'Desc 1',
      '### Story 1.1: A',
      'Content A',
      '### Story 1.2: B',
      'Content B',
      '## Epic 2: Second',
      '### Story 2.1: C',
      'Content C',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    expect(result.epics).toHaveLength(2);
    expect(result.epics[0]!.orderIndex).toBe(0);
    expect(result.epics[1]!.orderIndex).toBe(1);
    expect(result.epics[0]!.stories).toHaveLength(2);
    expect(result.epics[1]!.stories).toHaveLength(1);
    expect(result.epics[0]!.stories[0]!.orderIndex).toBe(0);
    expect(result.epics[0]!.stories[1]!.orderIndex).toBe(1);
    expect(result.epics[1]!.stories[0]!.orderIndex).toBe(0);
  });

  it('should handle empty description (no text between epic heading and first story)', () => {
    const md = [
      '## Epic 1: NoDesc',
      '### Story 1.1: First',
      'Content',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    expect(result.epics[0]!.description).toBe('');
  });

  it('should handle story without acceptance criteria', () => {
    const md = [
      '## Epic 1: Test',
      '### Story 1.1: Bare story',
      'Just some notes, no AC.',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    expect(result.epics[0]!.stories[0]!.content).toBe(
      '### Story 1.1: Bare story\nJust some notes, no AC.',
    );
  });

  it('should trim trailing whitespace from content blocks', () => {
    const md = [
      '## Epic 1: Trim Test   ',
      'Description   ',
      '### Story 1.1: Story   ',
      'Content   ',
      '',
      '',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    // Trailing blank lines should be trimmed, but inline trailing whitespace is preserved
    expect(result.epics[0]!.stories[0]!.content).toBe('### Story 1.1: Story   \nContent   ');
  });

  it('should compute correct SHA-256 hashes', () => {
    const md = [
      '## Epic 1: Hash Test',
      '### Story 1.1: Hashed',
      'Hello world',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    const storyContent = '### Story 1.1: Hashed\nHello world';
    const expectedStoryHash = sha256(storyContent);
    expect(result.epics[0]!.stories[0]!.contentHash).toBe(expectedStoryHash);

    const epicBlock = '## Epic 1: Hash Test\n### Story 1.1: Hashed\nHello world';
    const expectedEpicHash = sha256(epicBlock);
    expect(result.epics[0]!.contentHash).toBe(expectedEpicHash);
  });

  it('should throw ParserError with line number for malformed epic heading', () => {
    const md = [
      '## Epic: Missing Number',
    ].join('\n');

    expect(() => parseEpicsAndStories(md)).toThrow(ParserError);
    try {
      parseEpicsAndStories(md);
    } catch (e) {
      const err = e as ParserError;
      expect(err.line).toBe(1);
      expect(err.message).toContain('Line 1:');
    }
  });

  it('should throw ParserError with line number for malformed story heading', () => {
    const md = [
      '## Epic 1: Valid',
      '### Story ABC: Bad Key',
    ].join('\n');

    expect(() => parseEpicsAndStories(md)).toThrow(ParserError);
    try {
      parseEpicsAndStories(md);
    } catch (e) {
      const err = e as ParserError;
      expect(err.line).toBe(2);
      expect(err.message).toContain('Line 2:');
    }
  });

  it('should return empty epics array for empty input', () => {
    const result = parseEpicsAndStories('');
    expect(result.epics).toEqual([]);
  });

  it('should handle epic with no stories', () => {
    const md = [
      '## Epic 1: Solo',
      'This epic has no stories.',
      'Just description content.',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    expect(result.epics).toHaveLength(1);
    expect(result.epics[0]!.stories).toEqual([]);
    expect(result.epics[0]!.description).toBe('This epic has no stories.\nJust description content.');
  });

  it('should assign correct story orderIndex within an epic', () => {
    const md = [
      '## Epic 1: Multi',
      '### Story 1.1: First',
      'A',
      '### Story 1.2: Second',
      'B',
      '### Story 1.3: Third',
      'C',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    const stories = result.epics[0]!.stories;
    expect(stories).toHaveLength(3);
    expect(stories[0]!.orderIndex).toBe(0);
    expect(stories[1]!.orderIndex).toBe(1);
    expect(stories[2]!.orderIndex).toBe(2);
  });

  it('should not bleed content between stories', () => {
    const md = [
      '## Epic 1: Test',
      '### Story 1.1: First',
      'Content of first',
      '### Story 1.2: Second',
      'Content of second',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    expect(result.epics[0]!.stories[0]!.content).toBe(
      '### Story 1.1: First\nContent of first',
    );
    expect(result.epics[0]!.stories[1]!.content).toBe(
      '### Story 1.2: Second\nContent of second',
    );
  });

  it('should throw for non-epic ## headings', () => {
    const md = [
      '## Some Other Section',
    ].join('\n');

    expect(() => parseEpicsAndStories(md)).toThrow(ParserError);
  });

  it('should throw for non-story ### headings', () => {
    const md = [
      '## Epic 1: Valid',
      '### Some Random Subsection',
    ].join('\n');

    expect(() => parseEpicsAndStories(md)).toThrow(ParserError);
  });

  it('should handle unicode characters in titles and descriptions', () => {
    const md = [
      '## Epic 1: Unicorn \u{1F984}',
      'Description with \u00E9m\u00F8j\u00EF',
      '### Story 1.1: Caf\u00E9',
      'Content with \u4E16\u754C',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    expect(result.epics[0]!.title).toBe('Unicorn \u{1F984}');
    expect(result.epics[0]!.stories[0]!.title).toBe('Caf\u00E9');
  });

  it('should handle Windows-style line endings', () => {
    const md = '## Epic 1: Win\r\nDescription\r\n### Story 1.1: WinStory\r\nContent\r\n';

    const result = parseEpicsAndStories(md);
    expect(result.epics).toHaveLength(1);
    expect(result.epics[0]!.stories).toHaveLength(1);
    expect(result.epics[0]!.title).toBe('Win');
  });

  it('should handle story with just a heading and no body', () => {
    const md = [
      '## Epic 1: Test',
      '### Story 1.1: Empty body',
      '### Story 1.2: Next',
      'Has content',
    ].join('\n');

    const result = parseEpicsAndStories(md);
    expect(result.epics[0]!.stories[0]!.content).toBe('### Story 1.1: Empty body');
    expect(result.epics[0]!.stories[1]!.content).toBe('### Story 1.2: Next\nHas content');
  });
});
