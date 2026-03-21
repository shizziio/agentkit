import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks, taskLogs } from '@core/db/schema';

describe('Schema', () => {
  let db: DrizzleDB;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
  });

  describe('table creation', () => {
    it('should create all 5 tables after migration', () => {
      // safe: $client is always a better-sqlite3 Database instance when using the better-sqlite3 driver
      const sqlite = db.$client as Database.Database;
      // raw SQL used here because Drizzle ORM does not provide a schema introspection API
      const tables = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name`)
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name).sort();
      expect(tableNames).toEqual(['epics', 'projects', 'stories', 'task_logs', 'tasks']);
    });

    it('should allow inserting into all tables with proper references', () => {
      const project = db.insert(projects).values({ projectName: 'test-project' }).returning().get();
      expect(project).toBeDefined();
      expect(project.id).toBe(1);
      expect(project.activeTeam).toBe('agentkit');
      expect(project.version).toBe(1);

      const epic = db.insert(epics).values({
        projectId: project.id,
        epicKey: 'E1',
        title: 'Epic 1',
        orderIndex: 0,
      }).returning().get();
      expect(epic).toBeDefined();
      expect(epic.status).toBe('draft');

      const story = db.insert(stories).values({
        epicId: epic.id,
        storyKey: 'S1',
        title: 'Story 1',
        orderIndex: 0,
      }).returning().get();
      expect(story).toBeDefined();
      expect(story.status).toBe('draft');

      const task = db.insert(tasks).values({
        storyId: story.id,
        stageName: 'dev',
      }).returning().get();
      expect(task).toBeDefined();
      expect(task.status).toBe('queued');
      expect(task.attempt).toBe(1);
      expect(task.maxAttempts).toBe(3);

      const log = db.insert(taskLogs).values({
        taskId: task.id,
        sequence: 1,
        eventType: 'text',
        eventData: '{"content":"hello"}',
      }).returning().get();
      expect(log).toBeDefined();
      expect(log.taskId).toBe(task.id);
      expect(log.sequence).toBe(1);
    });
  });

  describe('default values', () => {
    it('should set created_at and updated_at with ISO 8601 format', () => {
      const project = db.insert(projects).values({ projectName: 'test' }).returning().get();
      expect(project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(project.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it('should default project team to agentkit', () => {
      const project = db.insert(projects).values({ projectName: 'test' }).returning().get();
      expect(project.activeTeam).toBe('agentkit');
    });

    it('should default task status to queued', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      const task = db.insert(tasks).values({ storyId: 1, stageName: 'sm' }).returning().get();
      expect(task.status).toBe('queued');
    });
  });

  describe('unique constraints', () => {
    it('should reject duplicate project_name', () => {
      db.insert(projects).values({ projectName: 'dup' }).run();
      expect(() => {
        db.insert(projects).values({ projectName: 'dup' }).run();
      }).toThrow();
    });

    it('should reject duplicate (project_id, epic_key)', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'A', orderIndex: 0 }).run();
      expect(() => {
        db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'B', orderIndex: 1 }).run();
      }).toThrow();
    });

    it('should allow same epic_key in different projects', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(projects).values({ projectName: 'p2' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'A', orderIndex: 0 }).run();
      expect(() => {
        db.insert(epics).values({ projectId: 2, epicKey: 'E1', title: 'B', orderIndex: 0 }).run();
      }).not.toThrow();
    });

    it('should reject duplicate (epic_id, story_key)', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'A', orderIndex: 0 }).run();
      expect(() => {
        db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'B', orderIndex: 1 }).run();
      }).toThrow();
    });
  });

  describe('foreign key constraints', () => {
    it('should reject epic with non-existent project_id', () => {
      expect(() => {
        db.insert(epics).values({ projectId: 999, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      }).toThrow();
    });

    it('should reject story with non-existent epic_id', () => {
      expect(() => {
        db.insert(stories).values({ epicId: 999, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      }).toThrow();
    });

    it('should reject task with non-existent story_id', () => {
      expect(() => {
        db.insert(tasks).values({ storyId: 999, stageName: 'dev' }).run();
      }).toThrow();
    });

    it('should reject task with non-existent parent_id', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      expect(() => {
        db.insert(tasks).values({ storyId: 1, stageName: 'dev', parentId: 999 }).run();
      }).toThrow();
    });

    it('should reject task_log with non-existent task_id', () => {
      expect(() => {
        db.insert(taskLogs).values({ taskId: 999, sequence: 1, eventType: 'text', eventData: '{}' }).run();
      }).toThrow();
    });
  });

  describe('cascade behavior', () => {
    it('should cascade delete epics when project is deleted', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E2', title: 'E2', orderIndex: 1 }).run();

      db.delete(projects).where(eq(projects.id as any, 1) as any).run();
      const remainingEpics = db.select().from(epics).all();
      expect(remainingEpics).toHaveLength(0);
    });

    it('should cascade delete stories when epic is deleted', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();

      db.delete(epics).where(eq(epics.id as any, 1) as any).run();
      const remainingStories = db.select().from(stories).all();
      expect(remainingStories).toHaveLength(0);
    });

    it('should cascade delete stories and epics when project is deleted', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();

      db.delete(projects).where(eq(projects.id as any, 1) as any).run();
      const remainingEpics = db.select().from(epics).all();
      const remainingStories = db.select().from(stories).all();
      expect(remainingEpics).toHaveLength(0);
      expect(remainingStories).toHaveLength(0);
    });

    it('should NOT cascade delete tasks when story is deleted', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      db.insert(tasks).values({ storyId: 1, stageName: 'dev' }).run();

      // FK with NO ACTION prevents story deletion when tasks reference it
      expect(() => {
        db.delete(stories).where(eq(stories.id as any, 1) as any).run();
      }).toThrow();

      const remainingTasks = db.select().from(tasks).all();
      expect(remainingTasks).toHaveLength(1);
    });

    it('should NOT cascade delete task_logs when task is deleted', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      db.insert(tasks).values({ storyId: 1, stageName: 'dev' }).run();
      db.insert(taskLogs).values({ taskId: 1, sequence: 1, eventType: 'text', eventData: '{}' }).run();

      // FK with NO ACTION prevents task deletion when task_logs reference it
      expect(() => {
        db.delete(tasks).where(eq(tasks.id as any, 1) as any).run();
      }).toThrow();

      const remainingLogs = db.select().from(taskLogs).all();
      expect(remainingLogs).toHaveLength(1);
    });
  });

  describe('tasks table columns', () => {
    it('should accept prompt, input_tokens, and output_tokens', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      const task = db.insert(tasks).values({
        storyId: 1,
        stageName: 'dev',
        prompt: 'Implement the feature as described',
        inputTokens: 1500,
        outputTokens: 3200,
      }).returning().get();
      expect(task.prompt).toBe('Implement the feature as described');
      expect(task.inputTokens).toBe(1500);
      expect(task.outputTokens).toBe(3200);
    });

    it('should default prompt, input_tokens, and output_tokens to null', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      const task = db.insert(tasks).values({ storyId: 1, stageName: 'dev' }).returning().get();
      expect(task.prompt).toBeNull();
      expect(task.inputTokens).toBeNull();
      expect(task.outputTokens).toBeNull();
    });
  });

  describe('JSON columns', () => {
    it('should accept null for input and output', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      const task = db.insert(tasks).values({ storyId: 1, stageName: 'dev' }).returning().get();
      expect(task.input).toBeNull();
      expect(task.output).toBeNull();
    });

    it('should accept JSON text strings for input and output', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      const jsonInput = JSON.stringify({ key: 'value', nested: { a: 1 } });
      const task = db.insert(tasks).values({
        storyId: 1,
        stageName: 'dev',
        input: jsonInput,
        output: '{"result": true}',
      }).returning().get();
      expect(task.input).toBe(jsonInput);
      expect(task.output).toBe('{"result": true}');
    });
  });

  describe('task_logs table', () => {
    it('should store stream events with sequence ordering', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      db.insert(tasks).values({ storyId: 1, stageName: 'dev' }).run();

      db.insert(taskLogs).values({ taskId: 1, sequence: 1, eventType: 'thinking', eventData: '{"content":"analyzing"}' }).run();
      db.insert(taskLogs).values({ taskId: 1, sequence: 2, eventType: 'text', eventData: '{"content":"hello"}' }).run();
      db.insert(taskLogs).values({ taskId: 1, sequence: 3, eventType: 'tool_use', eventData: '{"tool":"read"}' }).run();

      const logs = db.select().from(taskLogs).where(eq(taskLogs.taskId as any, 1) as any).all();
      expect(logs).toHaveLength(3);
      expect(logs[0]!.eventType).toBe('thinking');
      expect(logs[1]!.sequence).toBe(2);
      expect(logs[2]!.eventData).toBe('{"tool":"read"}');
    });

    it('should set created_at with ISO 8601 format', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      db.insert(tasks).values({ storyId: 1, stageName: 'dev' }).run();
      const log = db.insert(taskLogs).values({
        taskId: 1, sequence: 1, eventType: 'text', eventData: '{}',
      }).returning().get();
      expect(log.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
  });

  describe('self-referencing parent_id', () => {
    it('should allow task with valid parent_id', () => {
      db.insert(projects).values({ projectName: 'p1' }).run();
      db.insert(epics).values({ projectId: 1, epicKey: 'E1', title: 'E', orderIndex: 0 }).run();
      db.insert(stories).values({ epicId: 1, storyKey: 'S1', title: 'S', orderIndex: 0 }).run();
      db.insert(tasks).values({ storyId: 1, stageName: 'sm' }).run();
      const child = db.insert(tasks).values({
        storyId: 1,
        stageName: 'dev',
        parentId: 1,
      }).returning().get();
      expect(child.parentId).toBe(1);
    });
  });
});
