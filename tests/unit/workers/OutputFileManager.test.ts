import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';

import {
  getOutputPath,
  ensureOutputDir,
  readOutputFile,
  cleanupStaleOutputs,
  deleteOutputFile,
} from '@workers/OutputFileManager';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('@core/Logger.js', () => ({
  Logger: {
    getOrNoop: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockUnlinkSync = vi.mocked(unlinkSync);

describe('OutputFileManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOutputPath', () => {
    it('returns correct absolute path for a given taskId', () => {
      const result = getOutputPath('/proj', 42);
      expect(result).toMatch(/_agent_kit[/\\]\.outputs[/\\]task-42\.json$/);
      expect(result).toMatch(/^\/proj/);
    });

    it('returns valid path for taskId=0', () => {
      const result = getOutputPath('/proj', 0);
      expect(result).toMatch(/task-0\.json$/);
    });

    it('returns an absolute path', () => {
      const result = getOutputPath('/some/project/root', 99);
      expect(result).toMatch(/^\/some\/some\/project\/root|^\/some\/project\/root/);
      expect(result.endsWith('task-99.json')).toBe(true);
    });
  });

  describe('ensureOutputDir', () => {
    it('calls mkdirSync with recursive:true on _agent_kit/.outputs/ path', () => {
      ensureOutputDir('/proj');
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.outputs'),
        { recursive: true },
      );
    });
  });

  describe('readOutputFile', () => {
    it('returns { success: true, data } for valid JSON file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{"key":"value"}');
      const result = readOutputFile('/proj/_agent_kit/.outputs/task-1.json');
      expect(result).toEqual({ success: true, data: { key: 'value' } });
    });

    it('returns { success: false, error: INVALID_OUTPUT_JSON, rawText } for malformed JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not valid json{');
      const result = readOutputFile('/proj/_agent_kit/.outputs/task-1.json');
      expect(result).toEqual({
        success: false,
        error: 'INVALID_OUTPUT_JSON',
        rawText: 'not valid json{',
      });
    });

    it('returns { success: false, error: OUTPUT_FILE_MISSING } when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = readOutputFile('/proj/_agent_kit/.outputs/task-1.json');
      expect(result).toEqual({ success: false, error: 'OUTPUT_FILE_MISSING' });
    });

    it('never throws — returns missing result when fs throws unexpectedly', () => {
      mockExistsSync.mockImplementation(() => { throw new Error('unexpected'); });
      expect(() => readOutputFile('/bad/path')).not.toThrow();
      const result = readOutputFile('/bad/path');
      expect(result.success).toBe(false);
    });

    it('handles empty string content as INVALID_OUTPUT_JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('');
      const result = readOutputFile('/proj/_agent_kit/.outputs/task-1.json');
      expect(result).toEqual({ success: false, error: 'INVALID_OUTPUT_JSON', rawText: '' });
    });

    it('handles whitespace-only content as INVALID_OUTPUT_JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('   ');
      const result = readOutputFile('/proj/_agent_kit/.outputs/task-1.json');
      expect(result).toEqual({ success: false, error: 'INVALID_OUTPUT_JSON', rawText: '   ' });
    });

    it('handles valid JSON null as success', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('null');
      const result = readOutputFile('/proj/_agent_kit/.outputs/task-1.json');
      expect(result).toEqual({ success: true, data: null });
    });
  });

  describe('cleanupStaleOutputs', () => {
    it('deletes all files in _agent_kit/.outputs/ and logs count', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'task-1.json', isFile: () => true } as ReturnType<typeof readdirSync>[number],
        { name: 'task-2.json', isFile: () => true } as ReturnType<typeof readdirSync>[number],
      ]);
      cleanupStaleOutputs('/proj');
      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    });

    it('does not throw when directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => cleanupStaleOutputs('/proj')).not.toThrow();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('handles empty directory (0 files) without throwing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
      expect(() => cleanupStaleOutputs('/proj')).not.toThrow();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('skips non-file entries (subdirectories)', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'subdir', isFile: () => false } as ReturnType<typeof readdirSync>[number],
        { name: 'task-1.json', isFile: () => true } as ReturnType<typeof readdirSync>[number],
      ]);
      cleanupStaleOutputs('/proj');
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
    });

    it('does not throw when readdirSync throws', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => { throw new Error('perm denied'); });
      expect(() => cleanupStaleOutputs('/proj')).not.toThrow();
    });
  });

  describe('deleteOutputFile', () => {
    it('calls unlinkSync when file exists', () => {
      mockExistsSync.mockReturnValue(true);
      deleteOutputFile('/proj/_agent_kit/.outputs/task-1.json');
      expect(mockUnlinkSync).toHaveBeenCalledWith('/proj/_agent_kit/.outputs/task-1.json');
    });

    it('does not throw when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => deleteOutputFile('/proj/_agent_kit/.outputs/task-1.json')).not.toThrow();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('does not throw when unlinkSync throws', () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => { throw new Error('EPERM'); });
      expect(() => deleteOutputFile('/proj/_agent_kit/.outputs/task-1.json')).not.toThrow();
    });
  });
});
