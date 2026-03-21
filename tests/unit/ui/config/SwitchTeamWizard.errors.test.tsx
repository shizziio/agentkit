import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import type { Key } from 'ink';

// ---------------------------------------------------------------------------
// Capture useInput handlers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------
import { SwitchTeamWizard } from '@ui/config/SwitchTeamWizard.js';
import type { SwitchTeamWizardProps } from '@ui/config/SwitchTeamWizard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

function makeProps(overrides: Partial<SwitchTeamWizardProps> = {}): SwitchTeamWizardProps {
  return {
    mergedTeams: ['alpha', 'beta'],
    projectTeams: ['alpha', 'beta'],
    activeTeam: 'alpha',
    loadError: null,
    onSwitch: vi.fn().mockResolvedValue(undefined),
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    compact: false,
    ...overrides,
  };
}

function triggerInput(input: string, key: Partial<Key> = {}): void {
  capturedInputs.forEach(({ handler }) => handler(input, { ...EMPTY_KEY, ...key }));
}

// ---------------------------------------------------------------------------
// Tests — error states, onSwitch error, Esc handling
// ---------------------------------------------------------------------------
describe('SwitchTeamWizard — errors and Esc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInputs = [];
  });

  describe('onSwitch error handling', () => {
    it('shows TeamSwitchError message when onSwitch rejects with TeamSwitchError', async () => {
      const { TeamSwitchError } = await import('@core/Errors.js');
      const errMsg = 'Workers dang chay. Dung workers truoc khi switch team.';
      const onSwitch = vi.fn().mockRejectedValue(new TeamSwitchError(errMsg));
      const { stream, getOutput } = makeStream();
      const props = makeProps({ onSwitch });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      triggerInput('', { return: true });
      await tick(100);
      expect(getOutput()).toContain(errMsg);
      unmount();
    });

    it('shows TeamSwitchError message for team-not-found case', async () => {
      const { TeamSwitchError } = await import('@core/Errors.js');
      const errMsg = "Team 'unknown' khong ton tai.";
      const onSwitch = vi.fn().mockRejectedValue(new TeamSwitchError(errMsg));
      const { stream, getOutput } = makeStream();
      const props = makeProps({ onSwitch });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      triggerInput('', { return: true });
      await tick(100);
      expect(getOutput()).toContain(errMsg);
      unmount();
    });

    it('shows generic error message when onSwitch rejects with a non-TeamSwitchError', async () => {
      const onSwitch = vi.fn().mockRejectedValue(new Error('Unexpected failure'));
      const { stream, getOutput } = makeStream();
      const props = makeProps({ onSwitch });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      triggerInput('', { return: true });
      await tick(100);
      expect(getOutput()).toContain('Error: Unexpected failure');
      unmount();
    });
  });

  describe('Esc key', () => {
    it('calls onCancel when Esc pressed in list step', async () => {
      const onCancel = vi.fn();
      const { stream } = makeStream();
      const props = makeProps({ onCancel });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { escape: true });
      await tick();
      expect(onCancel).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('does not call onSwitch on Esc', async () => {
      const onSwitch = vi.fn().mockResolvedValue(undefined);
      const { stream } = makeStream();
      const props = makeProps({ onSwitch });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { escape: true });
      await tick();
      expect(onSwitch).not.toHaveBeenCalled();
      unmount();
    });
  });

  describe('load error state', () => {
    it('shows error message when loadError is set', async () => {
      const { stream, getOutput } = makeStream();
      const props = makeProps({ loadError: 'config not found', mergedTeams: [], projectTeams: [], activeTeam: '' });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Error loading config: config not found');
      unmount();
    });

    it('calls onComplete when non-Esc key pressed in error state', async () => {
      const onComplete = vi.fn();
      const { stream } = makeStream();
      const props = makeProps({ loadError: 'config not found', mergedTeams: [], projectTeams: [], activeTeam: '', onComplete });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('x');
      await tick();
      expect(onComplete).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('calls onCancel when Esc pressed in error state', async () => {
      const onCancel = vi.fn();
      const onComplete = vi.fn();
      const { stream } = makeStream();
      const props = makeProps({ loadError: 'config not found', mergedTeams: [], projectTeams: [], activeTeam: '', onCancel, onComplete });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { escape: true });
      await tick();
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onComplete).not.toHaveBeenCalled();
      unmount();
    });
  });
});
