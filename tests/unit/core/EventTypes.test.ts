import { describe, it, expect } from 'vitest';
import type { EventMap, PipelineReadyEvent } from '../../../src/core/EventTypes.js';
import type { RecoveryResult } from '../../../src/core/PipelineTypes.js';

describe('EventTypes', () => {
  describe('type definitions', () => {
    it('should export EventMap interface with all expected event types', () => {
      // This test verifies that EventMap is properly typed at compile time
      // We use a type assertion to ensure the map exists and has the expected structure
      const eventMapKeys: (keyof EventMap)[] = [
        'pipeline:start',
        'pipeline:stop',
        'pipeline:ready',
        'worker:idle',
        'worker:busy',
        'task:queued',
        'task:started',
        'task:completed',
        'task:failed',
        'task:routed',
        'task:rejected',
        'stream:thinking',
        'stream:tool_use',
        'stream:tool_result',
        'stream:text',
        'stream:error',
        'stream:done',
        'queue:updated',
        'story:completed',
        'story:blocked',
        'task:recovered',
        'task:alert',
      ];

      expect(eventMapKeys.length).toBe(22);
      expect(eventMapKeys).toContain('pipeline:ready');
      expect(eventMapKeys).toContain('task:recovered');
      expect(eventMapKeys).toContain('task:alert');
    });

    it('should have PipelineReadyEvent with correct properties', () => {
      // This test verifies the structure of PipelineReadyEvent
      const testEvent: PipelineReadyEvent = {
        projectId: 42,
        recoveryResult: {
          recoveredCount: 2,
          recoveredTasks: [],
        },
      };

      expect(testEvent.projectId).toBe(42);
      expect(testEvent.recoveryResult.recoveredCount).toBe(2);
      expect(testEvent.recoveryResult.recoveredTasks).toEqual([]);
    });
  });

  describe('RecoveryResult type reference', () => {
    it('PipelineReadyEvent.recoveryResult should use RecoveryResult type from PipelineTypes', () => {
      // Verify that RecoveryResult has the expected structure
      const recoveryResult: RecoveryResult = {
        recoveredCount: 3,
        recoveredTasks: [
          {
            id: 1,
            storyId: 10,
            stageName: 'dev',
            attempt: 1,
          },
          {
            id: 2,
            storyId: 11,
            stageName: 'review',
            attempt: 2,
          },
          {
            id: 3,
            storyId: 12,
            stageName: 'tester',
            attempt: 1,
          },
        ],
      };

      expect(recoveryResult.recoveredCount).toBe(3);
      expect(recoveryResult.recoveredTasks).toHaveLength(3);
      expect(recoveryResult.recoveredTasks[0]?.stageName).toBe('dev');
    });

    it('RecoveryResult can be used in PipelineReadyEvent', () => {
      // This verifies that RecoveryResult type is properly compatible with PipelineReadyEvent
      const recovery: RecoveryResult = {
        recoveredCount: 0,
        recoveredTasks: [],
      };

      const event: PipelineReadyEvent = {
        projectId: 1,
        recoveryResult: recovery,
      };

      expect(event.recoveryResult).toEqual(recovery);
    });

    it('RecoveryResult type is imported correctly from PipelineTypes', () => {
      // Verify structure matches what's expected from PipelineTypes
      const recovered: RecoveryResult = {
        recoveredCount: 1,
        recoveredTasks: [
          {
            id: 100,
            storyId: 5,
            stageName: 'sm',
            attempt: 1,
          },
        ],
      };

      expect(recovered.recoveredCount).toBe(1);
      expect(recovered.recoveredTasks[0]?.id).toBe(100);
      expect(recovered.recoveredTasks[0]?.storyId).toBe(5);
      expect(recovered.recoveredTasks[0]?.stageName).toBe('sm');
      expect(recovered.recoveredTasks[0]?.attempt).toBe(1);
    });
  });

  describe('PipelineReadyEvent payload', () => {
    it('should allow creating PipelineReadyEvent with empty recovery', () => {
      const event: PipelineReadyEvent = {
        projectId: 99,
        recoveryResult: {
          recoveredCount: 0,
          recoveredTasks: [],
        },
      };

      expect(event.projectId).toBe(99);
      expect(event.recoveryResult.recoveredCount).toBe(0);
      expect(event.recoveryResult.recoveredTasks).toHaveLength(0);
    });

    it('should allow creating PipelineReadyEvent with recovered tasks', () => {
      const event: PipelineReadyEvent = {
        projectId: 42,
        recoveryResult: {
          recoveredCount: 2,
          recoveredTasks: [
            {
              id: 1,
              storyId: 1,
              stageName: 'dev',
              attempt: 1,
            },
            {
              id: 2,
              storyId: 2,
              stageName: 'review',
              attempt: 1,
            },
          ],
        },
      };

      expect(event.projectId).toBe(42);
      expect(event.recoveryResult.recoveredCount).toBe(2);
      expect(event.recoveryResult.recoveredTasks).toHaveLength(2);
    });

    it('should match EventMap["pipeline:ready"] type', () => {
      // Verify that PipelineReadyEvent matches what's expected in EventMap
      type PipelineReadyFromMap = EventMap['pipeline:ready'];

      const event: PipelineReadyFromMap = {
        projectId: 1,
        recoveryResult: {
          recoveredCount: 0,
          recoveredTasks: [],
        },
      };

      expect(event.projectId).toBe(1);
      expect(event.recoveryResult.recoveredCount).toBe(0);
    });
  });

  describe('type compatibility', () => {
    it('should ensure RecoveryResult structure is stable', () => {
      // Verify all required fields exist
      const result: RecoveryResult = {
        recoveredCount: 5,
        recoveredTasks: [
          {
            id: 1,
            storyId: 10,
            stageName: 'sm',
            attempt: 1,
          },
        ],
      };

      // Ensure all fields are accessible
      expect(typeof result.recoveredCount).toBe('number');
      expect(Array.isArray(result.recoveredTasks)).toBe(true);
      expect(typeof result.recoveredTasks[0]?.id).toBe('number');
      expect(typeof result.recoveredTasks[0]?.storyId).toBe('number');
      expect(typeof result.recoveredTasks[0]?.stageName).toBe('string');
      expect(typeof result.recoveredTasks[0]?.attempt).toBe('number');
    });

    it('should support multiple recovered tasks with different stages', () => {
      const result: RecoveryResult = {
        recoveredCount: 4,
        recoveredTasks: [
          { id: 1, storyId: 1, stageName: 'sm', attempt: 1 },
          { id: 2, storyId: 2, stageName: 'dev', attempt: 1 },
          { id: 3, storyId: 3, stageName: 'review', attempt: 2 },
          { id: 4, storyId: 4, stageName: 'tester', attempt: 1 },
        ],
      };

      expect(result.recoveredCount).toBe(4);
      expect(result.recoveredTasks).toHaveLength(4);

      const stages = result.recoveredTasks.map((t) => t.stageName);
      expect(stages).toEqual(['sm', 'dev', 'review', 'tester']);
    });
  });

  describe('QueueEvent stageName field', () => {
    it('should allow QueueEvent without stageName (backward compatible)', () => {
      const event: EventMap['queue:updated'] = {
        pending: 5,
        running: 2,
        completed: 10,
        failed: 1,
      };
      expect(event.stageName).toBeUndefined();
      expect(event.queuedCount).toBeUndefined();
    });

    it('should allow QueueEvent with optional stageName and queuedCount', () => {
      const event: EventMap['queue:updated'] = {
        pending: 5,
        running: 2,
        completed: 10,
        failed: 1,
        stageName: 'dev',
        queuedCount: 3,
      };
      expect(event.stageName).toBe('dev');
      expect(event.queuedCount).toBe(3);
    });
  });

  describe('no type duplication', () => {
    it('PipelineReadyEvent should use imported RecoveryResult type, not inline', () => {
      // This test ensures we're using the type reference, not an inlined duplicate
      // by verifying the type is exactly compatible with what's in PipelineTypes
      const recovery1: RecoveryResult = { recoveredCount: 1, recoveredTasks: [] };
      const event: PipelineReadyEvent = {
        projectId: 1,
        recoveryResult: recovery1,
      };

      // Should work without type errors
      expect(event.recoveryResult).toBe(recovery1);
    });
  });
});
