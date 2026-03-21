import { describe, it, expect } from 'vitest';
import type {
  EventMap,
  TaskStatus,
  PipelineDrainingEvent,
  TaskDrainedEvent,
} from '../../../src/core/EventTypes.js';

describe('EventTypes — drain additions (Story 24.1)', () => {
  describe('AC3a: TaskStatus includes cancelled', () => {
    it('should accept "cancelled" as a valid TaskStatus value', () => {
      // Type-level assertion: if 'cancelled' were not in the union this file
      // would fail to compile (TypeScript error).
      const status: TaskStatus = 'cancelled';
      expect(status).toBe('cancelled');
    });

    it('should still accept all previously valid TaskStatus values', () => {
      const statuses: TaskStatus[] = [
        'queued',
        'running',
        'completed',
        'failed',
        'routed',
        'rejected',
        'cancelled',
      ];
      expect(statuses).toHaveLength(7);
      expect(statuses).toContain('cancelled');
    });
  });

  describe('AC4a: pipeline:draining event type', () => {
    it('should exist in EventMap with correct shape', () => {
      // Compile-time check: assigning a correctly shaped object must not error.
      const event: EventMap['pipeline:draining'] = {
        timestamp: new Date().toISOString(),
        projectId: 1,
      };
      expect(event.timestamp).toBeTruthy();
      expect(typeof event.projectId).toBe('number');
    });

    it('should have timestamp as string', () => {
      const event: EventMap['pipeline:draining'] = {
        timestamp: '2026-03-19T00:00:00.000Z',
        projectId: 42,
      };
      expect(typeof event.timestamp).toBe('string');
    });

    it('should have projectId as number', () => {
      const event: EventMap['pipeline:draining'] = {
        timestamp: '2026-03-19T00:00:00.000Z',
        projectId: 42,
      };
      expect(typeof event.projectId).toBe('number');
      expect(event.projectId).toBe(42);
    });

    it('should export PipelineDrainingEvent interface', () => {
      const event: PipelineDrainingEvent = {
        timestamp: '2026-03-19T00:00:00.000Z',
        projectId: 7,
      };
      expect(event.projectId).toBe(7);
    });

    it('PipelineDrainingEvent should be compatible with EventMap["pipeline:draining"]', () => {
      const event: PipelineDrainingEvent = {
        timestamp: '2026-03-19T00:00:00.000Z',
        projectId: 99,
      };
      const mapped: EventMap['pipeline:draining'] = event;
      expect(mapped).toBe(event);
    });
  });

  describe('AC4b: task:drained event type', () => {
    it('should exist in EventMap with correct shape', () => {
      const event: EventMap['task:drained'] = {
        taskId: 10,
        storyId: 5,
        stageName: 'dev',
      };
      expect(event.taskId).toBe(10);
      expect(event.storyId).toBe(5);
      expect(event.stageName).toBe('dev');
    });

    it('should have taskId as number', () => {
      const event: EventMap['task:drained'] = {
        taskId: 1,
        storyId: 2,
        stageName: 'sm',
      };
      expect(typeof event.taskId).toBe('number');
    });

    it('should have storyId as number', () => {
      const event: EventMap['task:drained'] = {
        taskId: 1,
        storyId: 2,
        stageName: 'sm',
      };
      expect(typeof event.storyId).toBe('number');
    });

    it('should have stageName as string', () => {
      const event: EventMap['task:drained'] = {
        taskId: 1,
        storyId: 2,
        stageName: 'tester',
      };
      expect(typeof event.stageName).toBe('string');
    });

    it('should export TaskDrainedEvent interface', () => {
      const event: TaskDrainedEvent = {
        taskId: 100,
        storyId: 50,
        stageName: 'review',
      };
      expect(event.taskId).toBe(100);
    });

    it('TaskDrainedEvent should be compatible with EventMap["task:drained"]', () => {
      const event: TaskDrainedEvent = {
        taskId: 5,
        storyId: 3,
        stageName: 'dev',
      };
      const mapped: EventMap['task:drained'] = event;
      expect(mapped).toBe(event);
    });
  });

  describe('EventMap completeness check', () => {
    it('EventMap should include both new drain event keys', () => {
      // Statically-typed array forces a compile error if either key is missing
      const drainKeys: (keyof EventMap)[] = ['pipeline:draining', 'task:drained'];
      expect(drainKeys).toContain('pipeline:draining');
      expect(drainKeys).toContain('task:drained');
    });
  });
});
