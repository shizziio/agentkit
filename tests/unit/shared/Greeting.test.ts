import { describe, it, expect } from 'vitest';
import { greet, farewell } from '@shared/Greeting.js';

describe('greet', () => {
  describe('AC1: normal name input', () => {
    it('should return "Hello, World!" when given "World"', () => {
      expect(greet('World')).toBe('Hello, World!');
    });

    it('should return correctly formatted greeting for any name', () => {
      expect(greet('Alice')).toBe('Hello, Alice!');
    });

    it('should return correctly formatted greeting for single character name', () => {
      expect(greet('A')).toBe('Hello, A!');
    });

    it('should pass through names with special characters without modification', () => {
      expect(greet('José')).toBe('Hello, José!');
    });

    it('should pass through names with unicode characters without modification', () => {
      expect(greet('张伟')).toBe('Hello, 张伟!');
    });

    it('should pass through very long names without truncation', () => {
      const longName = 'A'.repeat(1000);
      expect(greet(longName)).toBe(`Hello, ${longName}!`);
    });
  });

  describe('AC2: empty string input', () => {
    it('should return "Hello, stranger!" when given empty string', () => {
      expect(greet('')).toBe('Hello, stranger!');
    });

    it('should NOT return "Hello, !" for empty string', () => {
      expect(greet('')).not.toBe('Hello, !');
    });
  });

  describe('edge cases', () => {
    it('should treat whitespace-only string as non-empty (pass through as-is)', () => {
      // Per spec: whitespace-only is treated as non-empty unless spec changes
      expect(greet('   ')).toBe('Hello,    !');
    });

    it('should be a pure function — same input always produces same output', () => {
      expect(greet('test')).toBe(greet('test'));
      expect(greet('')).toBe(greet(''));
    });

    it('should handle name with numbers', () => {
      expect(greet('R2D2')).toBe('Hello, R2D2!');
    });

    it('should handle name with punctuation', () => {
      expect(greet('O\'Brien')).toBe("Hello, O'Brien!");
    });
  });
});

describe('farewell', () => {
  describe('AC1: farewell function exists and returns correct format', () => {
    it('should return "Goodbye, World!" when given "World"', () => {
      expect(farewell('World')).toBe('Goodbye, World!');
    });

    it('should return correctly formatted farewell for any name', () => {
      expect(farewell('Alice')).toBe('Goodbye, Alice!');
    });

    it('should return correctly formatted farewell for single character name', () => {
      expect(farewell('A')).toBe('Goodbye, A!');
    });
  });

  describe('AC2: empty name handling', () => {
    it('should return "Goodbye, stranger!" when given empty string', () => {
      expect(farewell('')).toBe('Goodbye, stranger!');
    });

    it('should NOT return "Goodbye, !" for empty string', () => {
      expect(farewell('')).not.toBe('Goodbye, !');
    });
  });

  describe('AC3: co-existence with greet', () => {
    it('should be importable alongside greet without conflict', () => {
      expect(typeof greet).toBe('function');
      expect(typeof farewell).toBe('function');
    });

    it('should both return correct values when called in sequence', () => {
      expect(greet('World')).toBe('Hello, World!');
      expect(farewell('World')).toBe('Goodbye, World!');
    });

    it('should both handle empty string correctly and independently', () => {
      expect(greet('')).toBe('Hello, stranger!');
      expect(farewell('')).toBe('Goodbye, stranger!');
    });

    it('should not share or corrupt each other\'s state', () => {
      farewell('test');
      expect(greet('World')).toBe('Hello, World!');

      greet('test');
      expect(farewell('World')).toBe('Goodbye, World!');
    });
  });

  describe('edge cases', () => {
    it('should treat whitespace-only string as non-empty (pass through as-is)', () => {
      // Per spec: whitespace-only is treated as non-empty unless spec changes
      expect(farewell('   ')).toBe('Goodbye,    !');
    });

    it('should be a pure function — same input always produces same output', () => {
      expect(farewell('test')).toBe(farewell('test'));
      expect(farewell('')).toBe(farewell(''));
    });

    it('should handle names with special characters without modification', () => {
      expect(farewell('José')).toBe('Goodbye, José!');
    });

    it('should handle names with unicode characters', () => {
      expect(farewell('张伟')).toBe('Goodbye, 张伟!');
    });

    it('should handle names with numbers', () => {
      expect(farewell('R2D2')).toBe('Goodbye, R2D2!');
    });
  });
});
