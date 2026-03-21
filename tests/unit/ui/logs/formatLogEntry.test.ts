import { describe, it, expect } from 'vitest';

import { formatLogEntry } from '@ui/logs/formatLogEntry';
import type { LogEntry } from '@core/LogsTypes';

describe('formatLogEntry', () => {
  // Helper to get expected local time from UTC timestamp (timezone-aware)
  function getLocalTimeString(utcTimeStr: string): string {
    const d = new Date(utcTimeStr);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  const baseEntry: Omit<LogEntry, 'eventType' | 'eventData'> = {
    id: 1,
    taskId: 10,
    sequence: 1,
    createdAt: '2024-01-01T12:30:45Z',
    stageName: 'dev',
    storyId: 1,
  };

  it('formats thinking event correctly', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'thinking',
      eventData: { thinking: 'analyzing the problem' },
    };

    const formatted = formatLogEntry(entry);
    const expectedTime = getLocalTimeString('2024-01-01T12:30:45Z');
    expect(formatted).toContain(expectedTime);
    expect(formatted).toContain('[DEV]');
    expect(formatted).toContain('💭');
    expect(formatted).toContain('analyzing the problem');
  });

  it('formats tool_use event with read tool', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_use',
      eventData: { toolName: 'read', toolInput: { file_path: '/src/index.ts' } },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('[DEV]');
    expect(formatted).toContain('📖');
    expect(formatted).toContain('read');
    expect(formatted).toContain('/src/index.ts');
  });

  it('formats tool_use event with edit tool', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_use',
      eventData: { toolName: 'edit', toolInput: { file_path: '/src/app.ts' } },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('✏️');
    expect(formatted).toContain('edit');
  });

  it('formats tool_use event with bash tool', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_use',
      eventData: { toolName: 'bash', toolInput: { command: 'npm test' } },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('⚡');
    expect(formatted).toContain('bash');
    expect(formatted).toContain('npm test');
  });

  it('formats tool_use event with execute tool', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_use',
      eventData: { toolName: 'execute', toolInput: { command: 'build' } },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('⚡');
    expect(formatted).toContain('execute');
  });

  it('formats tool_use event with grep tool', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_use',
      eventData: { toolName: 'grep', toolInput: { pattern: 'import.*lodash' } },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('🔍');
    expect(formatted).toContain('grep');
  });

  it('formats tool_use event with unknown tool', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_use',
      eventData: { toolName: 'custom_tool', toolInput: {} },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('🔧');
    expect(formatted).toContain('custom_tool');
  });

  it('formats tool_result event', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_result',
      eventData: { toolResult: 'File successfully read with 150 lines' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('[DEV]');
    expect(formatted).toContain('↩');
    expect(formatted).toContain('File successfully read');
  });

  it('truncates long tool_result', () => {
    const longResult = 'x'.repeat(100);
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_result',
      eventData: { toolResult: longResult },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted.length).toBeLessThan(200);
  });

  it('formats text event', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'text',
      eventData: { text: 'Here is the implementation details' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('💬');
    expect(formatted).toContain('Here is the implementation');
  });

  it('truncates long text', () => {
    const longText = 'x'.repeat(150);
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'text',
      eventData: { text: longText },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted.length).toBeLessThan(250);
  });

  it('formats error event', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'error',
      eventData: { error: 'Task failed: invalid input' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('✖');
    expect(formatted).toContain('Task failed');
  });

  it('formats done event', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'done',
      eventData: {},
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('✓');
    expect(formatted).toContain('done');
  });

  it('handles unknown event type', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'unknown_type',
      eventData: { custom: 'data' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('·');
  });

  it('formats stage name with color code for sm', () => {
    const entry: LogEntry = {
      ...baseEntry,
      stageName: 'sm',
      eventType: 'text',
      eventData: { text: 'test' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('[SM]');
  });

  it('formats stage name with color code for dev', () => {
    const entry: LogEntry = {
      ...baseEntry,
      stageName: 'dev',
      eventType: 'text',
      eventData: { text: 'test' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('[DEV]');
  });

  it('formats stage name with color code for review', () => {
    const entry: LogEntry = {
      ...baseEntry,
      stageName: 'review',
      eventType: 'text',
      eventData: { text: 'test' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('[REVIEW]');
  });

  it('formats stage name with color code for tester', () => {
    const entry: LogEntry = {
      ...baseEntry,
      stageName: 'tester',
      eventType: 'text',
      eventData: { text: 'test' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('[TESTER]');
  });

  it('handles invalid timestamp gracefully', () => {
    const entry: LogEntry = {
      ...baseEntry,
      createdAt: 'invalid-date-string',
      eventType: 'text',
      eventData: { text: 'test' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('??:??:??');
  });

  it('handles missing event data fields', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'thinking',
      eventData: {},
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toBeDefined();
  });

  it('handles tool_use with missing toolInput', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_use',
      eventData: { toolName: 'read' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('read');
  });

  it('handles tool_use with invalid toolInput structure', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'tool_use',
      eventData: { toolName: 'read', toolInput: 'not an object' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('read');
  });

  it('includes timestamp prefix in all entries', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'text',
      eventData: { text: 'test' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toMatch(/^\[\d{2}:\d{2}:\d{2}\]/);
  });

  it('handles RFC 3339 timestamp format with timezone-aware comparison', () => {
    const entry: LogEntry = {
      ...baseEntry,
      createdAt: '2024-12-25T15:30:45Z',
      eventType: 'text',
      eventData: { text: 'test' },
    };

    const formatted = formatLogEntry(entry);
    const expectedTime = getLocalTimeString('2024-12-25T15:30:45Z');
    expect(formatted).toContain(`[${expectedTime}]`);
  });

  it('handles various event types in sequence', () => {
    const eventTypes = ['thinking', 'tool_use', 'tool_result', 'text', 'error', 'done'];
    for (const eventType of eventTypes) {
      const entry: LogEntry = {
        ...baseEntry,
        eventType,
        eventData:
          eventType === 'tool_use'
            ? { toolName: 'read' }
            : eventType === 'thinking'
              ? { thinking: 'test' }
              : eventType === 'text'
                ? { text: 'test' }
                : eventType === 'error'
                  ? { error: 'test' }
                  : {},
      };

      const formatted = formatLogEntry(entry);
      expect(formatted).toBeDefined();
      expect(formatted.length).toBeGreaterThan(0);
    }
  });

  it('preserves special characters in messages', () => {
    const entry: LogEntry = {
      ...baseEntry,
      eventType: 'text',
      eventData: { text: 'Path: /src/components/[id]/page.tsx' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('[id]');
  });

  it('handles very long stage names', () => {
    const entry: LogEntry = {
      ...baseEntry,
      stageName: 'very_long_stage_name_that_exceeds_normal_length',
      eventType: 'text',
      eventData: { text: 'test' },
    };

    const formatted = formatLogEntry(entry);
    expect(formatted).toContain('[VERY_LONG_STAGE_NAME_THAT_EXCEEDS_NORMAL_LENGTH]');
  });
});
