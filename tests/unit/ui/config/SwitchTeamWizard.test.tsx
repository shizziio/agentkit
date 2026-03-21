import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import type { Key } from 'ink';

// Mock EventBus
vi.mock('@core/EventBus.js', () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

import { eventBus } from '@core/EventBus.js';

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
// Tests
// ---------------------------------------------------------------------------
describe('SwitchTeamWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInputs = [];
  });

  describe('team list rendering', () => {
    it('renders Switch Team title', async () => {
      const { stream, getOutput } = makeStream();
      const { unmount } = render(React.createElement(SwitchTeamWizard, makeProps()), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Switch Team');
      unmount();
    });

    it('renders all teams from mergedTeams', async () => {
      const { stream, getOutput } = makeStream();
      const props = makeProps({
        mergedTeams: ['alpha', 'beta', 'gamma'],
        projectTeams: ['alpha', 'beta', 'gamma'],
        activeTeam: 'alpha',
      });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      const output = getOutput();
      expect(output).toContain('alpha');
      expect(output).toContain('beta');
      expect(output).toContain('gamma');
      unmount();
    });

    it('marks active team with [*]', async () => {
      const { stream, getOutput } = makeStream();
      const props = makeProps({
        mergedTeams: ['alpha', 'beta'],
        projectTeams: ['alpha', 'beta'],
        activeTeam: 'beta',
      });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      const output = getOutput();
      expect(output).toContain('[*] beta');
      expect(output).toContain('[ ] alpha');
      unmount();
    });

    it('marks bundled-only team with [+]', async () => {
      const { stream, getOutput } = makeStream();
      const props = makeProps({
        mergedTeams: ['alpha', 'bundled-only'],
        projectTeams: ['alpha'],
        activeTeam: 'alpha',
      });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      const output = getOutput();
      expect(output).toContain('[+] bundled-only');
      unmount();
    });

    it('shows Only one team configured when mergedTeams.length <= 1', async () => {
      const { stream, getOutput } = makeStream();
      const props = makeProps({ mergedTeams: ['solo'], projectTeams: ['solo'], activeTeam: 'solo' });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Only one team configured.');
      unmount();
    });

    it('shows Only one team configured when mergedTeams is empty', async () => {
      const { stream, getOutput } = makeStream();
      const props = makeProps({ mergedTeams: [], projectTeams: [], activeTeam: '' });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Only one team configured.');
      unmount();
    });
  });

  describe('navigation', () => {
    it('moves cursor down on downArrow', async () => {
      const { stream, getOutput } = makeStream();
      const props = makeProps();
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      const output = getOutput();
      expect(output).toContain('> ');
      expect(output).toContain('beta');
      unmount();
    });

    it('moves cursor up on upArrow after moving down', async () => {
      const { stream, getOutput } = makeStream();
      const props = makeProps();
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      triggerInput('', { upArrow: true });
      await tick();
      const output = getOutput();
      expect(output).toContain('> ');
      expect(output).toContain('alpha');
      unmount();
    });

    it('does not go below 0 on repeated upArrow', async () => {
      const { stream } = makeStream();
      const props = makeProps();
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { upArrow: true });
      triggerInput('', { upArrow: true });
      await tick();
      unmount();
      // No error thrown — cursor clamped at 0
    });
  });

  describe('Enter key — select team', () => {
    it('emits team:request-switch with the selected team', async () => {
      const props = makeProps();
      const { stream } = makeStream();
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      triggerInput('', { return: true });
      await tick(100);
      expect(eventBus.emit).toHaveBeenCalledWith('team:request-switch', { toTeam: 'beta' });
      unmount();
    });

    it('shows success message after switching team', async () => {
      const { stream, getOutput } = makeStream();
      const props = makeProps();
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      triggerInput('', { return: true });
      await tick(100);
      expect(getOutput()).toContain('Switching to beta...');
      unmount();
    });

    it('calls onComplete when any key pressed after success', async () => {
      const onComplete = vi.fn();
      const { stream } = makeStream();
      const props = makeProps({ onComplete });
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      triggerInput('', { downArrow: true });
      await tick();
      triggerInput('', { return: true });
      await tick(100);
      triggerInput('x');
      await tick();
      expect(onComplete).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('does not emit team:request-switch when pressing Enter on active team', async () => {
      const { stream } = makeStream();
      const props = makeProps();
      const { unmount } = render(React.createElement(SwitchTeamWizard, props), { stdout: stream });
      await tick();
      // cursor starts at 0 (alpha which is active)
      triggerInput('', { return: true });
      await tick();
      expect(eventBus.emit).not.toHaveBeenCalled();
      unmount();
    });
  });
});
