import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskLogWriter } from '@workers/TaskLogWriter';
import type { StreamEvent } from '@core/EventTypes';

// Mock defaults
vi.mock('@config/defaults.js', () => ({
  LOG_BATCH_SIZE: 50,
  LOG_FLUSH_INTERVAL: 500,
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
}));

// Mock schema
vi.mock('@core/db/schema.js', () => ({
  taskLogs: {
    taskId: 'task_id',
    sequence: 'sequence',
    eventType: 'event_type',
    eventData: 'event_data',
  },
}));

function makeEvent(taskId: number, type: StreamEvent['type'] = 'text', data: StreamEvent['data'] = { text: 'hello' }): StreamEvent {
  return { taskId, type, stageName: 'dev', timestamp: Date.now(), data };
}

function createMockDb() {
  const insertRunFn = vi.fn();
  const insertValuesFn = vi.fn().mockReturnValue({ run: insertRunFn });
  const insertFn = vi.fn().mockReturnValue({ values: insertValuesFn });

  const selectGetFn = vi.fn().mockReturnValue(undefined);
  const selectLimitFn = vi.fn().mockReturnValue({ get: selectGetFn });
  const selectOrderByFn = vi.fn().mockReturnValue({ limit: selectLimitFn });
  const selectWhereFn = vi.fn().mockReturnValue({ orderBy: selectOrderByFn });
  const selectFromFn = vi.fn().mockReturnValue({ where: selectWhereFn });
  const selectFn = vi.fn().mockReturnValue({ from: selectFromFn });

  const db = {
    transaction: vi.fn().mockImplementation((fn: (tx: Record<string, unknown>) => void) => {
      fn({ insert: insertFn });
    }),
    select: selectFn,
    insert: insertFn,
  };

  return { db, insertFn, insertValuesFn, insertRunFn, selectGetFn };
}

describe('TaskLogWriter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('buffers events without immediate DB insert', () => {
    const { db, insertFn } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    writer.write(1, makeEvent(1));

    expect(db.transaction).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
  });

  it('flush() inserts all buffered events in a single transaction', () => {
    const { db, insertValuesFn } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    writer.write(1, makeEvent(1));
    writer.write(1, makeEvent(1, 'done', {}));
    writer.flush();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(insertValuesFn).toHaveBeenCalledTimes(2);
  });

  it('auto-flushes when buffer reaches LOG_BATCH_SIZE (50)', () => {
    const { db } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    for (let i = 0; i < 50; i++) {
      writer.write(1, makeEvent(1));
    }

    // Should have auto-flushed
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('timer-based flush triggers at LOG_FLUSH_INTERVAL (500ms)', async () => {
    const { db } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    writer.write(1, makeEvent(1));
    expect(db.transaction).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(db.transaction).toHaveBeenCalledTimes(1);

    await writer.drain();
  });

  it('drain() flushes remaining events and clears the timer', async () => {
    const { db } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    writer.write(1, makeEvent(1));
    await writer.drain();

    expect(db.transaction).toHaveBeenCalledTimes(1);

    // Timer should be cleared — advancing time should not trigger another flush
    writer.write(1, makeEvent(1));
    vi.advanceTimersByTime(1000);
    // Only the one transaction from drain, no timer-based flush since timer was cleared
    // But write() re-starts the timer, so we need to drain again
    await writer.drain();
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });

  it('sequence numbers increment per taskId independently', () => {
    const { db, insertValuesFn } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    writer.write(1, makeEvent(1));
    writer.write(2, makeEvent(2));
    writer.write(1, makeEvent(1));
    writer.flush();

    const calls = insertValuesFn.mock.calls;
    // Task 1: sequence 1, then 2
    expect(calls[0][0].taskId).toBe(1);
    expect(calls[0][0].sequence).toBe(1);
    expect(calls[1][0].taskId).toBe(2);
    expect(calls[1][0].sequence).toBe(1);
    expect(calls[2][0].taskId).toBe(1);
    expect(calls[2][0].sequence).toBe(2);
  });

  it('multiple taskIds can be written concurrently', () => {
    const { db, insertValuesFn } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    writer.write(1, makeEvent(1));
    writer.write(2, makeEvent(2));
    writer.write(3, makeEvent(3));
    writer.flush();

    expect(insertValuesFn).toHaveBeenCalledTimes(3);
  });

  it('flush() with empty buffer is a no-op', () => {
    const { db } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    writer.flush();

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('drain() can be called multiple times safely', async () => {
    const { db } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    writer.write(1, makeEvent(1));
    await writer.drain();
    await writer.drain();
    await writer.drain();

    // Only one transaction (from first drain with data)
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('continues sequence from existing DB records for crash recovery', () => {
    const { db, selectGetFn, insertValuesFn } = createMockDb();
    // Simulate existing sequence 5 in DB
    selectGetFn.mockReturnValueOnce({ sequence: 5 });

    const writer = new TaskLogWriter(db as never);

    writer.write(1, makeEvent(1));
    writer.flush();

    expect(insertValuesFn.mock.calls[0][0].sequence).toBe(6);
  });

  it('stores event data as JSON string', () => {
    const { db, insertValuesFn } = createMockDb();
    const writer = new TaskLogWriter(db as never);

    writer.write(1, makeEvent(1, 'text', { text: 'hello world' }));
    writer.flush();

    expect(insertValuesFn.mock.calls[0][0].eventData).toBe('{"text":"hello world"}');
    expect(insertValuesFn.mock.calls[0][0].eventType).toBe('text');
  });
});
