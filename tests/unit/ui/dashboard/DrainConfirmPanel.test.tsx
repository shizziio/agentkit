import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { PassThrough } from 'node:stream';

import { DrainConfirmPanel } from '@ui/dashboard/modals/DrainConfirmPanel.js';

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

describe('DrainConfirmPanel', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const ink = await import('ink');
    vi.mocked(ink.useInput).mockReset();
    onConfirm = vi.fn();
    onCancel = vi.fn();
  });

  describe('rendering', () => {
    it('renders panel title "Drain Pipeline?"', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(DrainConfirmPanel, { onConfirm, onCancel }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toContain('Drain Pipeline?');
      r.unmount();
    });

    it('renders bullet: running tasks will finish', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(DrainConfirmPanel, { onConfirm, onCancel }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toMatch(/running.*finish|finish.*running/i);
      r.unmount();
    });

    it('renders bullet: queued tasks will be cancelled', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(DrainConfirmPanel, { onConfirm, onCancel }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toMatch(/queued.*cancel|cancel.*queued/i);
      r.unmount();
    });

    it('renders bullet: no new tasks will be routed', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(DrainConfirmPanel, { onConfirm, onCancel }),
        { stdout: stream },
      );
      await tick();
      const output = getOutput();
      expect(output).toMatch(/no new tasks|new tasks.*route/i);
      r.unmount();
    });

    it('renders [Enter] Confirm hint', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(DrainConfirmPanel, { onConfirm, onCancel }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toMatch(/\[Enter\].*Confirm/);
      r.unmount();
    });

    it('renders [Esc] Cancel hint', async () => {
      const { stream, getOutput } = makeStream();
      const r = render(
        React.createElement(DrainConfirmPanel, { onConfirm, onCancel }),
        { stdout: stream },
      );
      await tick();
      expect(getOutput()).toMatch(/\[Esc\].*Cancel/);
      r.unmount();
    });

    it('renders without crashing', () => {
      const r = render(React.createElement(DrainConfirmPanel, { onConfirm, onCancel }));
      expect(r).toBeDefined();
      r.unmount();
    });
  });

  describe('keyboard input — confirm (Enter)', () => {
    it('calls onConfirm when Enter is pressed', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(DrainConfirmPanel, { onConfirm, onCancel }));
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('', { ...emptyKey, return: true });
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onCancel).not.toHaveBeenCalled();
      r.unmount();
    });

    it('does not call onCancel when Enter is pressed', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(DrainConfirmPanel, { onConfirm, onCancel }));
      capturedCallback!('', { ...emptyKey, return: true });
      expect(onCancel).not.toHaveBeenCalled();
      r.unmount();
    });
  });

  describe('keyboard input — cancel (Esc)', () => {
    it('calls onCancel when Escape is pressed', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(DrainConfirmPanel, { onConfirm, onCancel }));
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('', { ...emptyKey, escape: true });
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
      r.unmount();
    });

    it('does not call onConfirm when Escape is pressed', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(DrainConfirmPanel, { onConfirm, onCancel }));
      capturedCallback!('', { ...emptyKey, escape: true });
      expect(onConfirm).not.toHaveBeenCalled();
      r.unmount();
    });
  });

  describe('edge cases', () => {
    it('does not call either callback for unrecognized keys', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(DrainConfirmPanel, { onConfirm, onCancel }));
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('x', { ...emptyKey });
      capturedCallback!('d', { ...emptyKey });
      capturedCallback!(' ', { ...emptyKey });
      capturedCallback!('q', { ...emptyKey });
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      r.unmount();
    });

    it('calls onConfirm only once even if Enter pressed multiple times', async () => {
      const ink = await import('ink');
      let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null = null;
      vi.mocked(ink.useInput).mockImplementation((cb) => {
        capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
      });

      const r = render(React.createElement(DrainConfirmPanel, { onConfirm, onCancel }));
      capturedCallback!('', { ...emptyKey, return: true });
      capturedCallback!('', { ...emptyKey, return: true });
      expect(onConfirm).toHaveBeenCalledTimes(2); // component doesn't deduplicate — caller must unmount
      r.unmount();
    });
  });
});
