import { describe, it, expect } from 'vitest';
import { DrainSignal } from '../../../src/core/DrainSignal.js';

describe('DrainSignal', () => {
  describe('isDraining()', () => {
    it('should return false by default on new instance', () => {
      const signal = new DrainSignal();
      expect(signal.isDraining()).toBe(false);
    });
  });

  describe('activate()', () => {
    it('should cause isDraining() to return true', () => {
      const signal = new DrainSignal();
      signal.activate();
      expect(signal.isDraining()).toBe(true);
    });

    it('should be idempotent — calling activate() multiple times keeps isDraining() true', () => {
      const signal = new DrainSignal();
      signal.activate();
      signal.activate();
      signal.activate();
      expect(signal.isDraining()).toBe(true);
    });
  });

  describe('reset()', () => {
    it('should cause isDraining() to return false after activate()', () => {
      const signal = new DrainSignal();
      signal.activate();
      signal.reset();
      expect(signal.isDraining()).toBe(false);
    });

    it('should be safe to call reset() without prior activate() — isDraining() stays false', () => {
      const signal = new DrainSignal();
      signal.reset();
      expect(signal.isDraining()).toBe(false);
    });

    it('should allow re-activation after reset', () => {
      const signal = new DrainSignal();
      signal.activate();
      signal.reset();
      signal.activate();
      expect(signal.isDraining()).toBe(true);
    });
  });

  describe('instance isolation', () => {
    it('should not share state between instances', () => {
      const a = new DrainSignal();
      const b = new DrainSignal();
      a.activate();
      expect(a.isDraining()).toBe(true);
      expect(b.isDraining()).toBe(false);
    });
  });
});
