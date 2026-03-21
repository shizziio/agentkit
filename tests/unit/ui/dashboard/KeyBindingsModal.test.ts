import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { KeyBindings } from '@ui/dashboard/command-menu/KeyBindings';

type InputHandler = (input: string, key: Record<string, boolean>) => void;
let capturedHandler: InputHandler | undefined;

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn().mockImplementation((handler: InputHandler) => {
      capturedHandler = handler;
    }),
  };
});

function makeProps(overrides: Record<string, any> = {}) {
  return {
    onLoad: vi.fn(),
    onShip: vi.fn(),
    onToggleWorkers: vi.fn(),
    onToggleTrace: vi.fn(),
    onDiagnose: vi.fn(),
    onConfig: vi.fn(),
    onHelp: vi.fn(),
    onChat: vi.fn(),
    onQuit: vi.fn(),
    onFocusNext: vi.fn(),
    onFocusPrev: vi.fn(),
    onFocusPanel: vi.fn(),
    onEnterFocusMode: vi.fn(),
    onExitFocusMode: vi.fn(),
    onEnterTrace: vi.fn(),
    isActive: true,
    isActionActive: false,
    focusModePanel: null,
    ...overrides,
  };
}

describe('KeyBindings — hotkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = undefined;
  });

  function renderKeyBindings(props: any): any {
    return render(React.createElement(KeyBindings, props));
  }

  it('calls onLoad when l is pressed', () => {
    const props = makeProps();
    const result = renderKeyBindings(props);
    capturedHandler?.('l', {});
    expect(props.onLoad).toHaveBeenCalled();
    result.unmount();
  });

  it('calls onShip when s is pressed', () => {
    const props = makeProps();
    const result = renderKeyBindings(props);
    capturedHandler?.('s', {});
    expect(props.onShip).toHaveBeenCalled();
    result.unmount();
  });

  it('calls onDiagnose when d is pressed', () => {
    const props = makeProps();
    const result = renderKeyBindings(props);
    capturedHandler?.('d', {});
    expect(props.onDiagnose).toHaveBeenCalled();
    result.unmount();
  });

  it('calls onQuit when q is pressed', () => {
    const props = makeProps();
    const result = renderKeyBindings(props);
    capturedHandler?.('q', {});
    expect(props.onQuit).toHaveBeenCalled();
    result.unmount();
  });

  it('calls onFocusNext when Tab is pressed', () => {
    const props = makeProps();
    const result = renderKeyBindings(props);
    capturedHandler?.('', { tab: true });
    expect(props.onFocusNext).toHaveBeenCalled();
    result.unmount();
  });

  it('calls onEnterFocusMode when f is pressed and focusModePanel is null', () => {
    const props = makeProps(); // focusModePanel: null
    const result = renderKeyBindings(props);
    capturedHandler?.('f', {});
    expect(props.onEnterFocusMode).toHaveBeenCalled();
    result.unmount();
  });

  it('calls onExitFocusMode when f is pressed and focusModePanel is not null', () => {
    const props = makeProps({ focusModePanel: 1 });
    const result = renderKeyBindings(props);
    capturedHandler?.('f', {});
    expect(props.onExitFocusMode).toHaveBeenCalled();
    result.unmount();
  });

  it('does NOT fire hotkeys when isActionActive is true (except Q)', async () => {
    const props = makeProps({ isActionActive: true });
    const result = renderKeyBindings(props);
    capturedHandler?.('l', {});
    expect(props.onLoad).not.toHaveBeenCalled();
    
    // Bypass debounce
    await new Promise(resolve => setTimeout(resolve, 200));

    // Q should still work (it routes to menuStack.handleQ)
    capturedHandler?.('q', {});
    expect(props.onQuit).toHaveBeenCalled();
    result.unmount();
  });
});
