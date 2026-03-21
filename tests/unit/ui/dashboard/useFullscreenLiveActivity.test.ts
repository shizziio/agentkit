import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink';

import { EventBus } from '@core/EventBus';
import type { StreamEvent } from '@core/EventTypes';
import type { FullscreenUseLiveActivityResult } from '@ui/dashboard/live-activity/LiveActivityTypes';
import { useFullscreenLiveActivity } from '@ui/dashboard/hooks/useFullscreenLiveActivity';
import { MAX_LIVE_EVENTS } from '@ui/dashboard/live-activity/LiveActivityTypes';

let capturedResult: FullscreenUseLiveActivityResult;

function HookCapture({ eventBus }: { eventBus: EventBus }): React.ReactElement | null {
  capturedResult = useFullscreenLiveActivity(eventBus);
  return null;
}

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 20); });

function makeStreamEvent(
  type: StreamEvent['type'],
  overrides: Partial<StreamEvent> = {},
): StreamEvent {
  return {
    taskId: 1,
    stageName: 'dev',
    timestamp: new Date('2024-01-01T12:34:56.000Z').getTime(),
    type,
    data: {},
    ...overrides,
  };
}

describe('useFullscreenLiveActivity', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();
    capturedResult = undefined as unknown as FullscreenUseLiveActivityResult;
  });

  function renderHook(): ReturnType<typeof render> {
    return render(React.createElement(HookCapture, { eventBus }));
  }

  it('initial state: empty events, empty workers, focusedWorkerIndex=0, scrollOffset=0', () => {
    const result = renderHook();
    expect(capturedResult.state.events).toHaveLength(0);
    expect(capturedResult.state.workers).toHaveLength(0);
    expect(capturedResult.state.focusedWorkerIndex).toBe(0);
    expect(capturedResult.state.scrollOffset).toBe(0);
    result.unmount();
  });

  it('subscribes to 5 stream event types on mount', async () => {
    const onSpy = vi.spyOn(eventBus, 'on');
    const result = renderHook();
    await tick();

    const eventTypes = onSpy.mock.calls.map((c) => c[0]);
    expect(eventTypes).toContain('stream:thinking');
    expect(eventTypes).toContain('stream:tool_use');
    expect(eventTypes).toContain('stream:tool_result');
    expect(eventTypes).toContain('stream:text');
    expect(eventTypes).toContain('stream:error');
    expect(onSpy).toHaveBeenCalledTimes(5);

    result.unmount();
  });

  it('cleans up all 5 listeners on unmount', async () => {
    const offSpy = vi.spyOn(eventBus, 'off');
    const result = renderHook();
    await tick();
    result.unmount();
    await tick();

    expect(offSpy).toHaveBeenCalledWith('stream:thinking', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('stream:tool_use', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('stream:tool_result', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('stream:text', expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith('stream:error', expect.any(Function));
    expect(offSpy).toHaveBeenCalledTimes(5);
  });

  it('stream:thinking event is prepended to events with thinking text in lines', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:thinking', makeStreamEvent('thinking', {
      data: { thinking: 'I am considering the options' },
    }));
    await tick();

    expect(capturedResult.state.events).toHaveLength(1);
    const event = capturedResult.state.events[0]!;
    expect(event.type).toBe('thinking');
    expect(event.lines.join('\n')).toContain('I am considering the options');
    expect(event.lines[0]).toMatch(/💭/);

    result.unmount();
  });

  it('stream:tool_use with toolName=Read formats file_path line', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', {
      data: { toolName: 'Read', toolInput: { file_path: '/src/config.ts' } },
    }));
    await tick();

    const event = capturedResult.state.events[0]!;
    expect(event.type).toBe('tool_use');
    expect(event.lines[0]).toContain('Read: /src/config.ts');

    result.unmount();
  });

  it('stream:tool_use with toolName=Edit formats file path and line count', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', {
      data: {
        toolName: 'Edit',
        toolInput: { file_path: '/src/index.ts', old_string: 'line1\nline2\nline3' },
      },
    }));
    await tick();

    const event = capturedResult.state.events[0]!;
    expect(event.lines[0]).toContain('Edit: /src/index.ts');
    expect(event.lines[1]).toContain('3 lines');

    result.unmount();
  });

  it('stream:tool_use with toolName=Bash formats the command', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:tool_use', makeStreamEvent('tool_use', {
      data: { toolName: 'Bash', toolInput: { command: 'npx vitest run' } },
    }));
    await tick();

    const event = capturedResult.state.events[0]!;
    expect(event.lines[0]).toContain('Bash:');
    expect(event.lines.join('\n')).toContain('npx vitest run');

    result.unmount();
  });

  it('stream:tool_result formats multi-line output', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:tool_result', makeStreamEvent('tool_result', {
      data: { toolResult: 'line one\nline two\nline three' },
    }));
    await tick();

    const event = capturedResult.state.events[0]!;
    expect(event.type).toBe('tool_result');
    const joined = event.lines.join('\n');
    expect(joined).toContain('Result:');
    expect(joined).toContain('line one');
    expect(joined).toContain('line two');

    result.unmount();
  });

  it('events buffer is capped at MAX_LIVE_EVENTS (300), oldest dropped', async () => {
    const result = renderHook();
    await tick();

    // Add MAX_LIVE_EVENTS + 1 events
    for (let i = 0; i < MAX_LIVE_EVENTS + 1; i++) {
      eventBus.emit('stream:text', makeStreamEvent('text', { data: { text: `msg-${i}` } }));
    }
    await tick();

    expect(capturedResult.state.events).toHaveLength(MAX_LIVE_EVENTS);
    // Events are prepended (newest first), so the oldest (msg-0) should be gone
    // The last event in the array should NOT be msg-0
    const allMessages = capturedResult.state.events.map((e) => e.lines.join(''));
    expect(allMessages.some((m) => m.includes('msg-0'))).toBe(false);

    result.unmount();
  });

  it('new unique worker is added to workers list', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:text', makeStreamEvent('text', {
      taskId: 5,
      stageName: 'review',
      data: { text: 'hello' },
    }));
    await tick();

    expect(capturedResult.state.workers).toHaveLength(1);
    expect(capturedResult.state.workers[0]!.taskId).toBe(5);
    expect(capturedResult.state.workers[0]!.stageName).toBe('review');
    expect(capturedResult.state.workers[0]!.label).toBe('review#5');

    result.unmount();
  });

  it('same worker (taskId+stageName) is not added twice', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:text', makeStreamEvent('text', { taskId: 1, stageName: 'dev', data: { text: 'a' } }));
    eventBus.emit('stream:text', makeStreamEvent('text', { taskId: 1, stageName: 'dev', data: { text: 'b' } }));
    await tick();

    expect(capturedResult.state.workers).toHaveLength(1);

    result.unmount();
  });

  it('scrollUp decrements scrollOffset, clamped at 0', async () => {
    const result = renderHook();
    await tick();

    // Add events to allow scrolling
    for (let i = 0; i < 5; i++) {
      eventBus.emit('stream:text', makeStreamEvent('text', { data: { text: `msg-${i}` } }));
    }
    await tick();

    // Scroll down first to have room to scroll up
    capturedResult.scrollDown();
    capturedResult.scrollDown();
    await tick();

    const offsetBefore = capturedResult.state.scrollOffset;
    capturedResult.scrollUp();
    await tick();

    expect(capturedResult.state.scrollOffset).toBe(Math.max(0, offsetBefore - 1));

    result.unmount();
  });

  it('scrollUp at offset=0 stays at 0 (clamp)', async () => {
    const result = renderHook();
    await tick();

    capturedResult.scrollUp();
    await tick();

    expect(capturedResult.state.scrollOffset).toBe(0);

    result.unmount();
  });

  it('scrollDown increments scrollOffset, clamped at events.length - 1', async () => {
    const result = renderHook();
    await tick();

    // Add 3 events
    for (let i = 0; i < 3; i++) {
      eventBus.emit('stream:text', makeStreamEvent('text', { data: { text: `msg-${i}` } }));
    }
    await tick();

    capturedResult.scrollDown();
    capturedResult.scrollDown();
    capturedResult.scrollDown();
    capturedResult.scrollDown();
    capturedResult.scrollDown();
    await tick();

    // Max scroll = events.length - 1 = 2
    expect(capturedResult.state.scrollOffset).toBeLessThanOrEqual(2);

    result.unmount();
  });

  it('focusNextWorker cycles through workers', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:text', makeStreamEvent('text', { taskId: 1, stageName: 'dev', data: { text: 'a' } }));
    eventBus.emit('stream:text', makeStreamEvent('text', { taskId: 2, stageName: 'sm', data: { text: 'b' } }));
    await tick();

    expect(capturedResult.state.focusedWorkerIndex).toBe(0);
    capturedResult.focusNextWorker();
    await tick();
    expect(capturedResult.state.focusedWorkerIndex).toBe(1);
    capturedResult.focusNextWorker();
    await tick();
    expect(capturedResult.state.focusedWorkerIndex).toBe(2);
    capturedResult.focusNextWorker();
    await tick();
    // Cycles back to 0 (All)
    expect(capturedResult.state.focusedWorkerIndex).toBe(0);

    result.unmount();
  });

  it('thinking event with empty thinking field renders "(empty thinking)"', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:thinking', makeStreamEvent('thinking', {
      data: { thinking: '' },
    }));
    await tick();

    const event = capturedResult.state.events[0]!;
    expect(event.lines.join('\n')).toContain('(empty thinking)');

    result.unmount();
  });

  it('tool_result with undefined toolResult renders "(empty result)"', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:tool_result', makeStreamEvent('tool_result', {
      data: {},
    }));
    await tick();

    const event = capturedResult.state.events[0]!;
    expect(event.lines.join('\n')).toContain('(empty result)');

    result.unmount();
  });

  it('stream:error event is captured with error message', async () => {
    const result = renderHook();
    await tick();

    eventBus.emit('stream:error', makeStreamEvent('error', {
      data: { error: 'something went wrong' },
    }));
    await tick();

    expect(capturedResult.state.events).toHaveLength(1);
    const event = capturedResult.state.events[0]!;
    expect(event.type).toBe('error');
    expect(event.lines.join('\n')).toContain('something went wrong');

    result.unmount();
  });
});
