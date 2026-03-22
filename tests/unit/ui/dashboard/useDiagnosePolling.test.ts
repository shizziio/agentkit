import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink';

import { EventBus } from '@core/EventBus';
import type { DiagnoseResultEvent } from '@core/EventTypes';
import type { DiagnoseResult } from '@core/DiagnoseTypes';
import { useDiagnosePolling } from '@ui/dashboard/hooks/useDiagnosePolling';
import type { UseDiagnosePollingResult } from '@ui/dashboard/hooks/useDiagnosePolling';

let capturedResult: UseDiagnosePollingResult;
let testEventBus: EventBus;

function HookCapture(): React.ReactElement | null {
  capturedResult = useDiagnosePolling(testEventBus);
  return null;
}

const tick = (ms = 50): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function makeResult(overrides?: Partial<DiagnoseResult>): DiagnoseResult {
  return {
    issues: [],
    summary: { stuckCount: 0, orphanedCount: 0, queueGapCount: 0, loopBlockedCount: 0 },
    ...overrides,
  };
}

function emit(eventBus: EventBus, payload: DiagnoseResultEvent): void {
  eventBus.emit('diagnose:result', payload);
}

describe('useDiagnosePolling', () => {
  beforeEach(() => {
    testEventBus = new EventBus();
    capturedResult = undefined as unknown as UseDiagnosePollingResult;
  });

  function renderHook(): ReturnType<typeof render> {
    return render(React.createElement(HookCapture));
  }

  describe('initial state', () => {
    it('returns null lastResult before any event', async () => {
      const result = renderHook();
      await tick();
      expect(capturedResult.lastResult).toBeNull();
      result.unmount();
    });

    it('returns null lastPollAt before any event', async () => {
      const result = renderHook();
      await tick();
      expect(capturedResult.lastPollAt).toBeNull();
      result.unmount();
    });

    it('returns nextPollIn=0 before any event', async () => {
      const result = renderHook();
      await tick();
      expect(capturedResult.nextPollIn).toBe(0);
      result.unmount();
    });

    it('returns isPolling=false before any event', async () => {
      const result = renderHook();
      await tick();
      expect(capturedResult.isPolling).toBe(false);
      result.unmount();
    });

    it('returns pollError=null before any event', async () => {
      const result = renderHook();
      await tick();
      expect(capturedResult.pollError).toBeNull();
      result.unmount();
    });
  });

  describe('on diagnose:result event', () => {
    it('sets lastResult from event payload', async () => {
      const result = renderHook();
      await tick();
      const diagnoseResult = makeResult({
        summary: { stuckCount: 1, orphanedCount: 0, queueGapCount: 0, loopBlockedCount: 0 },
      });

      emit(testEventBus, { result: diagnoseResult, timestamp: new Date().toISOString() });
      await tick();

      expect(capturedResult.lastResult).toEqual(diagnoseResult);
      result.unmount();
    });

    it('sets isPolling=true after first event', async () => {
      const result = renderHook();
      await tick();

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await tick();

      expect(capturedResult.isPolling).toBe(true);
      result.unmount();
    });

    it('sets nextPollIn=30 after receiving event', async () => {
      const result = renderHook();
      await tick();

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await tick();

      expect(capturedResult.nextPollIn).toBe(30);
      result.unmount();
    });

    it('sets lastPollAt to a recent timestamp after event', async () => {
      const result = renderHook();
      await tick();
      const before = Date.now();

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await tick();

      const after = Date.now();
      expect(capturedResult.lastPollAt).not.toBeNull();
      expect(capturedResult.lastPollAt!).toBeGreaterThanOrEqual(before);
      expect(capturedResult.lastPollAt!).toBeLessThanOrEqual(after);
      result.unmount();
    });

    it('sets pollError=null when event has no error field', async () => {
      const result = renderHook();
      await tick();

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await tick();

      expect(capturedResult.pollError).toBeNull();
      result.unmount();
    });

    it('sets pollError from event.error field when present', async () => {
      const result = renderHook();
      await tick();

      emit(testEventBus, {
        result: makeResult(),
        timestamp: new Date().toISOString(),
        error: 'Error: DB locked',
      });
      await tick();

      expect(capturedResult.pollError).toBe('Error: DB locked');
      result.unmount();
    });

    it('resets pollError to null on successful subsequent event', async () => {
      const result = renderHook();
      await tick();

      emit(testEventBus, {
        result: makeResult(),
        timestamp: new Date().toISOString(),
        error: 'Some error',
      });
      await tick();
      expect(capturedResult.pollError).toBe('Some error');

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await tick();

      expect(capturedResult.pollError).toBeNull();
      result.unmount();
    });

    it('updates lastResult on subsequent events', async () => {
      const result = renderHook();
      await tick();
      const firstResult = makeResult({ summary: { stuckCount: 1, orphanedCount: 0, queueGapCount: 0, loopBlockedCount: 0 } });
      const secondResult = makeResult({ summary: { stuckCount: 0, orphanedCount: 2, queueGapCount: 1, loopBlockedCount: 0 } });

      emit(testEventBus, { result: firstResult, timestamp: new Date().toISOString() });
      await tick();
      expect(capturedResult.lastResult).toEqual(firstResult);

      emit(testEventBus, { result: secondResult, timestamp: new Date().toISOString() });
      await tick();
      expect(capturedResult.lastResult).toEqual(secondResult);
      result.unmount();
    });
  });

  describe('nextPollIn as derived value', () => {
    // nextPollIn is now computed from nextPollAt (a stored timestamp), not driven
    // by a setInterval countdown. It reflects Math.max(0, nextPollAt - Date.now())
    // rounded to seconds. No interval is needed.

    it('nextPollIn is 30 immediately after receiving event', async () => {
      const result = renderHook();
      await tick();

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await tick();

      expect(capturedResult.nextPollIn).toBe(30);
      result.unmount();
    });

    it('nextPollIn is derived from nextPollAt (no timer needed)', async () => {
      // nextPollIn is computed at render time as Math.max(0, ceil((nextPollAt - now) / 1000)).
      // Without a re-render trigger, the value stays at what was computed on last render.
      // This test verifies the derived formula is applied correctly.
      const result = renderHook();
      await tick();

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await tick();

      // Immediately after event, nextPollIn should be ~30s
      expect(capturedResult.nextPollIn).toBe(30);
      // nextPollAt should be set
      expect(capturedResult.nextPollAt).not.toBeNull();

      result.unmount();
    });

    it('nextPollIn is always >= 0 (clamped by Math.max)', async () => {
      const result = renderHook();
      await tick();

      // Before any event, nextPollAt is null → nextPollIn is 0
      expect(capturedResult.nextPollIn).toBe(0);

      result.unmount();
    });

    it('resets nextPollIn to 30 when a new event arrives', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });

      const result = renderHook();
      await vi.advanceTimersByTimeAsync(50);

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await vi.advanceTimersByTimeAsync(50);
      expect(capturedResult.nextPollIn).toBe(30);

      await vi.advanceTimersByTimeAsync(15_000);

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await vi.advanceTimersByTimeAsync(50);
      expect(capturedResult.nextPollIn).toBe(30);

      result.unmount();
      vi.useRealTimers();
    });
  });

  describe('event listener lifecycle', () => {
    it('unsubscribes from diagnose:result on unmount', async () => {
      const offSpy = vi.spyOn(testEventBus, 'off');
      const result = renderHook();
      await tick();
      result.unmount();
      await tick();

      expect(offSpy).toHaveBeenCalledWith('diagnose:result', expect.any(Function));
    });

    it('does not throw when event emitted after unmount', async () => {
      const result = renderHook();
      await tick();
      result.unmount();
      await tick();

      expect(() => {
        emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      }).not.toThrow();
    });

    it('subscribes fresh on re-mount with a new eventBus', async () => {
      const result = renderHook();
      await tick();
      result.unmount();
      await tick();

      testEventBus = new EventBus();
      const result2 = renderHook();
      await tick();

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await tick();
      expect(capturedResult.isPolling).toBe(true);
      result2.unmount();
    });
  });
});
