import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';
import { useMenuStack, UseMenuStack, UseMenuStackProps } from '@ui/dashboard/hooks/useMenuStack.js';

function makeHookCapture() {
  let captured: UseMenuStack | null = null;

  function HookCapture({ onQuit, activeAction, clearActiveAction }: UseMenuStackProps) {
    captured = useMenuStack({ onQuit, activeAction, clearActiveAction });
    return null;
  }

  return {
    get captured() { return captured; },
    HookCapture,
  };
}

describe('useMenuStack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with main level', () => {
    const hook = makeHookCapture();
    render(<hook.HookCapture onQuit={vi.fn()} activeAction={null} clearActiveAction={vi.fn()} />);
    expect(hook.captured?.currentLevel).toBe('main');
    expect(hook.captured?.stack).toEqual(['main']);
  });

  it('should push and pop levels', () => {
    const hook = makeHookCapture();
    const { rerender } = render(<hook.HookCapture onQuit={vi.fn()} activeAction={null} clearActiveAction={vi.fn()} />);

    hook.captured?.push('config');
    rerender(<hook.HookCapture onQuit={vi.fn()} activeAction={null} clearActiveAction={vi.fn()} />);
    expect(hook.captured?.currentLevel).toBe('config');
    expect(hook.captured?.stack).toEqual(['main', 'config']);

    hook.captured?.pop();
    rerender(<hook.HookCapture onQuit={vi.fn()} activeAction={null} clearActiveAction={vi.fn()} />);
    expect(hook.captured?.currentLevel).toBe('main');
    expect(hook.captured?.stack).toEqual(['main']);
  });

  it('should handle handleQ for active action', () => {
    const hook = makeHookCapture();
    const clearActiveAction = vi.fn();
    render(<hook.HookCapture onQuit={vi.fn()} activeAction="load" clearActiveAction={clearActiveAction} />);

    hook.captured?.handleQ();
    expect(clearActiveAction).toHaveBeenCalled();
  });

  it('should handle handleQ for nested level', () => {
    const hook = makeHookCapture();
    const { rerender } = render(<hook.HookCapture onQuit={vi.fn()} activeAction={null} clearActiveAction={vi.fn()} />);

    hook.captured?.push('config');
    rerender(<hook.HookCapture onQuit={vi.fn()} activeAction={null} clearActiveAction={vi.fn()} />);

    hook.captured?.handleQ();
    rerender(<hook.HookCapture onQuit={vi.fn()} activeAction={null} clearActiveAction={vi.fn()} />);
    expect(hook.captured?.currentLevel).toBe('main');
  });

  it('should call onQuit when handleQ is called at top level', () => {
    const hook = makeHookCapture();
    const onQuit = vi.fn();
    render(<hook.HookCapture onQuit={onQuit} activeAction={null} clearActiveAction={vi.fn()} />);

    hook.captured?.handleQ();
    expect(onQuit).toHaveBeenCalled();
  });
});
