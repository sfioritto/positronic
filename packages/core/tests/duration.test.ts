import { parseDuration } from '../src/dsl/duration.js';

describe('parseDuration', () => {
  describe('number input (ms passthrough)', () => {
    it('should pass through positive numbers', () => {
      expect(parseDuration(1000)).toBe(1000);
      expect(parseDuration(1)).toBe(1);
      expect(parseDuration(86400000)).toBe(86400000);
    });

    it('should throw on zero', () => {
      expect(() => parseDuration(0)).toThrow('Invalid duration');
    });

    it('should throw on negative numbers', () => {
      expect(() => parseDuration(-1000)).toThrow('Invalid duration');
    });

    it('should throw on Infinity', () => {
      expect(() => parseDuration(Infinity)).toThrow('Invalid duration');
    });

    it('should throw on NaN', () => {
      expect(() => parseDuration(NaN)).toThrow('Invalid duration');
    });
  });

  describe('string input (ms parsing)', () => {
    it('should parse minutes', () => {
      expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    });

    it('should parse hours', () => {
      expect(parseDuration('1h')).toBe(60 * 60 * 1000);
      expect(parseDuration('24h')).toBe(24 * 60 * 60 * 1000);
    });

    it('should parse days', () => {
      expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should parse seconds', () => {
      expect(parseDuration('30s')).toBe(30 * 1000);
    });

    it('should throw on invalid strings', () => {
      expect(() => parseDuration('abc')).toThrow('Invalid duration string');
      expect(() => parseDuration('')).toThrow('Invalid duration string');
    });

    it('should throw on negative duration strings', () => {
      expect(() => parseDuration('-1h')).toThrow('Invalid duration string');
    });
  });
});
