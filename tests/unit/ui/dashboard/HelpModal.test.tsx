import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import { HelpModal } from '@ui/dashboard/modals/HelpModal';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return { ...actual, useInput: vi.fn() };
});

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 80;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => { output += chunk; });
  const stripAnsi = (s: string): string =>
    s.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('HelpModal', () => {
  describe('renders all expected keyboard shortcuts', () => {
    it('shows "Keyboard Shortcuts" title', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Keyboard Shortcuts');
      result.unmount();
    });

    it('shows L — Load stories', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      const out = getOutput();
      expect(out).toContain('L');
      expect(out).toContain('Load stories');
      result.unmount();
    });

    it('shows S — Ship stories to pipeline', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Ship stories to pipeline');
      result.unmount();
    });

    it('shows R — Run workers', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Run workers');
      result.unmount();
    });

    it('shows T — Trace mode', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Trace mode');
      result.unmount();
    });

    it('shows D — Diagnose pipeline', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Diagnose pipeline');
      result.unmount();
    });

    it('shows C — Configuration', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Configuration');
      result.unmount();
    });

    it('shows H — This help screen', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('help screen');
      result.unmount();
    });

    it('shows Q — Back / Close Action / Quit', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Back / Close Action / Quit');
      result.unmount();
    });

    it('shows Tab — Cycle panel focus', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('Cycle panel focus');
      result.unmount();
    });

    it('shows 1-4 — Jump to panel', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('1-4');
      expect(getOutput()).toContain('Jump to panel');
      result.unmount();
    });
  });

  describe('does NOT include removed keybindings', () => {
    it('does NOT show P keybinding', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).not.toContain('Pause workers');
      result.unmount();
    });
  });

  describe('footer and close hint', () => {
    it('shows [Q] Back / Close footer', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(React.createElement(HelpModal, { onClose: vi.fn() }), { stdout: stream });
      await tick();
      expect(getOutput()).toContain('[Q] Back / Close');
      result.unmount();
    });
  });

  describe('compact mode', () => {
    it('renders in compact mode without crashing', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(HelpModal, { onClose: vi.fn(), compact: true }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toContain('Keyboard Shortcuts');
      result.unmount();
    });

    it('still shows all shortcuts in compact mode', async () => {
      const { stream, getOutput } = makeStream();
      const result = render(
        React.createElement(HelpModal, { onClose: vi.fn(), compact: true }),
        { stdout: stream },
      );
      await tick();
      const out = getOutput();
      expect(out).toContain('Load stories');
      expect(out).toContain('Back / Close Action / Quit');
      expect(out).not.toContain('Pause workers');
      result.unmount();
    });
  });
});
