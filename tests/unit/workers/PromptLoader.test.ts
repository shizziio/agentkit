import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPrompt, injectInput } from '@workers/PromptLoader';
import { ConfigError } from '@core/Errors';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('PromptLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadPrompt', () => {
    it('loads prompt file from resolved path', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('You are a developer agent.');
      const result = loadPrompt('agentkit/prompts/dev.md', '/project');
      expect(result).toBe('You are a developer agent.');
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('agentkit/prompts/dev.md'),
        'utf-8',
      );
    });

    it('throws ConfigError if file not found', () => {
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(() => loadPrompt('missing/prompt.md', '/project')).toThrow(ConfigError);
      expect(() => loadPrompt('missing/prompt.md', '/project')).toThrow(
        /Prompt file not found/,
      );
    });

    it('throws ConfigError on path traversal attempt', () => {
      expect(() => loadPrompt('../../etc/passwd', '/project')).toThrow(ConfigError);
      expect(() => loadPrompt('../../etc/passwd', '/project')).toThrow(
        /Prompt path escapes teams directory/,
      );
    });
  });

  describe('injectInput', () => {
    it('appends input with delimiter when no placeholders', () => {
      const template = 'Process the following:';
      const result = injectInput(template, { input: '{"story": "test"}' });
      expect(result).toBe('Process the following:\n\n---\nINPUT:\n{"story": "test"}');
    });

    it('handles empty input gracefully', () => {
      const template = 'Process:';
      const result = injectInput(template, { input: '' });
      expect(result).toBe('Process:\n\n---\nINPUT:\n');
    });

    it('replaces {{TASK_INPUT}} placeholder', () => {
      const template = 'Before {{TASK_INPUT}} After';
      const result = injectInput(template, { input: 'my input' });
      expect(result).toBe('Before my input After');
    });

    it('replaces {{TASK_ID}} and {{STORY_TITLE}} placeholders', () => {
      const template = 'Task {{TASK_ID}}: {{STORY_TITLE}}\n{{TASK_INPUT}}';
      const result = injectInput(template, {
        input: 'data here',
        taskId: 42,
        storyTitle: 'My Story',
      });
      expect(result).toBe('Task 42: My Story\ndata here');
    });

    it('replaces multiple {{TASK_INPUT}} occurrences', () => {
      const template = '{{TASK_INPUT}} and {{TASK_INPUT}}';
      const result = injectInput(template, { input: 'X' });
      expect(result).toBe('X and X');
    });

    it('falls back to concatenation if no {{TASK_INPUT}} placeholder', () => {
      const template = 'No placeholders here';
      const result = injectInput(template, { input: 'some input', taskId: 1 });
      expect(result).toBe('No placeholders here\n\n---\nINPUT:\nsome input');
    });
  });

  describe('injectInput — {{OUTPUT_FILE}} injection', () => {
    it('replaces {{OUTPUT_FILE}} when outputFile option is provided and placeholder is present', () => {
      const template = '{{TASK_INPUT}}\nWrite output to: {{OUTPUT_FILE}}';
      const result = injectInput(template, { input: 'do work', outputFile: '/proj/_agent_kit/.outputs/task-5.json' });
      expect(result).toBe('do work\nWrite output to: /proj/_agent_kit/.outputs/task-5.json');
    });

    it('does not change template when outputFile is not provided', () => {
      const template = '{{TASK_INPUT}}\nOutput: {{OUTPUT_FILE}}';
      const result = injectInput(template, { input: 'data' });
      expect(result).toBe('data\nOutput: {{OUTPUT_FILE}}');
    });

    it('does not change template when template has no {{OUTPUT_FILE}} placeholder (backward compat)', () => {
      const template = '{{TASK_INPUT}}';
      const result = injectInput(template, { input: 'data', outputFile: '/some/path.json' });
      expect(result).toBe('data');
    });

    it('works correctly when both {{TASK_INPUT}} and {{OUTPUT_FILE}} are in the same template', () => {
      const template = 'Input: {{TASK_INPUT}}\nTask: {{TASK_ID}}\nOutput: {{OUTPUT_FILE}}';
      const result = injectInput(template, {
        input: 'my input',
        taskId: 7,
        outputFile: '/proj/_agent_kit/.outputs/task-7.json',
      });
      expect(result).toBe('Input: my input\nTask: 7\nOutput: /proj/_agent_kit/.outputs/task-7.json');
    });

    it('replaces multiple {{OUTPUT_FILE}} occurrences in template', () => {
      const template = '{{TASK_INPUT}}\nFile: {{OUTPUT_FILE}}\nAlso: {{OUTPUT_FILE}}';
      const result = injectInput(template, { input: 'x', outputFile: '/out.json' });
      expect(result).toBe('x\nFile: /out.json\nAlso: /out.json');
    });

    it('replaces {{OUTPUT_FILE}} in fallback concatenation path', () => {
      const template = 'No task input placeholder here. Output: {{OUTPUT_FILE}}';
      const result = injectInput(template, { input: 'data', outputFile: '/proj/.outputs/task-3.json' });
      expect(result).toBe('No task input placeholder here. Output: /proj/.outputs/task-3.json\n\n---\nINPUT:\ndata');
    });
  });
});
