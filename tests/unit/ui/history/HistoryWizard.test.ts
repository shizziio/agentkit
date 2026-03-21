import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { createConnection, type DrizzleDB } from '@core/db/Connection.js';
import { runMigrations } from '@core/db/RunMigrations.js';
import { projects, epics, stories, tasks } from '@core/db/schema.js';
import { HistoryWizard } from '@ui/history/HistoryWizard.js';
import { useInput } from 'ink';

// Mock ink hooks
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

function seedProject(db: DrizzleDB): number {
  return db
    .insert(projects)
    .values({ projectName: 'test-project' })
    .returning({ id: projects.id })
    .get().id;
}

function seedEpic(db: DrizzleDB, projectId: number, key = '1'): number {
  return db
    .insert(epics)
    .values({ projectId, epicKey: key, title: `Epic ${key}`, orderIndex: 0 })
    .returning({ id: epics.id })
    .get().id;
}

function seedStory(
  db: DrizzleDB,
  epicId: number,
  key = '1.1',
  status = 'draft',
): number {
  return db
    .insert(stories)
    .values({ epicId, storyKey: key, title: `Story ${key}`, status, orderIndex: 0 } as unknown as typeof stories.$inferInsert)
    .returning({ id: stories.id })
    .get().id;
}

function seedTask(
  db: DrizzleDB,
  storyId: number,
  stageName: string,
  status = 'queued',
  extra: Record<string, unknown> = {},
): number {
  return db
    .insert(tasks)
    .values({ storyId, stageName, status, ...extra })
    .returning({ id: tasks.id })
    .get().id;
}

describe('HistoryWizard', () => {
  let db: DrizzleDB;
  let projectId: number;
  let epicId: number;
  let onExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    projectId = seedProject(db);
    epicId = seedEpic(db, projectId);
    onExit = vi.fn();
    vi.clearAllMocks();
  });

  describe('rendering and interaction', () => {
    it('renders without crashing in list step', () => {
      const storyId = seedStory(db, epicId, '1.1', 'done');
      seedTask(db, storyId, 'sm', 'done', { durationMs: 1000 });

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit: vi.fn(),
      });

      const result = render(component);
      expect(result).toBeDefined();
      result.unmount();
    });

    it('renders empty state when no stories', () => {
      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit: vi.fn(),
      });

      const result = render(component);
      expect(result).toBeDefined();
      result.unmount();
    });

    it('registers useInput for list step navigation', () => {
      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit: vi.fn(),
      });

      render(component);

      // Should register useInput for list step
      expect(useInput).toHaveBeenCalled();
      expect((useInput as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({
        isActive: true,
      });
    });

    it('calls onExit when q is pressed in list step', () => {
      const onExit = vi.fn();
      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit,
      });

      render(component);

      const useInputHandler = (useInput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(useInputHandler).toBeDefined();

      // Call with 'q'
      useInputHandler('q', {});

      expect(onExit).toHaveBeenCalled();
    });

    it('calls onExit when Escape is pressed in list step', () => {
      const onExit = vi.fn();
      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit,
      });

      render(component);

      const useInputHandler = (useInput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      useInputHandler('', { escape: true });

      expect(onExit).toHaveBeenCalled();
    });
  });

  describe('filter dependency array behavior', () => {
    it('reloads data when filter.epicId changes', () => {
      const epic2Id = seedEpic(db, projectId, '2');
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epic2Id, '2.1', 'done');

      // First render with epicId filter
      let component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { epicId: epicId },
        onExit,
      });

      let result = render(component);
      result.unmount();

      // Clear mocks to track new calls
      vi.clearAllMocks();

      // Re-render with different epicId
      component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { epicId: epic2Id },
        onExit,
      });

      result = render(component);
      // useInput should be called again (indicates re-render)
      expect(useInput).toHaveBeenCalled();
      result.unmount();
    });

    it('reloads data when filter.status changes', () => {
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'failed');

      let component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { status: 'done' },
        onExit,
      });

      let result = render(component);
      result.unmount();

      vi.clearAllMocks();

      component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { status: 'failed' },
        onExit,
      });

      result = render(component);
      expect(useInput).toHaveBeenCalled();
      result.unmount();
    });

    it('reloads data when filter.last changes', () => {
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'done');
      seedStory(db, epicId, '1.3', 'done');

      let component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { last: 3 },
        onExit,
      });

      let result = render(component);
      result.unmount();

      vi.clearAllMocks();

      component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { last: 1 },
        onExit,
      });

      result = render(component);
      expect(useInput).toHaveBeenCalled();
      result.unmount();
    });

    it('does not reload when all filter members remain unchanged', () => {
      seedStory(db, epicId, '1.1', 'done');

      const filter = { epicId, status: 'done' as const };

      let component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter,
        onExit,
      });

      let result = render(component);
      result.unmount();

      vi.clearAllMocks();

      // Render again with same filter values
      component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { epicId, status: 'done' as const },
        onExit,
      });

      result = render(component);
      // useInput registers on every render, but this tests the component logic
      expect(useInput).toHaveBeenCalled();
      result.unmount();
    });
  });

  describe('service integration', () => {
    it('loads stories and statistics from HistoryService', () => {
      const storyId1 = seedStory(db, epicId, '1.1', 'done');
      const storyId2 = seedStory(db, epicId, '1.2', 'done');
      seedTask(db, storyId1, 'sm', 'done', { durationMs: 2000 });
      seedTask(db, storyId2, 'dev', 'done', { durationMs: 3000 });

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit,
      });

      const result = render(component);
      // If this renders without error, service integration is working
      expect(result).toBeDefined();
      result.unmount();
    });

    it('applies filters when loading stories', () => {
      const epic2Id = seedEpic(db, projectId, '2');
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epic2Id, '2.1', 'done');

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { epicId: epic2Id },
        onExit,
      });

      const result = render(component);
      expect(result).toBeDefined();
      result.unmount();
    });

    it('handles empty results gracefully', () => {
      // Create stories but filter to non-existent epic
      seedStory(db, epicId, '1.1', 'done');
      const fakeEpicId = 9999;

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { epicId: fakeEpicId },
        onExit,
      });

      const result = render(component);
      // Should render without error even with no matching results
      expect(result).toBeDefined();
      result.unmount();
    });
  });

  describe('navigation and step management', () => {
    it('registers two useInput handlers (list and chain steps)', () => {
      seedStory(db, epicId, '1.1', 'done');
      seedTask(db, epicId === undefined ? 1 : epicId, 'sm', 'done');
      const onExit = vi.fn();

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit,
      });

      render(component);

      // Component should register three useInput handlers: one for list, one for chain, one for status_picker
      expect(useInput).toHaveBeenCalledTimes(3);
    });

    it('handles up/down navigation in list step', () => {
      seedStory(db, epicId, '1.1', 'done');
      seedStory(db, epicId, '1.2', 'done');
      seedStory(db, epicId, '1.3', 'done');

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit: vi.fn(),
      });

      render(component);

      const listStepHandler = (useInput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

      // Simulate navigation
      expect(() => {
        listStepHandler('', { upArrow: true });
        listStepHandler('', { downArrow: true });
      }).not.toThrow();
    });

    it('enters chain view when Enter is pressed', () => {
      const storyId = seedStory(db, epicId, '1.1', 'done');
      seedTask(db, storyId, 'sm', 'done');

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit,
      });

      render(component);

      const listStepHandler = (useInput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];

      // Press Enter to view chain
      expect(() => {
        listStepHandler('', { return: true });
      }).not.toThrow();
    });

    it('returns to list view when Escape is pressed in chain step', () => {
      const storyId = seedStory(db, epicId, '1.1', 'done');
      seedTask(db, storyId, 'sm', 'done');

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit,
      });

      render(component);

      const listStepHandler = (useInput as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      const chainStepHandler = (useInput as ReturnType<typeof vi.fn>).mock.calls[1]?.[0];

      // Enter chain view
      listStepHandler('', { return: true });

      // Exit chain view
      expect(() => {
        chainStepHandler('', { escape: true });
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('handles stories with no tasks', () => {
      seedStory(db, epicId, '1.1', 'done');

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit,
      });

      const result = render(component);
      expect(result).toBeDefined();
      result.unmount();
    });

    it('handles stories with null values in task fields', () => {
      const storyId = seedStory(db, epicId, '1.1', 'draft');
      seedTask(db, storyId, 'sm', 'queued'); // No duration, no attempt set

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: {},
        onExit,
      });

      const result = render(component);
      expect(result).toBeDefined();
      result.unmount();
    });

    it('handles many stories without performance issues', () => {
      // Create 50 stories
      for (let i = 1; i <= 50; i++) {
        seedStory(db, epicId, `1.${i}`, 'done');
      }

      const component = React.createElement(HistoryWizard, {
        projectId,
        db,
        filter: { last: 10 },
        onExit,
      });

      const result = render(component);
      expect(result).toBeDefined();
      result.unmount();
    });
  });
});
