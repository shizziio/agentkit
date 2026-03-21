import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  resolveOutput,
  buildFailOutput,
  updateTaskFailed,
} from '@workers/OutputResolver';

// Mock OutputFileManager
vi.mock('@workers/OutputFileManager.js', () => ({
  readOutputFile: vi.fn(),
}));

// Mock OutputParser
vi.mock('@workers/OutputParser.js', () => ({
  parseOutput: vi.fn(),
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
}));

// Mock schema
vi.mock('@core/db/schema.js', () => ({
  tasks: { id: 'id' },
}));

import { readOutputFile } from '@workers/OutputFileManager';
import { parseOutput } from '@workers/OutputParser';

const mockReadOutputFile = vi.mocked(readOutputFile);
const mockParseOutput = vi.mocked(parseOutput);

describe('OutputResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────
  // resolveOutput — tier 1: file wins
  // ──────────────────────────────────────────────────────────
  describe('resolveOutput — tier 1: file-based output', () => {
    it('returns kind=done source=file when output file is valid JSON', () => {
      mockReadOutputFile.mockReturnValue({ success: true, data: { status: 'DONE' } });

      const result = resolveOutput('/path/to/task-1.json', '', undefined, undefined);

      expect(result.kind).toBe('done');
      if (result.kind === 'done') {
        expect(result.source).toBe('file');
        expect(result.output).toBe(JSON.stringify({ status: 'DONE' }));
      }
    });

    it('includes inputTokens and outputTokens from args when file is the source', () => {
      mockReadOutputFile.mockReturnValue({ success: true, data: { result: 'ok' } });

      const result = resolveOutput('/path/task-1.json', 'ignored text', 100, 200);

      expect(result.kind).toBe('done');
      if (result.kind === 'done') {
        expect(result.inputTokens).toBe(100);
        expect(result.outputTokens).toBe(200);
        expect(result.source).toBe('file');
      }
    });

    it('does NOT call parseOutput when file read succeeds', () => {
      mockReadOutputFile.mockReturnValue({ success: true, data: {} });

      resolveOutput('/path/task-1.json', 'some collected text');

      expect(mockParseOutput).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────
  // resolveOutput — tier 2: stdout fallback
  // ──────────────────────────────────────────────────────────
  describe('resolveOutput — tier 2: stdout fallback', () => {
    it('falls back to parseOutput when file is missing', () => {
      mockReadOutputFile.mockReturnValue({ success: false, error: 'OUTPUT_FILE_MISSING' });
      mockParseOutput.mockReturnValue({ success: true, data: { fallback: true } });

      const result = resolveOutput('/path/task-1.json', 'collected text', 50, 75);

      expect(result.kind).toBe('done');
      if (result.kind === 'done') {
        expect(result.source).toBe('stdout');
        expect(result.output).toBe(JSON.stringify({ fallback: true }));
        expect(result.inputTokens).toBe(50);
        expect(result.outputTokens).toBe(75);
      }
    });

    it('falls back to parseOutput when file contains invalid JSON', () => {
      mockReadOutputFile.mockReturnValue({ success: false, error: 'INVALID_OUTPUT_JSON' });
      mockParseOutput.mockReturnValue({ success: true, data: { parsed: 'from stdout' } });

      const result = resolveOutput('/path/task-1.json', 'json output here');

      expect(result.kind).toBe('done');
      if (result.kind === 'done') {
        expect(result.source).toBe('stdout');
      }
    });
  });

  // ──────────────────────────────────────────────────────────
  // resolveOutput — tier 3: failure
  // ──────────────────────────────────────────────────────────
  describe('resolveOutput — tier 3: failure', () => {
    it('returns kind=failed with OUTPUT_MISSING when file missing and stdout unparseable', () => {
      mockReadOutputFile.mockReturnValue({ success: false, error: 'OUTPUT_FILE_MISSING' });
      mockParseOutput.mockReturnValue({ success: false, rawText: 'raw output text' });

      const result = resolveOutput('/path/task-1.json', 'raw output text');

      expect(result.kind).toBe('failed');
      if (result.kind === 'failed') {
        expect(result.error).toBe('OUTPUT_MISSING');
        expect(result.rawText).toBe('raw output text');
      }
    });

    it('returns kind=failed with INVALID_OUTPUT_JSON when file has invalid JSON and stdout unparseable', () => {
      mockReadOutputFile.mockReturnValue({ success: false, error: 'INVALID_OUTPUT_JSON' });
      mockParseOutput.mockReturnValue({ success: false, rawText: 'garbage text' });

      const result = resolveOutput('/path/task-1.json', 'garbage text');

      expect(result.kind).toBe('failed');
      if (result.kind === 'failed') {
        expect(result.error).toBe('INVALID_OUTPUT_JSON');
      }
    });

    it('uses collectedText as rawText fallback when parseOutput rawText is undefined', () => {
      mockReadOutputFile.mockReturnValue({ success: false, error: 'OUTPUT_FILE_MISSING' });
      mockParseOutput.mockReturnValue({ success: false });

      const result = resolveOutput('/path/task-1.json', 'fallback collected text');

      expect(result.kind).toBe('failed');
      if (result.kind === 'failed') {
        expect(result.rawText).toBe('fallback collected text');
      }
    });

    it('tokens are not present on failed result', () => {
      mockReadOutputFile.mockReturnValue({ success: false, error: 'OUTPUT_FILE_MISSING' });
      mockParseOutput.mockReturnValue({ success: false, rawText: '' });

      const result = resolveOutput('/path/task-1.json', '', 100, 200);

      expect(result.kind).toBe('failed');
      expect(result).not.toHaveProperty('inputTokens');
      expect(result).not.toHaveProperty('outputTokens');
    });
  });

  // ──────────────────────────────────────────────────────────
  // buildFailOutput
  // ──────────────────────────────────────────────────────────
  describe('buildFailOutput', () => {
    it('produces valid JSON containing required fields', () => {
      const events = [{ type: 'text', data: { text: 'hello' } }];
      const json = buildFailOutput('raw', 'OUTPUT_MISSING', 'stdout', 'stderr', events);
      const parsed = JSON.parse(json);

      expect(parsed.rawText).toBe('raw');
      expect(parsed.error).toBe('OUTPUT_MISSING');
      expect(parsed.stdout).toBe('stdout');
      expect(parsed.stderr).toBe('stderr');
      expect(parsed.eventCount).toBe(1);
      expect(Array.isArray(parsed.eventTypes)).toBe(true);
      expect(parsed.collectedEvents).toHaveLength(1);
    });

    it('deduplicates eventTypes', () => {
      const events = [
        { type: 'text', data: { text: 'a' } },
        { type: 'text', data: { text: 'b' } },
        { type: 'done', data: {} },
      ];
      const json = buildFailOutput('raw', 'err', '', '', events);
      const parsed = JSON.parse(json);

      expect(parsed.eventTypes).toEqual(expect.arrayContaining(['text', 'done']));
      expect(parsed.eventTypes).toHaveLength(2); // deduped
    });

    it('handles empty events array', () => {
      const json = buildFailOutput('raw', 'err', '', '', []);
      const parsed = JSON.parse(json);

      expect(parsed.eventCount).toBe(0);
      expect(parsed.collectedEvents).toHaveLength(0);
      expect(parsed.eventTypes).toHaveLength(0);
    });

    it('truncates events to sentinel when payload exceeds 500KB and has more than 20 events', () => {
      // Create large events (> 500KB total) with more than 20 entries
      const largeData = 'x'.repeat(30 * 1024); // 30KB per event
      const events = Array.from({ length: 25 }, (_, i) => ({
        type: 'text',
        data: { text: largeData, index: i },
      }));

      const json = buildFailOutput('raw', 'err', '', '', events);
      const parsed = JSON.parse(json);

      // Should have: 10 head + 1 sentinel + 10 tail = 21 entries
      expect(parsed.collectedEvents).toHaveLength(21);
      const sentinel = parsed.collectedEvents.find(
        (e: { type: string }) => e.type === 'truncated',
      );
      expect(sentinel).toBeDefined();
      expect(sentinel.data.count).toBe(25 - 20); // truncated count
    });

    it('does NOT truncate when events are small even if there are many', () => {
      const events = Array.from({ length: 25 }, (_, i) => ({
        type: 'text',
        data: { i },
      }));

      const json = buildFailOutput('raw', 'err', '', '', events);
      const parsed = JSON.parse(json);

      // Should not truncate since total size is small
      expect(parsed.collectedEvents).toHaveLength(25);
      const sentinel = parsed.collectedEvents.find(
        (e: { type: string }) => e.type === 'truncated',
      );
      expect(sentinel).toBeUndefined();
    });

    it('does NOT truncate when events exceed 500KB but there are 20 or fewer', () => {
      const largeData = 'x'.repeat(50 * 1024); // 50KB per event
      const events = Array.from({ length: 12 }, (_, i) => ({
        type: 'text',
        data: { text: largeData, index: i },
      }));

      const json = buildFailOutput('raw', 'err', '', '', events);
      const parsed = JSON.parse(json);

      // 12 events <= 20, no truncation
      expect(parsed.collectedEvents).toHaveLength(12);
    });

    it('eventCount reflects original count even when truncated', () => {
      const largeData = 'x'.repeat(30 * 1024);
      const events = Array.from({ length: 25 }, (_, i) => ({
        type: 'text',
        data: { text: largeData, index: i },
      }));

      const json = buildFailOutput('raw', 'err', '', '', events);
      const parsed = JSON.parse(json);

      expect(parsed.eventCount).toBe(25); // original count preserved
    });
  });

  // ──────────────────────────────────────────────────────────
  // updateTaskFailed
  // ──────────────────────────────────────────────────────────
  describe('updateTaskFailed', () => {
    function createMockDb() {
      const runFn = vi.fn();
      const whereFn = vi.fn().mockReturnValue({ run: runFn });
      const setFn = vi.fn().mockReturnValue({ where: whereFn });
      const updateFn = vi.fn().mockReturnValue({ set: setFn });
      const transactionFn = vi.fn().mockImplementation((cb: (tx: typeof db) => void) => cb(db));
      const db = { update: updateFn, transaction: transactionFn } as never;
      return { db, updateFn, setFn, whereFn, runFn, transactionFn };
    }

    it('calls db.transaction and updates task status to failed', () => {
      const { db, transactionFn, setFn } = createMockDb();

      updateTaskFailed(db, 42, 'raw text', 'OUTPUT_MISSING', 1500);

      expect(transactionFn).toHaveBeenCalledTimes(1);
      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          durationMs: 1500,
        }),
      );
    });

    it('sets completedAt and updatedAt as ISO strings', () => {
      const { db, setFn } = createMockDb();

      updateTaskFailed(db, 1, '', 'OUTPUT_MISSING', 0);

      const setArg = setFn.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof setArg.completedAt).toBe('string');
      expect(typeof setArg.updatedAt).toBe('string');
      // Verify ISO format
      expect(() => new Date(setArg.completedAt as string)).not.toThrow();
    });

    it('uses where(eq(tasks.id, taskId)) to target the correct task', () => {
      const { db, whereFn } = createMockDb();

      updateTaskFailed(db, 99, 'output', 'INVALID_OUTPUT_JSON', 2000);

      // eq is mocked to return {} so just check whereFn was called
      expect(whereFn).toHaveBeenCalledTimes(1);
    });

    it('output field is valid JSON containing error and rawText', () => {
      const { db, setFn } = createMockDb();

      updateTaskFailed(db, 5, 'some raw output', 'OUTPUT_MISSING', 500, 'stdout here', 'stderr here');

      const setArg = setFn.mock.calls[0][0] as Record<string, unknown>;
      const output = JSON.parse(setArg.output as string);

      expect(output.rawText).toBe('some raw output');
      expect(output.error).toBe('OUTPUT_MISSING');
      expect(output.stdout).toBe('stdout here');
      expect(output.stderr).toBe('stderr here');
    });

    it('defaults stdout and stderr to empty string when not provided', () => {
      const { db, setFn } = createMockDb();

      updateTaskFailed(db, 1, 'raw', 'OUTPUT_MISSING', 100);

      const setArg = setFn.mock.calls[0][0] as Record<string, unknown>;
      const output = JSON.parse(setArg.output as string);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('');
    });

    it('defaults collectedEvents to empty array when not provided', () => {
      const { db, setFn } = createMockDb();

      updateTaskFailed(db, 1, 'raw', 'OUTPUT_MISSING', 100);

      const setArg = setFn.mock.calls[0][0] as Record<string, unknown>;
      const output = JSON.parse(setArg.output as string);
      expect(output.eventCount).toBe(0);
      expect(output.collectedEvents).toHaveLength(0);
    });

    it('passes collectedEvents to buildFailOutput', () => {
      const { db, setFn } = createMockDb();
      const events = [{ type: 'text', data: { text: 'hello' } }];

      updateTaskFailed(db, 2, 'raw', 'OUTPUT_MISSING', 200, '', '', events);

      const setArg = setFn.mock.calls[0][0] as Record<string, unknown>;
      const output = JSON.parse(setArg.output as string);
      expect(output.eventCount).toBe(1);
    });
  });
});
