import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus, eventBus } from '../../../src/core/EventBus.js';
import type { EventMap } from '../../../src/core/EventTypes.js';

describe('EventBus', () => {
  let bus: InstanceType<typeof EventBus>;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('subscriber receives emitted payload', () => {
    const listener = vi.fn();
    bus.on('task:completed', listener);
    const payload: EventMap['task:completed'] = {
      taskId: 1,
      storyId: 2,
      stageName: 'dev',
      status: 'completed',
    };
    bus.emit('task:completed', payload);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it('multiple subscribers all receive the event', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    const l3 = vi.fn();
    bus.on('task:queued', l1);
    bus.on('task:queued', l2);
    bus.on('task:queued', l3);
    const payload: EventMap['task:queued'] = { taskId: 10, storyId: 1, stageName: 'sm', status: 'queued' };
    bus.emit('task:queued', payload);
    expect(l1).toHaveBeenCalledWith(payload);
    expect(l2).toHaveBeenCalledWith(payload);
    expect(l3).toHaveBeenCalledWith(payload);
  });

  it('off() unregistered listener does NOT receive subsequent events', () => {
    const listener = vi.fn();
    bus.on('task:started', listener);
    bus.off('task:started', listener);
    bus.emit('task:started', { taskId: 5, storyId: 1, stageName: 'dev', status: 'running' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('throwing subscriber does NOT prevent other subscribers from being called', () => {
    const thrower = vi.fn(() => { throw new Error('boom'); });
    const safe = vi.fn();
    bus.on('task:failed', thrower);
    bus.on('task:failed', safe);
    const payload: EventMap['task:failed'] = { taskId: 3, storyId: 1, stageName: 'review', status: 'failed' };
    bus.emit('task:failed', payload);
    expect(thrower).toHaveBeenCalled();
    expect(safe).toHaveBeenCalledWith(payload);
  });

  it('throwing subscriber does NOT throw out of emit()', () => {
    bus.on('task:routed', () => { throw new Error('subscriber error'); });
    const payload: EventMap['task:routed'] = { taskId: 7, storyId: 1, stageName: 'dev', status: 'routed' };
    expect(() => bus.emit('task:routed', payload)).not.toThrow();
  });

  it('emitting an event with no subscribers does not throw', () => {
    expect(() =>
      bus.emit('pipeline:start', { projectId: 1, timestamp: new Date().toISOString() })
    ).not.toThrow();
  });

  it('the exported eventBus is the same object on repeated imports (singleton identity)', async () => {
    const mod1 = await import('../../../src/core/EventBus.js');
    const mod2 = await import('../../../src/core/EventBus.js');
    expect(mod1.eventBus).toBe(mod2.eventBus);
    expect(mod1.default).toBe(mod2.default);
    expect(mod1.eventBus).toBe(mod1.default);
  });

  it('non-Error throw (string) is still caught and does not crash emit()', () => {
    bus.on('task:rejected', () => { throw 'plain string error'; });
    const safe = vi.fn();
    bus.on('task:rejected', safe);
    const payload: EventMap['task:rejected'] = { taskId: 9, storyId: 2, stageName: 'tester', status: 'rejected' };
    expect(() => bus.emit('task:rejected', payload)).not.toThrow();
    expect(safe).toHaveBeenCalledWith(payload);
  });

  it('off() with listener never registered does not throw', () => {
    const never = vi.fn();
    expect(() => bus.off('queue:updated', never)).not.toThrow();
  });

  it('off() multiple times for same listener is idempotent', () => {
    const listener = vi.fn();
    bus.on('worker:idle', listener);
    bus.off('worker:idle', listener);
    bus.off('worker:idle', listener);
    expect(() =>
      bus.emit('worker:idle', { workerId: 'w1', stageName: 'dev', model: 'opus' })
    ).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('registering same listener twice for same event only calls it once (Set deduplication)', () => {
    const listener = vi.fn();
    bus.on('worker:busy', listener);
    bus.on('worker:busy', listener);
    bus.emit('worker:busy', { workerId: 'w2', stageName: 'sm', model: 'sonnet' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('listeners for event A are NOT called when event B is emitted', () => {
    const listenerA = vi.fn();
    bus.on('pipeline:start', listenerA);
    bus.emit('pipeline:stop', { projectId: 1, timestamp: new Date().toISOString() });
    expect(listenerA).not.toHaveBeenCalled();
  });

  it('listeners added during emit for the same event are not called in current cycle', () => {
    const lateListener = vi.fn();
    bus.on('stream:text', () => {
      bus.on('stream:text', lateListener);
    });
    bus.emit('stream:text', { taskId: 1, type: 'text', stageName: 'dev', timestamp: 0, data: { text: 'hello' } });
    expect(lateListener).not.toHaveBeenCalled();
  });

  it('re-entrant emit does not cause infinite loops', () => {
    let count = 0;
    bus.on('stream:thinking', () => {
      count++;
      if (count < 10) {
        bus.emit('stream:thinking', { taskId: 1, type: 'thinking', stageName: 'dev', timestamp: 0, data: { thinking: 'thoughts' } });
      }
    });
    expect(() =>
      bus.emit('stream:thinking', { taskId: 1, type: 'thinking', stageName: 'dev', timestamp: 0, data: { thinking: 'thoughts' } })
    ).not.toThrow();
  });

  it('all 18 event types can be emitted and received with correctly shaped payloads', () => {
    const events = {
      'pipeline:start': { projectId: 1, timestamp: '2026-01-01T00:00:00Z' },
      'pipeline:stop': { projectId: 1, timestamp: '2026-01-01T01:00:00Z' },
      'worker:idle': { workerId: 'w1', stageName: 'dev', model: 'opus' },
      'worker:busy': { workerId: 'w2', stageName: 'sm', model: 'sonnet' },
      'task:queued': { taskId: 1, storyId: 1, stageName: 'sm', status: 'queued' },
      'task:started': { taskId: 2, storyId: 1, stageName: 'dev', status: 'running' },
      'task:completed': { taskId: 3, storyId: 1, stageName: 'dev', status: 'completed' },
      'task:failed': { taskId: 4, storyId: 1, stageName: 'review', status: 'failed' },
      'task:routed': { taskId: 5, storyId: 1, stageName: 'tester', status: 'routed' },
      'task:rejected': { taskId: 6, storyId: 1, stageName: 'dev', status: 'rejected' },
      'stream:thinking': { taskId: 7, type: 'thinking', stageName: 'dev', timestamp: 0, data: { thinking: 'hmm' } },
      'stream:tool_use': { taskId: 8, type: 'tool_use', stageName: 'dev', timestamp: 0, data: { toolName: 'bash', toolInput: { cmd: 'ls' } } },
      'stream:tool_result': { taskId: 9, type: 'tool_result', stageName: 'dev', timestamp: 0, data: { toolResult: 'output' } },
      'stream:text': { taskId: 10, type: 'text', stageName: 'dev', timestamp: 0, data: { text: 'hello' } },
      'stream:error': { taskId: 11, type: 'error', stageName: 'dev', timestamp: 0, data: { error: 'oops' } },
      'stream:done': { taskId: 12, type: 'done', stageName: 'dev', timestamp: 0, data: {} },
      'queue:updated': { pending: 3, running: 1, completed: 5, failed: 0 },
      'story:completed': { storyId: 1, storyKey: '1.1', epicKey: '1', durationMs: 1234, storyTitle: 'Story 1', stageDurations: [{ stageName: 'dev', durationMs: 1234 }], totalAttempts: 1 },
    };

    for (const [event, payload] of Object.entries(events) as [keyof EventMap, EventMap[keyof EventMap]][]) {
      const listener = vi.fn();
      bus.on(event, listener as Parameters<typeof bus.on>[1]);
      bus.emit(event, payload as EventMap[typeof event]);
      expect(listener).toHaveBeenCalledWith(payload);
    }
  });

  it('stream:* payload with omitted optional data fields satisfies TypeScript', () => {
    const listener = vi.fn();
    bus.on('stream:text', listener);
    // data only has text, other optional fields omitted
    const payload: EventMap['stream:text'] = {
      taskId: 1,
      type: 'text',
      stageName: 'dev',
      timestamp: 0,
      data: { text: 'partial' },
    };
    bus.emit('stream:text', payload);
    expect(listener).toHaveBeenCalledWith(payload);
  });
});
