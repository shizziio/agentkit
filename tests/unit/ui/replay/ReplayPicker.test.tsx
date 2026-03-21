import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, useInput } from 'ink';
import type { Key } from 'ink';
import { PassThrough } from 'node:stream';

import { createConnection, type DrizzleDB } from '@core/db/Connection';
import { runMigrations } from '@core/db/RunMigrations';
import { projects, epics, stories, tasks } from '@core/db/schema';
import { ReplayPicker } from '@ui/replay/ReplayPicker';
import { useReplayPlayer } from '@ui/replay/useReplayPlayer';

// ---------------------------------------------------------------------------
// Mock useReplayPlayer so ReplayApp doesn't blow up when rendered in step 'replay'
// ---------------------------------------------------------------------------
vi.mock('@ui/replay/useReplayPlayer.js', () => ({
  useReplayPlayer: vi.fn(() => ({
    state: {
      taskMeta: { taskId: 1, stageName: 'dev', workerModel: null, durationMs: null, inputTokens: null, outputTokens: null },
      totalEvents: 0,
      loadedEvents: [],
      currentIndex: -1,
      playbackState: 'loading' as const,
      speed: 1,
      firstTimestampMs: 0,
      lastTimestampMs: 0,
      playbackOffsetMs: 0,
      playbackResumedAt: Date.now(),
    },
    currentEvent: null,
  })),
}));

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 80;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => { output += chunk; });
  const stripAnsi = (str: string): string =>
    str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function makeKey(partial: Partial<Key> = {}): Key {
  return {
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageDown: false, pageUp: false, return: false, escape: false,
    ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false,
    ...partial,
  };
}

type InputHandler = (input: string, key: Key) => void;

function seedProject(db: DrizzleDB): number {
  return db.insert(projects).values({ projectName: 'test-project' }).returning({ id: projects.id }).get().id;
}

function seedEpic(db: DrizzleDB, projectId: number): number {
  return db.insert(epics).values({ projectId, epicKey: '1', title: 'Epic 1', orderIndex: 0 }).returning({ id: epics.id }).get().id;
}

function seedStory(db: DrizzleDB, epicId: number, key: string, title: string): number {
  return db
    .insert(stories)
    .values({ epicId, storyKey: key, title, status: 'done', orderIndex: 0 } as unknown as typeof stories.$inferInsert)
    .returning({ id: stories.id })
    .get().id;
}

function seedTask(db: DrizzleDB, storyId: number, stageName: string, status = 'done'): number {
  return db
    .insert(tasks)
    .values({ storyId, stageName, status, completedAt: new Date().toISOString() })
    .returning({ id: tasks.id })
    .get().id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ReplayPicker', () => {
  let db: DrizzleDB;
  let projectId: number;
  let epicId: number;
  let onQuit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    projectId = seedProject(db);
    epicId = seedEpic(db, projectId);
    onQuit = vi.fn();
    vi.clearAllMocks();
  });

  it('shows "No recent tasks found" when no done tasks exist', async () => {
    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ReplayPicker, { db, projectId, onQuit }),
      { stdout: stream },
    );
    await tick();
    expect(getOutput()).toContain('No recent tasks found');
    result.unmount();
  });

  it('renders task list without crashing when done tasks exist', async () => {
    const storyId = seedStory(db, epicId, '1.1', 'My Feature Story');
    seedTask(db, storyId, 'dev');

    const { stream } = makeStream();
    const result = render(
      React.createElement(ReplayPicker, { db, projectId, onQuit }),
      { stdout: stream },
    );
    await tick();
    expect(result).toBeDefined();
    result.unmount();
  });

  it('Esc from list step calls onQuit', async () => {
    const inputHandlers: InputHandler[] = [];
    vi.mocked(useInput).mockImplementation((handler: InputHandler) => {
      inputHandlers.push(handler);
    });

    const { stream } = makeStream();
    const result = render(
      React.createElement(ReplayPicker, { db, projectId, onQuit }),
      { stdout: stream },
    );
    await tick();

    // Trigger the list-step handler (first active one)
    for (const handler of inputHandlers) {
      handler('', makeKey({ escape: true }));
    }
    expect(onQuit).toHaveBeenCalled();
    result.unmount();
  });

  it('arrow down moves cursor, Enter picks task and switches to replay step', async () => {
    const storyId = seedStory(db, epicId, '1.1', 'Story One');
    const storyId2 = seedStory(db, epicId, '1.2', 'Story Two');
    seedTask(db, storyId, 'dev');
    seedTask(db, storyId2, 'sm');

    let capturedHandler: InputHandler | undefined;
    vi.mocked(useInput).mockImplementation((handler: InputHandler, opts?: { isActive?: boolean }) => {
      if (opts?.isActive !== false) {
        capturedHandler = handler;
      }
    });

    const { stream } = makeStream();
    const result = render(
      React.createElement(ReplayPicker, { db, projectId, onQuit }),
      { stdout: stream },
    );
    await tick(100);

    // Navigate down to second item and press Enter
    capturedHandler?.('', makeKey({ downArrow: true }));
    await tick();
    capturedHandler?.('', makeKey({ return: true }));
    await tick(200);

    // Verify step='replay' was reached: ReplayApp renders and calls useReplayPlayer with a task id
    expect(vi.mocked(useReplayPlayer)).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: expect.any(Number) }),
    );
    result.unmount();
  });

  it('Enter on first task transitions to replay step when tasks exist', async () => {
    const storyId = seedStory(db, epicId, '1.1', 'Story One');
    const taskId = seedTask(db, storyId, 'dev');

    let capturedHandler: InputHandler | undefined;
    vi.mocked(useInput).mockImplementation((handler: InputHandler, opts?: { isActive?: boolean }) => {
      if (opts?.isActive !== false) {
        capturedHandler = handler;
      }
    });

    const { stream } = makeStream();
    const result = render(
      React.createElement(ReplayPicker, { db, projectId, onQuit }),
      { stdout: stream },
    );
    await tick(100);

    // Fire Enter — tasks loaded via useEffect, step transitions to 'replay'
    capturedHandler?.('', makeKey({ return: true }));
    await tick(200);

    // Verify step='replay' reached: ReplayApp renders and calls useReplayPlayer with the seeded taskId
    expect(vi.mocked(useReplayPlayer)).toHaveBeenCalledWith(
      expect.objectContaining({ taskId }),
    );
    result.unmount();
  });

  it('does not render superseded done tasks', async () => {
    const storyId = seedStory(db, epicId, '1.1', 'Superseded Story');
    db.insert(tasks).values({ storyId, stageName: 'dev', status: 'done', superseded: 1 }).run();

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ReplayPicker, { db, projectId, onQuit }),
      { stdout: stream },
    );
    await tick();
    // superseded task filtered out → no recent tasks
    expect(getOutput()).toContain('No recent tasks found');
    result.unmount();
  });

  it('does not show tasks from a different project', async () => {
    // seed a second project with a done task
    const otherId = db.insert(projects).values({ projectName: 'other-project' }).returning({ id: projects.id }).get().id;
    const otherEpicId = db.insert(epics).values({ projectId: otherId, epicKey: '1', title: 'E', orderIndex: 0 }).returning({ id: epics.id }).get().id;
    const otherStoryId = seedStory(db, otherEpicId, '1.1', 'Other Story');
    seedTask(db, otherStoryId, 'dev');

    const { stream, getOutput } = makeStream();
    const result = render(
      React.createElement(ReplayPicker, { db, projectId, onQuit }),
      { stdout: stream },
    );
    await tick();
    // Our projectId has no done tasks
    expect(getOutput()).toContain('No recent tasks found');
    result.unmount();
  });
});
