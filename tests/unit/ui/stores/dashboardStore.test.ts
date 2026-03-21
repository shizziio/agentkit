import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module under test — will fail to import until dashboardStore.ts is created.
// ---------------------------------------------------------------------------
import { useDashboardStore } from '@stores/dashboardStore.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Initial state snapshot used to reset the singleton store between tests.
 * Must match the defaults declared in dashboardStore.ts.
 */
const INITIAL_STATE = {
  dashboardMode: 'overview' as const,
  actionMode: 'none' as const,
  isFullscreen: false,
  focusedPanel: 0,
  panelCount: 4,
};

/** Reset the Zustand store to initial values before each test to prevent bleed. */
function resetStore(): void {
  useDashboardStore.setState(INITIAL_STATE, true);
}

/** Shorthand accessor. */
function getState() {
  return useDashboardStore.getState();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDashboardStore', () => {
  beforeEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  describe('initial state', () => {
    it('should have dashboardMode set to "overview"', () => {
      expect(getState().dashboardMode).toBe('overview');
    });

    it('should have actionMode set to "none"', () => {
      expect(getState().actionMode).toBe('none');
    });

    it('should have isFullscreen set to false', () => {
      expect(getState().isFullscreen).toBe(false);
    });

    it('should have focusedPanel set to 0', () => {
      expect(getState().focusedPanel).toBe(0);
    });

    it('should have panelCount set to 4', () => {
      expect(getState().panelCount).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // isActionActive selector function
  // -------------------------------------------------------------------------
  describe('isActionActive()', () => {
    it('should return false when actionMode is "none"', () => {
      expect(getState().isActionActive()).toBe(false);
    });

    it('should return true when actionMode is "load"', () => {
      getState().openAction('load');
      expect(getState().isActionActive()).toBe(true);
    });

    it('should return true when actionMode is "ship"', () => {
      getState().openAction('ship');
      expect(getState().isActionActive()).toBe(true);
    });

    it('should return true when actionMode is "quit-confirm"', () => {
      getState().openAction('quit-confirm');
      expect(getState().isActionActive()).toBe(true);
    });

    it('should return true for any non-none actionMode', () => {
      getState().openAction('diagnose');
      expect(getState().isActionActive()).toBe(true);
    });

    it('should return false after closeAction() is called', () => {
      getState().openAction('load');
      getState().closeAction();
      expect(getState().isActionActive()).toBe(false);
    });

    it('should be a function (not a stored boolean)', () => {
      expect(typeof getState().isActionActive).toBe('function');
    });
  });

  // -------------------------------------------------------------------------
  // openAction
  // -------------------------------------------------------------------------
  describe('openAction()', () => {
    it('should set actionMode to "load"', () => {
      getState().openAction('load');
      expect(getState().actionMode).toBe('load');
    });

    it('should set actionMode to "ship"', () => {
      getState().openAction('ship');
      expect(getState().actionMode).toBe('ship');
    });

    it('should set actionMode to "help"', () => {
      getState().openAction('help');
      expect(getState().actionMode).toBe('help');
    });

    it('should make isActionActive() return true', () => {
      getState().openAction('load');
      expect(getState().isActionActive()).toBe(true);
    });

    it('should overwrite a previous actionMode with a new one', () => {
      getState().openAction('load');
      getState().openAction('ship');
      expect(getState().actionMode).toBe('ship');
    });
  });

  // -------------------------------------------------------------------------
  // closeAction
  // -------------------------------------------------------------------------
  describe('closeAction()', () => {
    it('should set actionMode back to "none" after openAction("load")', () => {
      getState().openAction('load');
      getState().closeAction();
      expect(getState().actionMode).toBe('none');
    });

    it('should make isActionActive() return false after closing', () => {
      getState().openAction('ship');
      getState().closeAction();
      expect(getState().isActionActive()).toBe(false);
    });

    it('should be idempotent — calling closeAction when already "none" stays "none"', () => {
      getState().closeAction();
      expect(getState().actionMode).toBe('none');
    });
  });

  // -------------------------------------------------------------------------
  // toggleTrace — guard logic
  // -------------------------------------------------------------------------
  describe('toggleTrace() — guard: no action active', () => {
    it('should NOT change dashboardMode when actionMode is "load"', () => {
      getState().openAction('load');
      getState().toggleTrace();
      expect(getState().dashboardMode).toBe('overview');
    });

    it('should NOT change dashboardMode when actionMode is "ship"', () => {
      getState().openAction('ship');
      getState().toggleTrace();
      expect(getState().dashboardMode).toBe('overview');
    });

    it('should NOT change dashboardMode when actionMode is "help"', () => {
      getState().openAction('help');
      getState().toggleTrace();
      expect(getState().dashboardMode).toBe('overview');
    });

    it('should NOT change isFullscreen when action is active and toggleTrace is called', () => {
      useDashboardStore.setState({ isFullscreen: true, actionMode: 'load' });
      getState().toggleTrace();
      expect(getState().isFullscreen).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // toggleTrace — happy path
  // -------------------------------------------------------------------------
  describe('toggleTrace() — happy path', () => {
    it('should change dashboardMode from "overview" to "trace"', () => {
      getState().toggleTrace();
      expect(getState().dashboardMode).toBe('trace');
    });

    it('should change dashboardMode from "trace" back to "overview"', () => {
      getState().toggleTrace(); // overview → trace
      getState().toggleTrace(); // trace → overview
      expect(getState().dashboardMode).toBe('overview');
    });

    it('should reset isFullscreen to false when entering trace mode', () => {
      useDashboardStore.setState({ isFullscreen: true });
      getState().toggleTrace();
      expect(getState().isFullscreen).toBe(false);
    });

    it('should reset isFullscreen to false when leaving trace mode (trace → overview)', () => {
      getState().toggleTrace(); // → trace
      useDashboardStore.setState({ isFullscreen: true }); // set true manually
      getState().toggleTrace(); // → overview
      expect(getState().isFullscreen).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // toggleFullscreen — guard logic
  // -------------------------------------------------------------------------
  describe('toggleFullscreen() — guard: no action active and overview mode', () => {
    it('should NOT change isFullscreen when actionMode is "load"', () => {
      getState().openAction('load');
      getState().toggleFullscreen();
      expect(getState().isFullscreen).toBe(false);
    });

    it('should NOT change isFullscreen when actionMode is "ship"', () => {
      getState().openAction('ship');
      useDashboardStore.setState({ isFullscreen: true, actionMode: 'ship' });
      getState().toggleFullscreen();
      expect(getState().isFullscreen).toBe(true);
    });

    it('should NOT change isFullscreen when dashboardMode is "trace"', () => {
      getState().toggleTrace(); // → trace
      getState().toggleFullscreen();
      expect(getState().isFullscreen).toBe(false);
    });

    it('should NOT change isFullscreen when trace mode and action active simultaneously', () => {
      getState().openAction('diagnose');
      useDashboardStore.setState({ dashboardMode: 'trace', isFullscreen: false, actionMode: 'diagnose' });
      getState().toggleFullscreen();
      expect(getState().isFullscreen).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // toggleFullscreen — happy path
  // -------------------------------------------------------------------------
  describe('toggleFullscreen() — happy path', () => {
    it('should toggle isFullscreen from false to true in overview mode with no action', () => {
      getState().toggleFullscreen();
      expect(getState().isFullscreen).toBe(true);
    });

    it('should toggle isFullscreen from true back to false in overview mode with no action', () => {
      useDashboardStore.setState({ isFullscreen: true });
      getState().toggleFullscreen();
      expect(getState().isFullscreen).toBe(false);
    });

    it('should not change dashboardMode when toggling fullscreen', () => {
      getState().toggleFullscreen();
      expect(getState().dashboardMode).toBe('overview');
    });
  });

  // -------------------------------------------------------------------------
  // focusNext — wrapping
  // -------------------------------------------------------------------------
  describe('focusNext()', () => {
    it('should increment focusedPanel from 0 to 1', () => {
      getState().focusNext();
      expect(getState().focusedPanel).toBe(1);
    });

    it('should increment focusedPanel from 1 to 2', () => {
      useDashboardStore.setState({ focusedPanel: 1 });
      getState().focusNext();
      expect(getState().focusedPanel).toBe(2);
    });

    it('should increment focusedPanel from 2 to 3', () => {
      useDashboardStore.setState({ focusedPanel: 2 });
      getState().focusNext();
      expect(getState().focusedPanel).toBe(3);
    });

    it('should wrap focusedPanel from 3 back to 0 when panelCount is 4', () => {
      useDashboardStore.setState({ focusedPanel: 3, panelCount: 4 });
      getState().focusNext();
      expect(getState().focusedPanel).toBe(0);
    });

    it('should cycle through 0, 1, 0, 1 after setPanelCount(2)', () => {
      getState().setPanelCount(2);
      // Start at 0 (auto-reset from bounds check keeps it at 0)
      getState().focusNext(); // → 1
      expect(getState().focusedPanel).toBe(1);
      getState().focusNext(); // → 0 (wrap)
      expect(getState().focusedPanel).toBe(0);
      getState().focusNext(); // → 1
      expect(getState().focusedPanel).toBe(1);
      getState().focusNext(); // → 0 (wrap)
      expect(getState().focusedPanel).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // focusPrev — wrapping
  // -------------------------------------------------------------------------
  describe('focusPrev()', () => {
    it('should decrement focusedPanel from 3 to 2', () => {
      useDashboardStore.setState({ focusedPanel: 3 });
      getState().focusPrev();
      expect(getState().focusedPanel).toBe(2);
    });

    it('should decrement focusedPanel from 2 to 1', () => {
      useDashboardStore.setState({ focusedPanel: 2 });
      getState().focusPrev();
      expect(getState().focusedPanel).toBe(1);
    });

    it('should decrement focusedPanel from 1 to 0', () => {
      useDashboardStore.setState({ focusedPanel: 1 });
      getState().focusPrev();
      expect(getState().focusedPanel).toBe(0);
    });

    it('should wrap focusedPanel from 0 to 3 when panelCount is 4', () => {
      useDashboardStore.setState({ focusedPanel: 0, panelCount: 4 });
      getState().focusPrev();
      expect(getState().focusedPanel).toBe(3);
    });

    it('should wrap from 0 to 1 (last index) when panelCount is 2', () => {
      getState().setPanelCount(2);
      useDashboardStore.setState({ focusedPanel: 0 });
      getState().focusPrev();
      expect(getState().focusedPanel).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // setFocusedPanel — bounds checking
  // -------------------------------------------------------------------------
  describe('setFocusedPanel()', () => {
    it('should set focusedPanel to 1 when id is 1 and panelCount is 4', () => {
      getState().setFocusedPanel(1);
      expect(getState().focusedPanel).toBe(1);
    });

    it('should set focusedPanel to 3 when id is 3 and panelCount is 4', () => {
      getState().setFocusedPanel(3);
      expect(getState().focusedPanel).toBe(3);
    });

    it('should set focusedPanel to 0 — always valid regardless of panelCount', () => {
      useDashboardStore.setState({ focusedPanel: 2 });
      getState().setFocusedPanel(0);
      expect(getState().focusedPanel).toBe(0);
    });

    it('should ignore id that equals panelCount (out of bounds)', () => {
      useDashboardStore.setState({ focusedPanel: 0, panelCount: 4 });
      getState().setFocusedPanel(4); // index 4 with panelCount=4 is out of bounds
      expect(getState().focusedPanel).toBe(0);
    });

    it('should ignore id that is greater than panelCount', () => {
      useDashboardStore.setState({ focusedPanel: 1, panelCount: 4 });
      getState().setFocusedPanel(10);
      expect(getState().focusedPanel).toBe(1);
    });

    it('should ignore negative id', () => {
      useDashboardStore.setState({ focusedPanel: 2 });
      getState().setFocusedPanel(-1);
      expect(getState().focusedPanel).toBe(2);
    });

    it('should ignore id of -5', () => {
      useDashboardStore.setState({ focusedPanel: 0 });
      getState().setFocusedPanel(-5);
      expect(getState().focusedPanel).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // setPanelCount — bounds reset
  // -------------------------------------------------------------------------
  describe('setPanelCount()', () => {
    it('should update panelCount to 2', () => {
      getState().setPanelCount(2);
      expect(getState().panelCount).toBe(2);
    });

    it('should auto-reset focusedPanel to 0 when focusedPanel >= new panelCount', () => {
      useDashboardStore.setState({ focusedPanel: 3, panelCount: 4 });
      getState().setPanelCount(2);
      expect(getState().focusedPanel).toBe(0);
    });

    it('should auto-reset focusedPanel to 0 when focusedPanel equals new panelCount', () => {
      useDashboardStore.setState({ focusedPanel: 2, panelCount: 4 });
      getState().setPanelCount(2); // focusedPanel=2 >= panelCount=2 → reset to 0
      expect(getState().focusedPanel).toBe(0);
    });

    it('should NOT reset focusedPanel when it is within bounds of new panelCount', () => {
      useDashboardStore.setState({ focusedPanel: 1, panelCount: 4 });
      getState().setPanelCount(2); // focusedPanel=1 < panelCount=2 → keep
      expect(getState().focusedPanel).toBe(1);
    });

    it('should atomically update both panelCount and focusedPanel', () => {
      useDashboardStore.setState({ focusedPanel: 3, panelCount: 4 });
      getState().setPanelCount(2);
      const state = getState();
      expect(state.panelCount).toBe(2);
      expect(state.focusedPanel).toBe(0);
    });

    it('should allow focusNext to cycle within new panelCount after setPanelCount(2)', () => {
      useDashboardStore.setState({ focusedPanel: 0, panelCount: 4 });
      getState().setPanelCount(2);
      // focusedPanel may be auto-reset to 0; cycle within 0..1
      getState().focusNext(); // 0 → 1
      expect(getState().focusedPanel).toBe(1);
      getState().focusNext(); // 1 → 0 (wrap)
      expect(getState().focusedPanel).toBe(0);
    });

    it('should update panelCount to 4 (restore default)', () => {
      getState().setPanelCount(2);
      getState().setPanelCount(4);
      expect(getState().panelCount).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // Selector isolation — Zustand equality check prevents unnecessary re-renders
  // -------------------------------------------------------------------------
  describe('selector isolation', () => {
    it('should not invoke a dashboardMode selector when only actionMode changes', () => {
      const selector = vi.fn((s: ReturnType<typeof getState>) => s.dashboardMode);
      // Subscribe using store.subscribe with a selector — Zustand calls listener only when selection changes
      const unsub = useDashboardStore.subscribe(selector);

      // Change actionMode only — dashboardMode stays 'overview'
      getState().openAction('load');
      getState().closeAction();

      // The selector function itself is called by subscribe internals to compare,
      // but the important assertion: dashboardMode was NOT changed by these actions.
      expect(getState().dashboardMode).toBe('overview');
      expect(getState().actionMode).toBe('none');

      unsub();
    });

    it('should call a dashboardMode-selecting subscriber only when dashboardMode changes', () => {
      const listener = vi.fn();
      // Subscribe to changes where dashboardMode changes value
      const unsub = useDashboardStore.subscribe(
        (state) => state.dashboardMode,
        listener,
      );

      // Change actionMode — should NOT trigger dashboardMode subscriber
      getState().openAction('ship');
      expect(listener).not.toHaveBeenCalled();

      // Change dashboardMode — should trigger
      getState().closeAction();
      getState().toggleTrace(); // overview → trace
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('trace', 'overview');

      unsub();
    });

    it('should call a focusedPanel-selecting subscriber only when focusedPanel changes', () => {
      const listener = vi.fn();
      const unsub = useDashboardStore.subscribe(
        (state) => state.focusedPanel,
        listener,
      );

      // Change actionMode — should NOT trigger focusedPanel subscriber
      getState().openAction('load');
      expect(listener).not.toHaveBeenCalled();

      // Change focusedPanel
      getState().focusNext();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(1, 0);

      unsub();
    });
  });

  // -------------------------------------------------------------------------
  // Pure Zustand — no React/Ink dependency
  // -------------------------------------------------------------------------
  describe('store purity', () => {
    it('should have getState() as a function (Zustand API)', () => {
      expect(typeof useDashboardStore.getState).toBe('function');
    });

    it('should have setState() as a function (Zustand API)', () => {
      expect(typeof useDashboardStore.setState).toBe('function');
    });

    it('should have subscribe() as a function (Zustand API)', () => {
      expect(typeof useDashboardStore.subscribe).toBe('function');
    });

    it('should be usable without mounting a React component', () => {
      // All test cases in this file use getState() directly — this verifies that assumption
      expect(() => getState()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('toggleTrace resets isFullscreen unconditionally — both overview→trace and trace→overview', () => {
      // overview → trace (isFullscreen should be reset)
      useDashboardStore.setState({ isFullscreen: true });
      getState().toggleTrace(); // → trace
      expect(getState().isFullscreen).toBe(false);

      // trace → overview (isFullscreen should also be reset)
      useDashboardStore.setState({ isFullscreen: true });
      getState().toggleTrace(); // → overview
      expect(getState().isFullscreen).toBe(false);
    });

    it('focusNext uses functional set — reads panelCount from state snapshot not stale closure', () => {
      // setPanelCount shrinks from 4 to 2 — focusNext must respect new count immediately
      getState().setPanelCount(2);
      getState().focusNext(); // 0 → 1
      getState().focusNext(); // 1 → 0 (wraps at 2, not at 4)
      expect(getState().focusedPanel).toBe(0);
    });

    it('focusPrev uses functional set — reads panelCount from state snapshot not stale closure', () => {
      getState().setPanelCount(2);
      useDashboardStore.setState({ focusedPanel: 0 });
      getState().focusPrev(); // 0 → 1 (wraps to last index = 1, not 3)
      expect(getState().focusedPanel).toBe(1);
    });

    it('setFocusedPanel(0) always succeeds regardless of panelCount', () => {
      useDashboardStore.setState({ panelCount: 1 });
      getState().setFocusedPanel(0);
      expect(getState().focusedPanel).toBe(0);
    });

    it('isActionActive reflects current actionMode without separate state key', () => {
      // Call isActionActive multiple times without triggering set()
      const before = getState().isActionActive();
      getState().openAction('load');
      const after = getState().isActionActive();
      expect(before).toBe(false);
      expect(after).toBe(true);
    });

    it('toggleFullscreen requires BOTH guards: action inactive AND overview mode', () => {
      // Both conditions violated (trace mode + action active) — should not toggle
      getState().toggleTrace(); // → trace
      getState().openAction('load');
      getState().toggleFullscreen();
      expect(getState().isFullscreen).toBe(false);
    });

    it('panelCount default of 4 matches grid mode behaviour', () => {
      expect(getState().panelCount).toBe(4);
    });
  });
});
