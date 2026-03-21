import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import type { Key } from 'ink';

type InputHandler = (input: string, key: Key) => void;
interface CapturedInput {
  handler: InputHandler;
  isActive: boolean;
}
let capturedInputs: CapturedInput[] = [];

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn((handler: InputHandler, opts?: { isActive?: boolean }) => {
      capturedInputs.push({ handler, isActive: opts?.isActive ?? true });
    }),
  };
});

import { ModelConfigWizard } from '@ui/config/ModelConfigWizard.js';
import type { ModelConfigWizardProps, UIPipelineConfig } from '@ui/config/ModelConfigWizard.js';

const EMPTY_KEY: Key = {
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
  pageDown: false, pageUp: false, return: false, escape: false,
  ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false,
};

const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');

function makeStream(): {
  stream: NodeJS.WriteStream & { columns: number };
  getOutput: () => string;
} {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 80;
  let lastChunk = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    lastChunk = chunk;
  });
  return {
    stream: stream as unknown as NodeJS.WriteStream & { columns: number },
    getOutput: () => stripAnsi(lastChunk),
  };
}

const tick = (ms = 50): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const defaultPipeline: UIPipelineConfig = {
  team: 'alpha',
  provider: 'claude-cli',
  stages: [
    { name: 'stage1', displayName: 'Stage One', icon: '[1]' },
    { name: 'stage2', displayName: 'Stage Two', icon: '[2]' },
  ],
  models: {
    allowed: ['model-a', 'model-b', 'model-c'],
    resolved: {
      stage1: 'model-a',
      stage2: 'model-b',
    },
  },
};

function makeProps(overrides: Partial<ModelConfigWizardProps> = {}): ModelConfigWizardProps {
  return {
    pipeline: defaultPipeline,
    onSave: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    compact: false,
    ...overrides,
  };
}

function triggerInput(input: string, key: Partial<Key> = {}): void {
  const activeHandlers = capturedInputs.filter(c => c.isActive);
  if (activeHandlers.length > 0) {
    const lastHandler = activeHandlers[activeHandlers.length - 1];
    if (lastHandler) {
      lastHandler.handler(input, { ...EMPTY_KEY, ...key });
    }
  }
}

describe('ModelConfigWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInputs = [];
  });

  describe('tree step rendering', () => {
    it('renders title and pipeline details', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps()), { stdout: stream });
      await tick();
      const output = getOutput();
      expect(output).toContain('Model Configuration');
      expect(output).toContain('Team: alpha Provider: claude-cli');
      unmount();
    });

    it('renders all stages with their current models', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps()), { stdout: stream });
      await tick();
      const output = getOutput();
      expect(output).toContain('Stage One');
      expect(output).toContain('model-a');
      expect(output).toContain('Stage Two');
      expect(output).toContain('model-b');
      unmount();
    });

    it('marks the active stage with "> "', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps()), { stdout: stream });
      await tick();
      const output = getOutput();
      expect(output).toContain('> [1]');
      expect(output).toContain('  [2]');
      unmount();
    });
  });

  describe('tree step navigation', () => {
    it('moves cursor down on downArrow', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps()), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      const output = getOutput();
      expect(output).toContain('  [1]');
      expect(output).toContain('> [2]');
      unmount();
    });

    it('moves cursor up on upArrow after moving down', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps()), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      triggerInput('', { upArrow: true });
      await tick();
      const output = getOutput();
      expect(output).toContain('> [1]');
      expect(output).toContain('  [2]');
      unmount();
    });
  });

  describe('picking step', () => {
    it('enters picking step on Enter', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps()), { stdout: stream });
      await tick();
      triggerInput('', { return: true }); // Select stage1
      await tick();
      const output = getOutput();
      expect(output).toContain('◉  model-a'); // active model
      expect(output).toContain('○  model-b');
      expect(output).toContain('○  model-c');
      unmount();
    });

    it('enters picking step on Space', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps()), { stdout: stream });
      await tick();
      triggerInput(' ', {}); // Select stage1
      await tick();
      const output = getOutput();
      expect(output).toContain('◉  model-a');
      unmount();
    });

    it('navigates models and selects one', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps()), { stdout: stream });
      await tick();
      triggerInput('', { return: true }); // Enter picking
      await tick();
      triggerInput('', { downArrow: true }); // Move to model-b
      await tick();
      expect(getOutput()).toContain('◉  model-b');
      triggerInput('', { return: true }); // Confirm model-b
      await tick();
      
      const output = getOutput();
      // Back to tree view, model should be updated, cursor should move to next stage (stage2)
      expect(output).not.toContain('◉  model-b'); // Picker is gone
      expect(output).toContain('> [2]'); // Cursor moved
      unmount();
    });

    it('cancels picking step on Esc', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps()), { stdout: stream });
      await tick();
      triggerInput('', { return: true }); // Enter picking
      await tick();
      triggerInput('', { downArrow: true }); // Move to model-b
      await tick();
      triggerInput('', { escape: true }); // Cancel
      await tick();
      
      const output = getOutput();
      // Back to tree view, model should NOT be updated, cursor remains on stage1
      expect(output).toContain('> [1]');
      expect(output).toContain('model-a'); // Still original
      unmount();
    });
  });

  describe('actions (Save & Quit)', () => {
    it('calls onCancel when pressing Q', async () => {
      const onCancel = vi.fn();
      const { stream } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps({ onCancel })), { stdout: stream });
      await tick();
      triggerInput('q');
      await tick();
      expect(onCancel).toHaveBeenCalled();
      unmount();
    });

    it('saves models when pressing S', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps({ onSave })), { stdout: stream });
      await tick();
      triggerInput('s');
      await tick();
      expect(onSave).toHaveBeenCalledWith({
        stage1: 'model-a',
        stage2: 'model-b',
      });
      const output = getOutput();
      expect(output).toContain('Done! Model assignments saved');
      unmount();
    });

    it('handles save error', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps({ onSave })), { stdout: stream });
      await tick();
      triggerInput('s');
      await tick();
      const output = getOutput();
      expect(output).toContain('Error: Save failed');
      unmount();
    });
  });

  describe('done state', () => {
    it('calls onComplete when any key is pressed in done state', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const onComplete = vi.fn();
      const { stream } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps({ onSave, onComplete })), { stdout: stream });
      await tick();
      triggerInput('s');
      await tick();
      triggerInput('', { return: true });
      await tick();
      expect(onComplete).toHaveBeenCalled();
      unmount();
    });
  });

  describe('error state', () => {
    it('calls onComplete when any key is pressed in error state', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('error'));
      const onComplete = vi.fn();
      const { stream } = makeStream();
      const { unmount } = render(React.createElement(ModelConfigWizard, makeProps({ onSave, onComplete })), { stdout: stream });
      await tick();
      triggerInput('s');
      await tick();
      triggerInput('', { return: true });
      await tick();
      expect(onComplete).toHaveBeenCalled();
      unmount();
    });
  });
});
