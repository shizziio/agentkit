import { useEffect, useReducer, useCallback } from 'react';

import type { EventBus } from '@core/EventBus.js';
import type { StreamEvent } from '@core/EventTypes.js';
import type {
  WorkerFocus,
  LiveActivityEvent,
  LiveActivityState,
  FullscreenUseLiveActivityResult,
} from '../live-activity/LiveActivityTypes.js';
import { MAX_LIVE_EVENTS } from '../live-activity/LiveActivityTypes.js';

let nextEventId = 0;

function countLines(s: string): number {
  return s.split('\n').length;
}

export function formatStreamEvent(event: StreamEvent): string[] {
  switch (event.type) {
    case 'thinking': {
      const thinking = event.data.thinking ?? '';
      if (!thinking) return ['💭 (empty thinking)'];
      const lines = thinking.split('\n');
      lines[0] = '💭 ' + (lines[0] ?? '');
      return lines;
    }
    case 'tool_use': {
      const toolName = event.data.toolName ?? '';
      const toolInput = event.data.toolInput ?? {};

      if (toolName === 'Read') {
        const filePath = toolInput['file_path'];
        if (!filePath) return [`🔍 Read: ${JSON.stringify(toolInput)}`];
        const lines: string[] = [`🔍 Read: ${String(filePath)}`];
        const content = toolInput['content'];
        if (content && typeof content === 'string') {
          lines.push(...content.split('\n').slice(0, 5));
        }
        return lines;
      }

      if (toolName === 'Edit') {
        const filePath = toolInput['file_path'];
        if (!filePath) return [`✏️  Edit: ${JSON.stringify(toolInput)}`];
        const result: string[] = [`✏️  Edit: ${String(filePath)}`];
        const oldString = toolInput['old_string'];
        if (oldString && typeof oldString === 'string') {
          result.push(` range: ${countLines(oldString)} lines`);
        }
        return result;
      }

      if (toolName === 'Bash') {
        const cmd = toolInput['command'] ?? '';
        return ['🖥️  Bash:', `  ${String(cmd)}`];
      }

      const jsonLines = JSON.stringify(toolInput, null, 2).split('\n');
      return [`🔧 ${toolName}:`, ...jsonLines];
    }
    case 'tool_result': {
      const toolResult = event.data.toolResult;
      if (!toolResult) return ['📤 Result: (empty result)'];
      const lines = toolResult.split('\n');
      lines[0] = '📤 Result: ' + (lines[0] ?? '');
      return lines;
    }
    case 'text': {
      const text = event.data.text ?? '';
      if (!text) return ['📝 '];
      const lines = text.split('\n');
      lines[0] = '📝 ' + (lines[0] ?? '');
      return lines;
    }
    case 'error': {
      return [`❌ Error: ${event.data.error ?? 'unknown error'}`];
    }
    default: {
      return [`• ${event.type}`];
    }
  }
}

interface InternalState extends LiveActivityState {
  nextId: number;
}

type Action =
  | { type: 'ADD_EVENT'; event: LiveActivityEvent; worker: WorkerFocus }
  | { type: 'SCROLL_UP' }
  | { type: 'SCROLL_DOWN' }
  | { type: 'FOCUS_NEXT' }
  | { type: 'FOCUS_PREV' };

function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case 'ADD_EVENT': {
      const events = [action.event, ...state.events].slice(0, MAX_LIVE_EVENTS);
      const existing = state.workers.find(
        (w) => w.taskId === action.worker.taskId && w.stageName === action.worker.stageName,
      );
      const workers = existing ? state.workers : [...state.workers, action.worker];
      return { ...state, events, workers, nextId: state.nextId + 1 };
    }
    case 'SCROLL_UP': {
      return { ...state, scrollOffset: Math.max(0, state.scrollOffset - 1) };
    }
    case 'SCROLL_DOWN': {
      const maxScroll = Math.max(0, state.events.length - 1);
      return { ...state, scrollOffset: Math.min(state.scrollOffset + 1, maxScroll) };
    }
    case 'FOCUS_NEXT': {
      const totalOptions = state.workers.length + 1;
      const next = (state.focusedWorkerIndex + 1) % totalOptions;
      return { ...state, focusedWorkerIndex: next, scrollOffset: 0 };
    }
    case 'FOCUS_PREV': {
      const totalOptions = state.workers.length + 1;
      const prev = (state.focusedWorkerIndex - 1 + totalOptions) % totalOptions;
      return { ...state, focusedWorkerIndex: prev, scrollOffset: 0 };
    }
  }
}

const initialState: InternalState = {
  events: [],
  workers: [],
  focusedWorkerIndex: 0,
  scrollOffset: 0,
  nextId: 0,
};

export function useFullscreenLiveActivity(
  eventBus: EventBus,
): FullscreenUseLiveActivityResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const handleEvent = (event: StreamEvent): void => {
      if (event.type === 'done') return;

      const lines = formatStreamEvent(event);
      const liveEvent: LiveActivityEvent = {
        id: nextEventId++,
        taskId: event.taskId,
        stageName: event.stageName,
        timestamp: event.timestamp,
        type: event.type as LiveActivityEvent['type'],
        lines,
      };
      const worker: WorkerFocus = {
        taskId: event.taskId,
        stageName: event.stageName,
        label: `${event.stageName}#${event.taskId}`,
      };
      dispatch({ type: 'ADD_EVENT', event: liveEvent, worker });
    };

    eventBus.on('stream:thinking', handleEvent);
    eventBus.on('stream:tool_use', handleEvent);
    eventBus.on('stream:tool_result', handleEvent);
    eventBus.on('stream:text', handleEvent);
    eventBus.on('stream:error', handleEvent);

    return () => {
      eventBus.off('stream:thinking', handleEvent);
      eventBus.off('stream:tool_use', handleEvent);
      eventBus.off('stream:tool_result', handleEvent);
      eventBus.off('stream:text', handleEvent);
      eventBus.off('stream:error', handleEvent);
    };
  }, [eventBus]);

  const scrollUp = useCallback(() => dispatch({ type: 'SCROLL_UP' }), []);
  const scrollDown = useCallback(() => dispatch({ type: 'SCROLL_DOWN' }), []);
  const focusNextWorker = useCallback(() => dispatch({ type: 'FOCUS_NEXT' }), []);
  const focusPrevWorker = useCallback(() => dispatch({ type: 'FOCUS_PREV' }), []);

  const exposedState: LiveActivityState = {
    events: state.events,
    workers: state.workers,
    focusedWorkerIndex: state.focusedWorkerIndex,
    scrollOffset: state.scrollOffset,
  };

  return { state: exposedState, scrollUp, scrollDown, focusNextWorker, focusPrevWorker };
}
