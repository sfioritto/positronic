import { describe, it, expect } from '@jest/globals';
import {
  estimateTokens,
  estimateRequestTokens,
} from '../src/token-estimator.js';

describe('token-estimator', () => {
  describe('estimateTokens', () => {
    it('returns a positive number for non-empty text', () => {
      const count = estimateTokens('hello world');
      expect(count).toBeGreaterThan(0);
    });

    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('returns more tokens for longer text', () => {
      const short = estimateTokens('hello');
      const long = estimateTokens(
        'hello world, this is a longer sentence with many more words'
      );
      expect(long).toBeGreaterThan(short);
    });
  });

  describe('estimateRequestTokens', () => {
    it('estimates tokens from a prompt', () => {
      const count = estimateRequestTokens({ prompt: 'Summarize this article' });
      expect(count).toBeGreaterThan(0);
    });

    it('combines system, messages, and prompt', () => {
      const promptOnly = estimateRequestTokens({ prompt: 'hello' });
      const withSystem = estimateRequestTokens({
        system: 'You are a helpful assistant',
        prompt: 'hello',
      });
      expect(withSystem).toBeGreaterThan(promptOnly);
    });

    it('handles messages array', () => {
      const count = estimateRequestTokens({
        messages: [
          { content: 'What is AI?' },
          { content: 'AI stands for artificial intelligence.' },
        ],
      });
      expect(count).toBeGreaterThan(0);
    });
  });
});
