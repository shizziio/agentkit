import { describe, it, expect } from 'vitest';
import { parseOutput } from '@workers/OutputParser';

describe('OutputParser', () => {
  describe('Strategy 1: markdown code block', () => {
    it('extracts and parses valid ```json block', () => {
      const raw = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
      const result = parseOutput(raw);
      expect(result).toEqual({ success: true, data: { key: 'value' } });
    });

    it('handles multiline JSON in code block', () => {
      const raw = '```json\n{\n  "a": 1,\n  "b": [2, 3]\n}\n```';
      const result = parseOutput(raw);
      expect(result).toEqual({ success: true, data: { a: 1, b: [2, 3] } });
    });

    it('uses first valid code block when multiple exist', () => {
      const raw = '```json\n{"first": true}\n```\n```json\n{"second": true}\n```';
      const result = parseOutput(raw);
      expect(result).toEqual({ success: true, data: { first: true } });
    });

    it('skips malformed code block and uses next valid one', () => {
      const raw = '```json\n{invalid json}\n```\n```json\n{"second": true}\n```';
      const result = parseOutput(raw);
      expect(result).toEqual({ success: true, data: { second: true } });
    });

    it('falls through to strategy 2 if all code blocks are malformed', () => {
      const raw = '```json\n{invalid json}\n```\n{"fallback": true}';
      const result = parseOutput(raw);
      expect(result).toEqual({ success: true, data: { fallback: true } });
    });
  });

  describe('Strategy 2: balanced braces', () => {
    it('extracts JSON from end of text', () => {
      const raw = 'Here is the result:\n{"status": "ok", "count": 42}';
      const result = parseOutput(raw);
      expect(result).toEqual({ success: true, data: { status: 'ok', count: 42 } });
    });

    it('handles deeply nested braces', () => {
      const raw = 'Output: {"a": {"b": {"c": {"d": 1}}}}';
      const result = parseOutput(raw);
      expect(result).toEqual({
        success: true,
        data: { a: { b: { c: { d: 1 } } } },
      });
    });

    it('handles JSON with array values containing objects', () => {
      const raw = 'Result: {"items": [{"id": 1}, {"id": 2}]}';
      const result = parseOutput(raw);
      expect(result).toEqual({
        success: true,
        data: { items: [{ id: 1 }, { id: 2 }] },
      });
    });
  });

  describe('both strategies fail', () => {
    it('returns failure for empty input', () => {
      const result = parseOutput('');
      expect(result).toEqual({
        success: false,
        rawText: '',
        error: 'JSON_PARSE_ERROR',
      });
    });

    it('returns failure for plain text', () => {
      const result = parseOutput('No JSON here at all');
      expect(result).toEqual({
        success: false,
        rawText: 'No JSON here at all',
        error: 'JSON_PARSE_ERROR',
      });
    });

    it('returns failure for unbalanced braces', () => {
      const result = parseOutput('{ unclosed');
      expect(result).toEqual({
        success: false,
        rawText: '{ unclosed',
        error: 'JSON_PARSE_ERROR',
      });
    });
  });

  describe('priority', () => {
    it('strategy 1 takes priority over strategy 2', () => {
      const raw = '{"ignored": true}\n```json\n{"preferred": true}\n```\n{"also_ignored": true}';
      const result = parseOutput(raw);
      expect(result).toEqual({ success: true, data: { preferred: true } });
    });
  });

  describe('failure rawText preservation', () => {
    it('rawText in failure result is always the full input string', () => {
      const input = 'This is some text that has no JSON whatsoever in it at all';
      const result = parseOutput(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.rawText).toBe(input);
      }
    });

    it('rawText is empty string when input is empty', () => {
      const result = parseOutput('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.rawText).toBe('');
      }
    });
  });
});
