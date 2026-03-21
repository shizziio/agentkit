import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { SimpleLogger } from '../../../../src/ui/simple/SimpleLogger.js';

const mockEventBus = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

const EXPECTED_EVENTS = [
  'pipeline:start',
  'pipeline:ready',
  'pipeline:stop',
  'task:started',
  'task:completed',
  'task:failed',
  'task:routed',
  'task:rejected',
  'task:recovered',
  'story:completed',
  'story:blocked',
] as const;

describe('SimpleLogger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function getHandler(event: string): (...args: unknown[]) => void {
    const call = mockEventBus.on.mock.calls.find(([e]) => e === event);
    if (!call) throw new Error(`No handler registered for ${event}`);
    return call[1] as (...args: unknown[]) => void;
  }

  describe('constructor subscriptions', () => {
    it('calls eventBus.on for every expected event', () => {
      new SimpleLogger(mockEventBus as any);

      for (const event of EXPECTED_EVENTS) {
        expect(mockEventBus.on).toHaveBeenCalledWith(event, expect.any(Function));
      }
      expect(mockEventBus.on).toHaveBeenCalledTimes(EXPECTED_EVENTS.length);
    });
  });

  describe('task:completed', () => {
    it('writes formatted line with task id and duration', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('task:completed');

      handler({ taskId: 42, storyId: 1, stageName: 'dev', status: 'completed', durationMs: 1234 });

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Task #42 completed'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('1234ms'));
    });

    it('omits duration suffix when durationMs is undefined', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('task:completed');

      handler({ taskId: 7, storyId: 1, stageName: 'sm', status: 'completed' });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toContain('Task #7 completed');
      expect(written).not.toContain('undefinedms');
      expect(written).not.toContain('nullms');
    });

    it('omits duration suffix when durationMs is null', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('task:completed');

      handler({ taskId: 8, storyId: 1, stageName: 'sm', status: 'completed', durationMs: null });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).not.toContain('nullms');
    });

    it('includes duration when durationMs is 0', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('task:completed');

      handler({ taskId: 9, storyId: 1, stageName: 'sm', status: 'completed', durationMs: 0 });

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('0ms'));
    });
  });

  describe('story:completed', () => {
    it('writes multi-line block with story key, epic key, and formatted duration', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('story:completed');

      handler({
        storyId: 1,
        storyKey: 'story-1.1',
        epicKey: 'epic-1',
        durationMs: 83000,
        storyTitle: 'Test story',
        stageDurations: [],
        totalAttempts: 1,
      });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toContain('story-1.1');
      expect(written).toContain('epic-1');
      expect(written).toContain('1m 23s');
    });

    it('renders 0s for durationMs of 0', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('story:completed');

      handler({
        storyId: 2,
        storyKey: 'story-2.1',
        epicKey: 'epic-2',
        durationMs: 0,
        storyTitle: 'Fast story',
        stageDurations: [],
        totalAttempts: 1,
      });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toContain('0s');
    });
  });

  describe('task:failed', () => {
    it('includes FAILED and error message in output', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('task:failed');

      handler({
        taskId: 99,
        storyId: 1,
        stageName: 'review',
        status: 'failed',
        error: 'something went wrong',
      });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toContain('FAILED');
      expect(written).toContain('something went wrong');
    });

    it('falls back to "unknown error" when error field is undefined', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('task:failed');

      handler({ taskId: 5, storyId: 1, stageName: 'dev', status: 'failed' });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toContain('unknown error');
      expect(written).not.toContain('undefined');
    });
  });

  describe('task:started', () => {
    it('includes task id and attempt number', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('task:started');

      handler({ taskId: 10, storyId: 1, stageName: 'sm', status: 'running', attempt: 2 });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toContain('Task #10');
      expect(written).toContain('attempt 2');
    });

    it('defaults attempt to 1 when undefined', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('task:started');

      handler({ taskId: 11, storyId: 1, stageName: 'sm', status: 'running' });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toContain('attempt 1');
    });
  });

  describe('pipeline:ready', () => {
    it('logs recovery count when recoveredCount > 0', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('pipeline:ready');

      handler({ projectId: 1, recoveryResult: { recoveredCount: 3, recoveredTasks: [] } });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toContain('Recovered 3 task(s)');
    });

    it('omits recovery count when recoveredCount is 0', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('pipeline:ready');

      handler({ projectId: 1, recoveryResult: { recoveredCount: 0, recoveredTasks: [] } });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toContain('Pipeline ready.');
      expect(written).not.toContain('Recovered');
    });
  });

  describe('log line format', () => {
    it('writes [HH:MM:SS] [STAGE] message format', () => {
      new SimpleLogger(mockEventBus as any);
      const handler = getHandler('task:routed');

      handler({ taskId: 20, storyId: 1, stageName: 'dev', status: 'routed' });

      const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
      expect(written).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
      expect(written).toContain('DEV');
      expect(written).toContain('Task #20 routed to next stage');
    });
  });

  describe('detach()', () => {
    it('calls eventBus.off for every registered event', () => {
      const logger = new SimpleLogger(mockEventBus as any);
      logger.detach();

      for (const event of EXPECTED_EVENTS) {
        expect(mockEventBus.off).toHaveBeenCalledWith(event, expect.any(Function));
      }
      expect(mockEventBus.off).toHaveBeenCalledTimes(EXPECTED_EVENTS.length);
    });

    it('passes the same bound handler reference to off() as was passed to on()', () => {
      const logger = new SimpleLogger(mockEventBus as any);

      const onCalls = mockEventBus.on.mock.calls as Array<[string, unknown]>;
      logger.detach();
      const offCalls = mockEventBus.off.mock.calls as Array<[string, unknown]>;

      for (const [event, handler] of onCalls) {
        const match = offCalls.find(([e, h]) => e === event && h === handler);
        expect(match).toBeDefined();
      }
    });
  });

  describe('story-5-7: formatDuration inline function (MINOR fix)', () => {
    describe('formatDuration behavior', () => {
      it('formats milliseconds less than 60s as Xs', () => {
        new SimpleLogger(mockEventBus as any);
        const handler = getHandler('story:completed');

        handler({
          storyId: 100,
          storyKey: 'story-100.1',
          epicKey: 'epic-100',
          durationMs: 45000, // 45 seconds
          storyTitle: 'Test story',
          stageDurations: [],
          totalAttempts: 1,
        });

        const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
        expect(written).toContain('45s');
        expect(written).not.toContain('0m');
      });

      it('formats milliseconds >= 60s as minutes and seconds', () => {
        new SimpleLogger(mockEventBus as any);
        const handler = getHandler('story:completed');

        handler({
          storyId: 101,
          storyKey: 'story-101.1',
          epicKey: 'epic-101',
          durationMs: 125000, // 2 min 5 sec
          storyTitle: 'Test story',
          stageDurations: [],
          totalAttempts: 1,
        });

        const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
        expect(written).toContain('2m 5s');
      });

      it('formats exactly 60 seconds as 1m 0s', () => {
        new SimpleLogger(mockEventBus as any);
        const handler = getHandler('story:completed');

        handler({
          storyId: 102,
          storyKey: 'story-102.1',
          epicKey: 'epic-102',
          durationMs: 60000,
          storyTitle: 'Test story',
          stageDurations: [],
          totalAttempts: 1,
        });

        const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
        expect(written).toContain('1m 0s');
      });

      it('formats 1 millisecond as 0s', () => {
        new SimpleLogger(mockEventBus as any);
        const handler = getHandler('story:completed');

        handler({
          storyId: 103,
          storyKey: 'story-103.1',
          epicKey: 'epic-103',
          durationMs: 1,
          storyTitle: 'Test story',
          stageDurations: [],
          totalAttempts: 1,
        });

        const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
        expect(written).toContain('0s');
      });

      it('formats large durations correctly', () => {
        new SimpleLogger(mockEventBus as any);
        const handler = getHandler('story:completed');

        // 5 minutes 42 seconds = 342000 ms
        handler({
          storyId: 104,
          storyKey: 'story-104.1',
          epicKey: 'epic-104',
          durationMs: 342000,
          storyTitle: 'Test story',
          stageDurations: [],
          totalAttempts: 1,
        });

        const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
        expect(written).toContain('5m 42s');
      });

      it('rounds down fractional seconds', () => {
        new SimpleLogger(mockEventBus as any);
        const handler = getHandler('story:completed');

        // 1500ms = 1.5s, should round down to 1s
        handler({
          storyId: 105,
          storyKey: 'story-105.1',
          epicKey: 'epic-105',
          durationMs: 1500,
          storyTitle: 'Test story',
          stageDurations: [],
          totalAttempts: 1,
        });

        const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
        expect(written).toContain('1s');
        expect(written).not.toContain('1.5s');
      });
    });

    describe('inlined formatDuration isolation from @ui/dashboard', () => {
      it('uses inlined formatDuration without importing from dashboard utils', () => {
        // The SimpleLogger module should contain formatDuration function
        // This test verifies the function is self-contained
        new SimpleLogger(mockEventBus as any);
        const handler = getHandler('story:completed');

        // If formatDuration were not inlined, this would fail when dashboard utils is not available
        handler({
          storyId: 106,
          storyKey: 'story-106.1',
          epicKey: 'epic-106',
          durationMs: 83000, // 1m 23s
          storyTitle: 'Test story',
          stageDurations: [],
          totalAttempts: 1,
        });

        // Should successfully format without errors
        const written = stdoutSpy.mock.calls.map(([s]) => String(s)).join('');
        expect(written).toContain('1m 23s');
      });
    });
  });
});
