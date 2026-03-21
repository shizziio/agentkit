import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

import { QuitConfirmPanel } from '@ui/dashboard/modals/QuitConfirmPanel';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

function makeStream(): { stream: NodeJS.WriteStream & { columns: number }; getOutput: () => string } {
  const stream = new PassThrough() as unknown as NodeJS.WritableStream & { columns: number };
  (stream as unknown as PassThrough).setEncoding('utf8');
  stream.columns = 80;
  let output = '';
  (stream as unknown as PassThrough).on('data', (chunk: string) => {
    output += chunk;
  });
  const stripAnsi = (str: string): string =>
    str.replace(/\x1B\[[0-9;]*[mGKHJF]/g, '').replace(/\x1B[()][A-Z]/g, '');
  return { stream: stream as unknown as NodeJS.WriteStream & { columns: number }, getOutput: () => stripAnsi(output) };
}

const tick = (ms = 30): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

const emptyKey = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  insert: false,
  meta: false,
  f1: false, f2: false, f3: false, f4: false, f5: false,
  f6: false, f7: false, f8: false, f9: false, f10: false,
  f11: false, f12: false,
};

describe('QuitConfirmPanel', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const ink = await import('ink');
    vi.mocked(ink.useInput).mockReset();
    onConfirm = vi.fn();
    onCancel = vi.fn();
  });

  describe('rendering', () => {
    it('renders "Quit AgentKit?" prompt text', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(QuitConfirmPanel, { onConfirm, onCancel }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('Quit AgentKit?');
      r.unmount();
    });

    it('renders "[Y] Confirm  [Esc] Cancel" hint text', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(QuitConfirmPanel, { onConfirm, onCancel }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toContain('[Y] Confirm');
      expect(output).toContain('[Esc] Cancel');
      r.unmount();
    });

    it('renders without crashing', () => {
      const r = render(React.createElement(QuitConfirmPanel, { onConfirm, onCancel }));
      expect(r).toBeDefined();
      r.unmount();
    });
  });

  describe('keyboard input — Y confirms', () => {
    it('calls onConfirm when "y" is pressed', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(QuitConfirmPanel, { onConfirm, onCancel }));
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('y', { ...emptyKey });
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onCancel).not.toHaveBeenCalled();
      r.unmount();
    });

    it('calls onConfirm when "Y" is pressed', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(QuitConfirmPanel, { onConfirm, onCancel }));
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('Y', { ...emptyKey });
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onCancel).not.toHaveBeenCalled();
      r.unmount();
    });
  });

  describe('keyboard input — Esc cancels', () => {
    it('calls onCancel when Esc is pressed', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(QuitConfirmPanel, { onConfirm, onCancel }));
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('', { ...emptyKey, escape: true });
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
      r.unmount();
    });
  });

  describe('edge cases', () => {
    it('does not call either callback when "n" is pressed', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(QuitConfirmPanel, { onConfirm, onCancel }));
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('n', { ...emptyKey });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      r.unmount();
    });

    it('does not call either callback when "N" is pressed', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(QuitConfirmPanel, { onConfirm, onCancel }));
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('N', { ...emptyKey });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      r.unmount();
    });

    it('does not crash on unrecognized keys', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(QuitConfirmPanel, { onConfirm, onCancel }));
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('x', { ...emptyKey });
      capturedCallback!('q', { ...emptyKey });
      capturedCallback!(' ', { ...emptyKey });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      r.unmount();
    });
  });
});
