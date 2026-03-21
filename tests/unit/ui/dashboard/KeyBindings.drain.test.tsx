/**
 * Tests for KeyBindings drain keybinding (Story 24.3).
 * AC1: 'd' key routes to drain-confirm when isPipelineRunning=true,
 *      routes to diagnose when isPipelineRunning=false.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';

import { KeyBindings } from '@ui/dashboard/command-menu/KeyBindings.js';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

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

function makeBaseProps(overrides: Record<string, unknown> = {}) {
  return {
    onLoad: vi.fn(),
    onShip: vi.fn(),
    onToggleWorkers: vi.fn(),
    onToggleTrace: vi.fn(),
    onDiagnose: vi.fn(),
    onConfig: vi.fn(),
    onHelp: vi.fn(),
    focusModePanel: null,
    onEnterFocusMode: vi.fn(),
    onExitFocusMode: vi.fn(),
    onQuit: vi.fn(),
    onFocusNext: vi.fn(),
    onFocusPrev: vi.fn(),
    onFocusPanel: vi.fn(),
    isActive: true,
    ...overrides,
  };
}

describe('KeyBindings — drain keybinding (Story 24.3)', () => {
  let capturedCallback: ((input: string, key: typeof emptyKey) => void) | null;

  beforeEach(async () => {
    const ink = await import('ink');
    vi.mocked(ink.useInput).mockReset();
    capturedCallback = null;
    vi.mocked(ink.useInput).mockImplementation((cb) => {
      capturedCallback = cb as (input: string, key: typeof emptyKey) => void;
    });
  });

  // AC1a: pipeline running → 'd' opens drain-confirm
  describe('when isPipelineRunning=true', () => {
    it('calls onDrain when "d" is pressed and pipeline is running', () => {
      const onDrain = vi.fn();
      const onDiagnose = vi.fn();
      const r = render(
        React.createElement(KeyBindings, makeBaseProps({
          onDiagnose,
          onDrain,
          isPipelineRunning: true,
        })),
      );
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('d', { ...emptyKey });
      expect(onDrain).toHaveBeenCalledOnce();
      expect(onDiagnose).not.toHaveBeenCalled();
      r.unmount();
    });

    it('calls onDrain when "D" is pressed and pipeline is running', () => {
      const onDrain = vi.fn();
      const onDiagnose = vi.fn();
      const r = render(
        React.createElement(KeyBindings, makeBaseProps({
          onDiagnose,
          onDrain,
          isPipelineRunning: true,
        })),
      );
      capturedCallback!('D', { ...emptyKey });
      expect(onDrain).toHaveBeenCalledOnce();
      expect(onDiagnose).not.toHaveBeenCalled();
      r.unmount();
    });

    it('does not call onDrain when action is already active', () => {
      const onDrain = vi.fn();
      const r = render(
        React.createElement(KeyBindings, makeBaseProps({
          onDrain,
          isPipelineRunning: true,
          isActionActive: true,
        })),
      );
      capturedCallback!('d', { ...emptyKey });
      expect(onDrain).not.toHaveBeenCalled();
      r.unmount();
    });
  });

  // AC1b: pipeline stopped → 'd' falls through to onDiagnose (existing behaviour)
  describe('when isPipelineRunning=false', () => {
    it('calls onDiagnose when "d" is pressed and pipeline is stopped', () => {
      const onDrain = vi.fn();
      const onDiagnose = vi.fn();
      const r = render(
        React.createElement(KeyBindings, makeBaseProps({
          onDiagnose,
          onDrain,
          isPipelineRunning: false,
        })),
      );
      expect(capturedCallback).not.toBeNull();
      capturedCallback!('d', { ...emptyKey });
      expect(onDiagnose).toHaveBeenCalledOnce();
      expect(onDrain).not.toHaveBeenCalled();
      r.unmount();
    });

    it('calls onDiagnose when "D" is pressed and pipeline is stopped', () => {
      const onDrain = vi.fn();
      const onDiagnose = vi.fn();
      const r = render(
        React.createElement(KeyBindings, makeBaseProps({
          onDiagnose,
          onDrain,
          isPipelineRunning: false,
        })),
      );
      capturedCallback!('D', { ...emptyKey });
      expect(onDiagnose).toHaveBeenCalledOnce();
      expect(onDrain).not.toHaveBeenCalled();
      r.unmount();
    });

    it('calls onDiagnose when isPipelineRunning is not provided (undefined default)', () => {
      const onDrain = vi.fn();
      const onDiagnose = vi.fn();
      // No isPipelineRunning prop — should default to diagnose behaviour
      const r = render(
        React.createElement(KeyBindings, makeBaseProps({
          onDiagnose,
          onDrain,
        })),
      );
      capturedCallback!('d', { ...emptyKey });
      expect(onDiagnose).toHaveBeenCalledOnce();
      expect(onDrain).not.toHaveBeenCalled();
      r.unmount();
    });
  });

  // Edge case: pipelineState==='draining' — isPipelineRunning is derived as false
  // (only 'running' maps to isPipelineRunning=true), so 'd' → diagnose, not second drain
  describe('when isPipelineRunning=false (draining state guard)', () => {
    it('does NOT call onDrain when pipeline is draining (isPipelineRunning=false)', () => {
      const onDrain = vi.fn();
      const onDiagnose = vi.fn();
      // During draining state, DashboardApp derives isPipelineRunning = pipelineState === 'running' → false
      const r = render(
        React.createElement(KeyBindings, makeBaseProps({
          onDiagnose,
          onDrain,
          isPipelineRunning: false, // draining → isPipelineRunning = false
        })),
      );
      capturedCallback!('d', { ...emptyKey });
      expect(onDrain).not.toHaveBeenCalled();
      r.unmount();
    });
  });

  // AC5c: KeyBindings receives both onDrain and isPipelineRunning props
  describe('prop interface', () => {
    it('renders without error when onDrain and isPipelineRunning props are provided', () => {
      const r = render(
        React.createElement(KeyBindings, makeBaseProps({
          onDrain: vi.fn(),
          isPipelineRunning: true,
        })),
      );
      expect(r).toBeDefined();
      r.unmount();
    });

    it('renders without error when onDrain is omitted (optional prop)', () => {
      const r = render(
        React.createElement(KeyBindings, makeBaseProps({
          isPipelineRunning: false,
        })),
      );
      expect(r).toBeDefined();
      r.unmount();
    });
  });
});
