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

  describe('countdown timer', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('decrements nextPollIn by 1 each second', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });

      const result = renderHook();
      // Let useEffect run and register the event listener
      await vi.advanceTimersByTimeAsync(50);

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      // Flush React state update
      await vi.advanceTimersByTimeAsync(50);
      expect(capturedResult.nextPollIn).toBe(30);

      await vi.advanceTimersByTimeAsync(1000);
      expect(capturedResult.nextPollIn).toBe(29);

      await vi.advanceTimersByTimeAsync(1000);
      expect(capturedResult.nextPollIn).toBe(28);

      result.unmount();
    });

    it('does not go below 0', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });

      const result = renderHook();
      await vi.advanceTimersByTimeAsync(50);

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await vi.advanceTimersByTimeAsync(50);
      expect(capturedResult.nextPollIn).toBe(30);

      await vi.advanceTimersByTimeAsync(35_000);
      expect(capturedResult.nextPollIn).toBe(0);

      result.unmount();
    });

    it('resets nextPollIn to 30 when a new event arrives mid-countdown', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });

      const result = renderHook();
      await vi.advanceTimersByTimeAsync(50);

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await vi.advanceTimersByTimeAsync(50);
      expect(capturedResult.nextPollIn).toBe(30);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(capturedResult.nextPollIn).toBe(15);

      emit(testEventBus, { result: makeResult(), timestamp: new Date().toISOString() });
      await vi.advanceTimersByTimeAsync(50);
      expect(capturedResult.nextPollIn).toBe(30);

      result.unmount();
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
