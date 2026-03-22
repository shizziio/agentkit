import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { EventBus } from '@core/EventBus.js';
import type { StreamEvent, StoryCompleteEvent, LogEvent } from '@core/EventTypes.js';
import { MAX_ACTIVITY_EVENTS, ACTIVITY_VISIBLE_ROWS } from '@config/defaults.js';
import { formatLocalTime, formatLocalTimeMs } from '@shared/FormatTime.js';

export interface ActivityEvent {
  id: number;
  timestamp: string;
  stageName: string;
  icon: string;
  label: string;
  message: string;
  isAppLog?: boolean;
  team?: string;
  completionData?: {
    storyTitle: string;
    stageDurations: Array<{ stageName: string; durationMs: number }>;
    totalDurationMs: number;
    totalAttempts: number;
  };
}

export interface ActivityStore {
  events: ActivityEvent[];
  scrollIndex: number;
  isFollowing: boolean;
  init: (eventBus: EventBus) => void;
  cleanup: () => void;
  addEvent: (event: Omit<ActivityEvent, 'id'>) => void;
  addCompletion: (event: StoryCompleteEvent) => void;
  scrollUp: () => void;
  scrollDown: () => void;
  clearEvents: () => void;
}

// ---------------------------------------------------------------------------
// Module-level closure variables (NOT store state) — survive setState resets
// ---------------------------------------------------------------------------
let _nextId = 0;
let _pendingBatch: Array<(events: ActivityEvent[]) => void> = [];
let _lastFlush = 0;
let _flushInterval: ReturnType<typeof setInterval> | null = null;
let _eventBus: EventBus | null = null;

const THROTTLE_MS = 500;

// Handler refs for 8 event subscriptions
let _onStreamToolUse: ((e: StreamEvent) => void) | null = null;
let _onStreamToolResult: ((e: StreamEvent) => void) | null = null;
let _onStreamText: ((e: StreamEvent) => void) | null = null;
let _onStreamThinking: ((e: StreamEvent) => void) | null = null;
let _onStreamError: ((e: StreamEvent) => void) | null = null;
let _onStreamDone: ((e: StreamEvent) => void) | null = null;
let _onCompleted: ((e: StoryCompleteEvent) => void) | null = null;
let _onAppLog: ((e: LogEvent) => void) | null = null;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------
function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function formatData(data?: Record<string, unknown>): string {
  if (!data) return '';
  const entries = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : String(v);
      return `${k}=${s.length > 50 ? s.slice(0, 47) + '…' : s}`;
    });
  return entries.length > 0 ? `  [${entries.join(' ')}]` : '';
}

// ---------------------------------------------------------------------------
// Exported pure formatter functions
// ---------------------------------------------------------------------------
export function formatStreamEvent(event: StreamEvent): Omit<ActivityEvent, 'id'> {
  const timestamp = formatLocalTimeMs(event.timestamp);
  const stageName = event.stageName;

  let icon: string;
  let label: string;
  let message: string;

  switch (event.type) {
    case 'thinking': {
      icon = '🧠';
      label = 'thinking';
      const thinkingText = event.data.thinking ?? event.data.text ?? '';
      message = truncate(thinkingText);
      break;
    }
    case 'tool_use': {
      const toolName = event.data.toolName ?? '';
      const toolInput = event.data.toolInput;
      const toolIcons: Record<string, string> = {
        Read: '📖',
        Edit: '✏️',
        Bash: '⚡',
        Grep: '🔍',
      };
      icon = toolIcons[toolName] ?? '🔧';
      label = toolName;
      if (!toolInput) {
        message = toolName;
      } else if (toolName === 'Read' || toolName === 'Edit') {
        const path = (toolInput['file_path'] ?? toolInput['path'] ?? '') as string;
        message = truncate(String(path));
      } else if (toolName === 'Bash') {
        message = truncate(String(toolInput['command'] ?? ''));
      } else if (toolName === 'Grep') {
        message = truncate(String(toolInput['pattern'] ?? ''));
      } else {
        message = truncate(JSON.stringify(toolInput));
      }
      break;
    }
    case 'tool_result': {
      icon = '✅';
      label = 'result';
      const resultText = event.data.toolResult ?? event.data.text ?? '';
      const firstLine = resultText.split('\n')[0] ?? '';
      message = truncate(firstLine);
      break;
    }
    case 'text': {
      icon = '💬';
      label = 'text';
      message = truncate(event.data.text ?? '');
      break;
    }
    case 'error': {
      icon = '✖';
      label = 'error';
      message = truncate(event.data.error ?? '');
      break;
    }
    case 'done': {
      icon = '✓';
      label = 'done';
      message =
        typeof event.data.inputTokens === 'number'
          ? `in=${event.data.inputTokens} out=${event.data.outputTokens ?? 0} tokens`
          : '';
      break;
    }
    default: {
      icon = '•';
      label = event.type;
      message = '';
    }
  }

  return { timestamp, stageName, icon, label, message };
}

export function formatLogEvent(event: LogEvent): Omit<ActivityEvent, 'id'> {
  let icon: string;
  switch (event.level) {
    case 'WARN':
      icon = '⚠️';
      break;
    case 'ERROR':
      icon = '🔴';
      break;
    default:
      icon = '📋';
  }
  return {
    timestamp: formatLocalTime(event.timestamp),
    stageName: event.module,
    icon,
    label: event.level.toLowerCase(),
    message: truncate(event.message + formatData(event.data), 140),
    isAppLog: true,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
const _store = create<ActivityStore>()(
  subscribeWithSelector((set, get) => ({
    events: [],
    scrollIndex: 0,
    isFollowing: true,

    addEvent: (event: Omit<ActivityEvent, 'id'>): void => {
      const id = _nextId++;
      set((s) => {
        const newEvent: ActivityEvent = { id, ...event };
        const newEvents = [...s.events, newEvent].slice(-MAX_ACTIVITY_EVENTS);
        const newScrollIndex = s.isFollowing
          ? Math.max(0, newEvents.length - ACTIVITY_VISIBLE_ROWS)
          : s.scrollIndex;
        return { events: newEvents, scrollIndex: newScrollIndex };
      });
    },

    addCompletion: (event: StoryCompleteEvent): void => {
      const id = _nextId++;
      const now = formatLocalTime(new Date().toISOString());
      const { storyTitle, stageDurations, totalAttempts, durationMs } = event;
      const completionEvent: ActivityEvent = {
        id,
        timestamp: now,
        stageName: '—',
        icon: '✓',
        label: 'complete',
        message: storyTitle ?? event.storyKey,
        completionData: {
          storyTitle: storyTitle ?? event.storyKey,
          stageDurations: stageDurations ?? [],
          totalDurationMs: durationMs ?? 0,
          totalAttempts: totalAttempts ?? 0,
        },
      };
      set((s) => {
        const newEvents = [...s.events, completionEvent].slice(-MAX_ACTIVITY_EVENTS);
        const newScrollIndex = s.isFollowing
          ? Math.max(0, newEvents.length - ACTIVITY_VISIBLE_ROWS)
          : s.scrollIndex;
        return { events: newEvents, scrollIndex: newScrollIndex };
      });
    },

    scrollUp: (): void => {
      set((s) => ({
        scrollIndex: Math.max(0, s.scrollIndex - 3),
        isFollowing: false,
      }));
    },

    scrollDown: (): void => {
      set((s) => {
        const maxScroll = Math.max(0, s.events.length - ACTIVITY_VISIBLE_ROWS);
        const newScrollIndex = Math.min(s.scrollIndex + 3, maxScroll);
        return {
          scrollIndex: newScrollIndex,
          isFollowing: newScrollIndex >= maxScroll,
        };
      });
    },

    clearEvents: (): void => {
      set({ events: [], scrollIndex: 0, isFollowing: true });
    },

    init: (eventBus: EventBus): void => {
      get().cleanup();
      _lastFlush = Date.now();

      // Flush pending events in a single set() call to avoid N re-renders
      const flushBatch = (): void => {
        if (_pendingBatch.length === 0) return;
        const now = Date.now();
        if (now - _lastFlush < THROTTLE_MS) return;

        const pending = _pendingBatch;
        _pendingBatch = [];
        _lastFlush = now;

        // Execute all pending mutations on a snapshot, then commit once
        const state = get();
        let events = [...state.events];
        for (const action of pending) {
          action(events);
        }
        events = events.slice(-MAX_ACTIVITY_EVENTS);
        const scrollIndex = state.isFollowing
          ? Math.max(0, events.length - ACTIVITY_VISIBLE_ROWS)
          : state.scrollIndex;
        set({ events, scrollIndex });
      };

      // Timer-driven flush — decouples rendering from event rate
      _flushInterval = setInterval(flushBatch, THROTTLE_MS);

      // Mutation type: push new event or merge into last
      type Mutation = (events: ActivityEvent[]) => void;

      const pushEvent = (formatted: Omit<ActivityEvent, 'id'>): Mutation => {
        return (events) => {
          events.push({ id: _nextId++, ...formatted });
        };
      };

      const mergeTextDelta = (text: string, e: StreamEvent): Mutation => {
        return (events) => {
          const last = events.length > 0 ? events[events.length - 1] : null;
          if (last && last.label === 'text' && !last.isAppLog && !last.completionData) {
            const combined = last.message + text;
            const lines = combined.split('\n');
            last.message = truncate(lines[lines.length - 1] ?? '', 120);
          } else {
            events.push({ id: _nextId++, ...formatStreamEvent(e) });
          }
        };
      };

      const mergeThinkingDelta = (thinking: string, e: StreamEvent): Mutation => {
        return (events) => {
          const last = events.length > 0 ? events[events.length - 1] : null;
          if (last && last.label === 'thinking' && !last.isAppLog) {
            const combined = last.message + thinking;
            const lines = combined.split('\n');
            last.message = truncate(lines[lines.length - 1] ?? '', 120);
          } else {
            events.push({ id: _nextId++, ...formatStreamEvent(e) });
          }
        };
      };

      _onStreamToolUse = (e: StreamEvent): void => {
        _pendingBatch.push(pushEvent(formatStreamEvent(e)));
      };
      _onStreamToolResult = (e: StreamEvent): void => {
        _pendingBatch.push(pushEvent(formatStreamEvent(e)));
      };
      _onStreamText = (e: StreamEvent): void => {
        const text = e.data.text ?? '';
        if (!text) return;
        _pendingBatch.push(mergeTextDelta(text, e));
      };
      _onStreamThinking = (e: StreamEvent): void => {
        const thinking = e.data.thinking ?? '';
        if (!thinking) return;
        _pendingBatch.push(mergeThinkingDelta(thinking, e));
      };
      _onStreamError = (e: StreamEvent): void => {
        _pendingBatch.push(pushEvent(formatStreamEvent(e)));
      };
      _onStreamDone = (e: StreamEvent): void => {
        _pendingBatch.push(pushEvent(formatStreamEvent(e)));
      };
      _onCompleted = (e: StoryCompleteEvent): void => {
        _pendingBatch.push((events) => {
          const now = formatLocalTime(new Date().toISOString());
          const { storyTitle, stageDurations, totalAttempts, durationMs } = e;
          events.push({
            id: _nextId++,
            timestamp: now,
            stageName: '—',
            icon: '✓',
            label: 'complete',
            message: storyTitle ?? e.storyKey,
            completionData: {
              storyTitle: storyTitle ?? e.storyKey,
              stageDurations: stageDurations ?? [],
              totalDurationMs: durationMs ?? 0,
              totalAttempts: totalAttempts ?? 0,
            },
          });
        });
      };
      _onAppLog = (e: LogEvent): void => {
        _pendingBatch.push(pushEvent(formatLogEvent(e)));
      };

      eventBus.on('stream:tool_use', _onStreamToolUse);
      eventBus.on('stream:tool_result', _onStreamToolResult);
      eventBus.on('stream:text', _onStreamText);
      eventBus.on('stream:thinking', _onStreamThinking);
      eventBus.on('stream:error', _onStreamError);
      eventBus.on('stream:done', _onStreamDone);
      eventBus.on('story:completed', _onCompleted);
      eventBus.on('app:log', _onAppLog);

      _eventBus = eventBus;
    },

    cleanup: (): void => {
      if (_eventBus) {
        if (_onStreamToolUse) _eventBus.off('stream:tool_use', _onStreamToolUse);
        if (_onStreamToolResult) _eventBus.off('stream:tool_result', _onStreamToolResult);
        if (_onStreamText) _eventBus.off('stream:text', _onStreamText);
        if (_onStreamThinking) _eventBus.off('stream:thinking', _onStreamThinking);
        if (_onStreamError) _eventBus.off('stream:error', _onStreamError);
        if (_onStreamDone) _eventBus.off('stream:done', _onStreamDone);
        if (_onCompleted) _eventBus.off('story:completed', _onCompleted);
        if (_onAppLog) _eventBus.off('app:log', _onAppLog);
        _eventBus = null;
      }
      _onStreamToolUse = null;
      _onStreamToolResult = null;
      _onStreamText = null;
      _onStreamThinking = null;
      _onStreamError = null;
      _onStreamDone = null;
      _onCompleted = null;
      _onAppLog = null;
      if (_flushInterval !== null) {
        clearInterval(_flushInterval);
        _flushInterval = null;
      }
      _pendingBatch = [];
      _lastFlush = 0;
    },
  })),
);

// Patch external setState to always merge (never replace), preserving action functions.
const _origSetState = _store.setState;
_store.setState = (partial, _replace) => {
  const resolved =
    typeof partial === 'function' ? partial(_store.getState()) : partial;
  _origSetState(resolved);
};

export const useActivityStore = _store;
