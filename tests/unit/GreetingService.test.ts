import { describe, it, expect } from 'vitest';
import { GreetingService } from '../../src/services/GreetingService.js';

// Fixed reference dates for deterministic testing
const MORNING_DATE = new Date('2024-01-01T09:00:00');   // hour=9  → morning
const AFTERNOON_DATE = new Date('2024-01-01T14:00:00'); // hour=14 → afternoon
const EVENING_DATE = new Date('2024-01-01T20:00:00');   // hour=20 → evening

describe('GreetingService', () => {
  describe('greet', () => {
    // ------------------------------------------------------------------
    // Story 1.1 regression tests — updated to pass a fixed morning Date
    // ------------------------------------------------------------------
    it('should return a personalized greeting for a valid name', () => {
      const service = new GreetingService();
      expect(service.greet('Alice', MORNING_DATE)).toBe('Good morning, Alice! Welcome aboard.');
    });

    it('should return a guest greeting for an empty string', () => {
      const service = new GreetingService();
      expect(service.greet('', MORNING_DATE)).toBe('Good morning, Guest! Welcome aboard.');
    });

    it('should return a guest greeting for a whitespace-only string', () => {
      const service = new GreetingService();
      expect(service.greet('  ', MORNING_DATE)).toBe('Good morning, Guest! Welcome aboard.');
    });

    it('should return a guest greeting for null', () => {
      const service = new GreetingService();
      expect(service.greet(null, MORNING_DATE)).toBe('Good morning, Guest! Welcome aboard.');
    });

    it('should return a guest greeting for undefined', () => {
      const service = new GreetingService();
      expect(service.greet(undefined, MORNING_DATE)).toBe('Good morning, Guest! Welcome aboard.');
    });

    it('should preserve leading/trailing whitespace in name for display', () => {
      const service = new GreetingService();
      expect(service.greet(' Alice ', MORNING_DATE)).toBe('Good morning,  Alice ! Welcome aboard.');
    });

    // ------------------------------------------------------------------
    // Story 1.3 — time-based greeting
    // ------------------------------------------------------------------
    describe('time-based greeting', () => {
      it('should return "Good morning" for hour=9', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T09:00:00');
        expect(service.greet('Alice', date)).toBe('Good morning, Alice! Welcome aboard.');
      });

      it('should return "Good afternoon" for hour=12', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T12:00:00');
        expect(service.greet('Alice', date)).toBe('Good afternoon, Alice! Welcome aboard.');
      });

      it('should return "Good evening" for hour=17', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T17:00:00');
        expect(service.greet('Alice', date)).toBe('Good evening, Alice! Welcome aboard.');
      });

      it('should return "Good evening" for hour=0 (midnight boundary)', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T00:00:00');
        expect(service.greet('Alice', date)).toBe('Good evening, Alice! Welcome aboard.');
      });

      it('should return "Good evening" for hour=4 (upper evening boundary before morning)', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T04:00:00');
        expect(service.greet('Alice', date)).toBe('Good evening, Alice! Welcome aboard.');
      });

      it('should return "Good morning" for hour=5 (lower morning boundary)', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T05:00:00');
        expect(service.greet('Alice', date)).toBe('Good morning, Alice! Welcome aboard.');
      });

      it('should return "Good morning" for hour=11 (upper morning boundary)', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T11:00:00');
        expect(service.greet('Alice', date)).toBe('Good morning, Alice! Welcome aboard.');
      });

      it('should return "Good afternoon" for hour=16 (upper afternoon boundary)', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T16:00:00');
        expect(service.greet('Alice', date)).toBe('Good afternoon, Alice! Welcome aboard.');
      });

      it('should not throw and return a time-prefixed string when no Date arg is passed', () => {
        const service = new GreetingService();
        let result: string | undefined;
        expect(() => { result = service.greet('Alice'); }).not.toThrow();
        expect(result).toMatch(/^Good (morning|afternoon|evening), Alice! Welcome aboard\.$/);
      });
    });

    // ------------------------------------------------------------------
    // Story 1.3 — Guest fallback interacts with time prefix
    // ------------------------------------------------------------------
    describe('guest fallback with time prefix', () => {
      it('should return "Good morning, Guest!" for empty string with morning date', () => {
        const service = new GreetingService();
        expect(service.greet('', MORNING_DATE)).toBe('Good morning, Guest! Welcome aboard.');
      });

      it('should return "Good afternoon, Guest!" for null with afternoon date', () => {
        const service = new GreetingService();
        expect(service.greet(null, AFTERNOON_DATE)).toBe('Good afternoon, Guest! Welcome aboard.');
      });

      it('should return "Good evening, Guest!" for whitespace-only name with evening date', () => {
        const service = new GreetingService();
        expect(service.greet('   ', EVENING_DATE)).toBe('Good evening, Guest! Welcome aboard.');
      });
    });

    // ------------------------------------------------------------------
    // Story 1.3 — Off-by-one boundary checks
    // ------------------------------------------------------------------
    describe('boundary edge cases', () => {
      it('hour=4 should be evening, NOT morning (< 5 boundary)', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T04:00:00');
        const result = service.greet('Alice', date);
        expect(result).not.toContain('Good morning');
        expect(result).toBe('Good evening, Alice! Welcome aboard.');
      });

      it('hour=5 should be morning, not evening (>= 5 boundary)', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T05:00:00');
        const result = service.greet('Alice', date);
        expect(result).not.toContain('Good evening');
        expect(result).toBe('Good morning, Alice! Welcome aboard.');
      });

      it('hour=16 should be afternoon, not evening', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T16:00:00');
        const result = service.greet('Alice', date);
        expect(result).not.toContain('Good evening');
        expect(result).toBe('Good afternoon, Alice! Welcome aboard.');
      });

      it('hour=17 should flip to evening, not remain afternoon', () => {
        const service = new GreetingService();
        const date = new Date('2024-01-01T17:00:00');
        const result = service.greet('Alice', date);
        expect(result).not.toContain('Good afternoon');
        expect(result).toBe('Good evening, Alice! Welcome aboard.');
      });

      it('hours 1, 2, 3 should all map to evening', () => {
        const service = new GreetingService();
        for (const hour of [1, 2, 3]) {
          const date = new Date(`2024-01-01T0${hour}:00:00`);
          expect(service.greet('Alice', date)).toBe('Good evening, Alice! Welcome aboard.');
        }
      });

      it('hours 18, 21, 23 should all map to evening', () => {
        const service = new GreetingService();
        for (const hour of [18, 21, 23]) {
          const date = new Date(`2024-01-01T${hour}:00:00`);
          expect(service.greet('Alice', date)).toBe('Good evening, Alice! Welcome aboard.');
        }
      });

      it('hours 6, 8, 10 should all map to morning', () => {
        const service = new GreetingService();
        for (const hour of [6, 8, 10]) {
          const date = new Date(`2024-01-01T${String(hour).padStart(2, '0')}:00:00`);
          expect(service.greet('Alice', date)).toBe('Good morning, Alice! Welcome aboard.');
        }
      });

      it('hours 13, 14, 15 should all map to afternoon', () => {
        const service = new GreetingService();
        for (const hour of [13, 14, 15]) {
          const date = new Date(`2024-01-01T${hour}:00:00`);
          expect(service.greet('Alice', date)).toBe('Good afternoon, Alice! Welcome aboard.');
        }
      });
    });
  });
});
