import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { render } from 'ink';
import type { ReplayPlayerState, ReplayEvent } from '@ui/replay/ReplayTypes';
import type { ReplayService } from '@core/ReplayService';
import { useReplayPlayer } from '@ui/replay/useReplayPlayer';

// Capture the useInput handler so tests can simulate keyboard input
type InputHandler = (input: string, key: Record<string, boolean>) => void;
let capturedInputHandler: InputHandler | null = null;

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: vi.fn((handler: InputHandler) => {
      capturedInputHandler = handler;
    }),
  };
});

// ── helpers ────────────────────────────────────────────────────────────────

function makeLogRaw(id: number, createdAtMs: number) {
  return {
    id,
    taskId: 1,
    sequence: id,
    eventType: 'text',
    eventData: JSON.stringify({ text: `msg ${id}` }),
    createdAt: new Date(createdAtMs).toISOString(),
  };
}

function makeDefaultKey(): Record<string, boolean> {
  return {
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
    home: false,
    end: false,
    pageUp: false,
    pageDown: false,
    meta: false,
  };
}

function makeReplayService(options: {
  totalEvents?: number;
  // pages[0] = first getLogsPage call, pages[1] = second, etc.
  pages?: ReturnType<typeof makeLogRaw>[][];
  taskData?: {
    stageName?: string;
    workerModel?: string | null;
    durationMs?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  };
}): ReplayService {
  const { totalEvents = 3, pages = [], taskData = {} } = options;
  let pageCallCount = 0;
  return {
    getTask: vi.fn().mockReturnValue({
      id: 1,
      stageName: taskData.stageName ?? 'dev',
      workerModel: taskData.workerModel ?? 'sonnet',
      durationMs: taskData.durationMs ?? 5000,
      inputTokens: taskData.inputTokens ?? 100,
      outputTokens: taskData.outputTokens ?? 200,
    }),
    getTotalLogCount: vi.fn().mockReturnValue(totalEvents),
    getLogsPage: vi.fn().mockImplementation(() => {
      const page = pages[pageCallCount] ?? [];
      pageCallCount++;
      return page;
    }),
  } as unknown as ReplayService;
}

// ── test harness ──────────────────────────────────────────────────────────

let capturedResult: { state: ReplayPlayerState; currentEvent: ReplayEvent | null };

function TestHarness({
  replayService,
  taskId,
  onQuit,
}: {
  replayService: ReplayService;
  taskId: number;
  onQuit: () => void;
}): null {
  capturedResult = useReplayPlayer({ replayService, taskId, onQuit });
  return null;
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('useReplayPlayer', () => {
  let app: ReturnType<typeof render>;
  const onQuit = vi.fn();

  // Events spaced 100ms apart, starting at t=0 (epoch)
  const baseEvents = [
    makeLogRaw(1, 0),
    makeLogRaw(2, 100),
    makeLogRaw(3, 200),
  ];

  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    vi.clearAllMocks();
    capturedInputHandler = null;
    capturedResult = undefined as unknown as typeof capturedResult;
  });

  afterEach(() => {
    app?.unmount();
    vi.useRealTimers();
  });

  function renderHook(service: ReplayService) {
    act(() => {
      app = render(React.createElement(TestHarness, { replayService: service, taskId: 1, onQuit }));
    });
  }

  // ── initial state ────────────────────────────────────────────────────────

  it('populates initial state from lazy initializer', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    expect(capturedResult.state.taskMeta.stageName).toBe('dev');
    expect(capturedResult.state.taskMeta.workerModel).toBe('sonnet');
    expect(capturedResult.state.totalEvents).toBe(3);
    expect(capturedResult.state.loadedEvents).toHaveLength(3);
    expect(capturedResult.state.currentIndex).toBe(-1);
    expect(capturedResult.state.playbackState).toBe('playing');
    expect(capturedResult.state.speed).toBe(1);
    expect(capturedResult.state.firstTimestampMs).toBe(0);
    expect(capturedResult.state.lastTimestampMs).toBe(200);
  });

  it('DB called exactly once in lazy initializer despite subsequent re-renders', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    expect(service.getTask).toHaveBeenCalledTimes(1);
    expect(service.getTotalLogCount).toHaveBeenCalledTimes(1);
    // First getLogsPage called once for initial page load
    expect(service.getLogsPage).toHaveBeenCalledTimes(1);

    // Advance timer — triggers setState → re-render; DB must NOT be called again
    act(() => { vi.advanceTimersByTime(50); });

    expect(service.getTask).toHaveBeenCalledTimes(1);
    expect(service.getTotalLogCount).toHaveBeenCalledTimes(1);
  });

  it('currentEvent is null when currentIndex is -1', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    expect(capturedResult.currentEvent).toBeNull();
  });

  // ── timer: index advancement ──────────────────────────────────────────────

  it('advances currentIndex to 0 after 50ms (first event at t=0)', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { vi.advanceTimersByTime(50); });

    // targetTs = 0 + 50 = 50; event[0] at 0 ≤ 50 → index 0
    expect(capturedResult.state.currentIndex).toBe(0);
    expect(capturedResult.currentEvent).not.toBeNull();
    expect(capturedResult.currentEvent?.id).toBe(1);
  });

  it('advances currentIndex to 1 when virtual elapsed reaches second event timestamp', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { vi.advanceTimersByTime(150); });

    // targetTs = 150; event[1] at 100 ≤ 150 → index 1
    expect(capturedResult.state.currentIndex).toBe(1);
  });

  it('pauses playback when reaching the last event', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { vi.advanceTimersByTime(250); });

    // targetTs = 250; event[2] at 200 ≤ 250 → index 2 = totalEvents-1 → paused
    expect(capturedResult.state.currentIndex).toBe(2);
    expect(capturedResult.state.playbackState).toBe('paused');
  });

  it('does not advance index when already paused', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    // First advance to reach last event (auto-pauses)
    act(() => { vi.advanceTimersByTime(250); });
    expect(capturedResult.state.playbackState).toBe('paused');

    const indexAfterPause = capturedResult.state.currentIndex;
    act(() => { vi.advanceTimersByTime(500); });
    expect(capturedResult.state.currentIndex).toBe(indexAfterPause);
  });

  // ── prefetch ────────────────────────────────────────────────────────────

  it('triggers prefetch when currentIndex approaches end of loaded events', () => {
    // 3 loaded, totalEvents=5 → should prefetch when timer fires
    const page1 = baseEvents;
    const page2 = [makeLogRaw(4, 300), makeLogRaw(5, 400)];
    const service = makeReplayService({ totalEvents: 5, pages: [page1, page2] });
    renderHook(service);

    // page1 loaded on init (1 call); advance timer to trigger state update + prefetch
    act(() => { vi.advanceTimersByTime(50); });

    // PREFETCH_THRESHOLD=20, loadedEvents.length=3, 3-20=-17, newIndex(0) >= -17 → prefetch fires
    expect(service.getLogsPage).toHaveBeenCalledTimes(2);
    expect(capturedResult.state.loadedEvents).toHaveLength(5);
  });

  it('does not prefetch when all events are loaded', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { vi.advanceTimersByTime(50); });

    // loadedEvents.length(3) === totalEvents(3) → no prefetch
    expect(service.getLogsPage).toHaveBeenCalledTimes(1);
  });

  // ── keyboard: space (play/pause toggle) ──────────────────────────────────

  it('Space pauses playback when playing', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);
    expect(capturedResult.state.playbackState).toBe('playing');

    act(() => { capturedInputHandler!(' ', makeDefaultKey()); });

    expect(capturedResult.state.playbackState).toBe('paused');
  });

  it('Space resumes playback when paused', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { capturedInputHandler!(' ', makeDefaultKey()); });
    expect(capturedResult.state.playbackState).toBe('paused');

    act(() => { capturedInputHandler!(' ', makeDefaultKey()); });
    expect(capturedResult.state.playbackState).toBe('playing');
  });

  // ── keyboard: left arrow (step back / seek) ───────────────────────────────

  it('Left arrow pauses playback and clamps currentIndex to 0 when at -1', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { capturedInputHandler!('', { ...makeDefaultKey(), leftArrow: true }); });

    expect(capturedResult.state.playbackState).toBe('paused');
    expect(capturedResult.state.currentIndex).toBe(0);
  });

  it('Left arrow holds currentIndex at current value when already paused at index 1', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    // Advance to index 1, then pause
    act(() => { vi.advanceTimersByTime(150); });
    act(() => { capturedInputHandler!(' ', makeDefaultKey()); }); // pause

    expect(capturedResult.state.currentIndex).toBe(1);

    act(() => { capturedInputHandler!('', { ...makeDefaultKey(), leftArrow: true }); });
    // Math.max(0, 1) = 1 → stays at 1
    expect(capturedResult.state.currentIndex).toBe(1);
    expect(capturedResult.state.playbackState).toBe('paused');
  });

  // ── keyboard: right arrow (step forward) ──────────────────────────────────

  it('Right arrow advances currentIndex by 1 and pauses', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { vi.advanceTimersByTime(50); });
    // currentIndex is now 0

    act(() => { capturedInputHandler!('', { ...makeDefaultKey(), rightArrow: true }); });

    expect(capturedResult.state.currentIndex).toBe(1);
    expect(capturedResult.state.playbackState).toBe('paused');
  });

  it('Right arrow clamps at last loaded event', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { vi.advanceTimersByTime(250); }); // reaches end, paused at index 2

    act(() => { capturedInputHandler!('', { ...makeDefaultKey(), rightArrow: true }); });
    // Math.min(2, 2+1=3) → clamped to 2
    expect(capturedResult.state.currentIndex).toBe(2);
  });

  // ── keyboard: speed keys ───────────────────────────────────────────────────

  it.each([
    ['1', 1],
    ['2', 2],
    ['4', 4],
    ['8', 8],
  ] as const)('Speed key %s sets speed to %s', (key, expectedSpeed) => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { capturedInputHandler!(key, makeDefaultKey()); });

    expect(capturedResult.state.speed).toBe(expectedSpeed);
    // playbackState stays playing (speed change while playing)
    expect(capturedResult.state.playbackState).toBe('playing');
  });

  // ── keyboard: quit ─────────────────────────────────────────────────────────

  it('q key calls onQuit', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { capturedInputHandler!('q', makeDefaultKey()); });

    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('Q key calls onQuit', () => {
    const service = makeReplayService({ totalEvents: 3, pages: [baseEvents] });
    renderHook(service);

    act(() => { capturedInputHandler!('Q', makeDefaultKey()); });

    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  // ── zero events: auto-quit ─────────────────────────────────────────────────

  it('calls onQuit when totalEvents is 0', () => {
    const service = makeReplayService({ totalEvents: 0, pages: [[]] });
    renderHook(service);

    // useEffect fires on mount
    expect(onQuit).toHaveBeenCalledTimes(1);
  });
});
